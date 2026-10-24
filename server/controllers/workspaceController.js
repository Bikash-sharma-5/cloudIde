const simpleGit = require("simple-git");
const fs = require("fs-extra");
const path = require("path");
const net = require("net");
const crypto = require("crypto");
const yaml = require("js-yaml");
const Docker = require("dockerode");
const { exec, execSync } = require("child_process");

const Room = require("../models/Room");

const docker = new Docker();
const activeWorkspaces = new Set();
const activeMetricsIntervals = new Map();

let ioInstance = null;
let lastMetric = "";

// --------------------------------------
// 📁 PATH CONFIGURATION
// --------------------------------------
const templatePath = path.join(__dirname, "..", "templates", "workspace");

// --------------------------------------
// 🔌 SOCKET ATTACHER
// --------------------------------------
exports.attachIO = (io) => {
  ioInstance = io;
};

// --------------------------------------
// 🧠 HELPER: PORT SCANNER (Avoids port 5000/5050/80/443)
// --------------------------------------
const findAvailablePort = (startPort) => {
  if (startPort < 9000) startPort = 9000;

  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(startPort, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on("error", () => resolve(findAvailablePort(startPort + 1)));
  });
};

// --------------------------------------
// 📊 METRICS STREAMER (LINE-BY-LINE SAFE)
// --------------------------------------
const startMetricsStream = (roomId, containerId) => {
  try {
    const container = docker.getContainer(containerId);

    container.logs(
      {
        follow: true,
        stdout: true,
        stderr: true,
        tail: 20
      },
      (err, stream) => {
        if (err) {
          console.error("Docker log stream error:", err.message);
          return;
        }

        stream.on("data", (chunk) => {
          const rawLines = chunk.toString("utf8").split("\n");

          for (const line of rawLines) {
            if (!line.includes("METRIC:")) continue;

            try {
              const jsonStr = line.substring(line.indexOf("METRIC:") + 7).trim();
              if (!jsonStr.startsWith("{") || !jsonStr.endsWith("}")) continue;

              const metric = JSON.parse(jsonStr);

              ioInstance?.to(roomId).emit("metrics-update", {
                ...metric,
                time: Date.now()
              });
            } catch (parseErr) {
              // Ignore partial frame cuts across chunk boundaries
            }
          }
        });
      }
    );
  } catch (err) {
    console.error("Container attachment error:", err.message);
  }
};

// --------------------------------------
// 🐙 SAFE GIT INSPECTION
// --------------------------------------
const getGitData = async (workspacePath, roomId, userName) => {
  try {
    const git = simpleGit(workspacePath);
    const isRepo = await git.checkIsRepo();
    if (!isRepo) return null;

    const branches = await git.branch().catch(() => ({ current: "main", all: ["main"] }));
    const log = await git.log({ n: 5 }).catch(() => ({ all: [] }));

    if (log && log.all && log.all.length > 0) {
      log.all.forEach((c) => {
        ioInstance?.to(roomId).emit("new-commit", {
          message: c.message,
          branch: branches.current,
          user: userName || c.author_name
        });
      });
    }

    return {
      current: branches.current,
      all: branches.all
    };
  } catch (err) {
    console.warn("Git inspection bypassed:", err.message);
    return null;
  }
};

// --------------------------------------
// 🔍 PROJECT DEPENDENCY DETECTION
// --------------------------------------
const detectDependencies = async (workspacePath) => {
  const suggestions = [];
  try {
    if (!await fs.pathExists(workspacePath)) return suggestions;
    const files = await fs.readdir(workspacePath);

    if (files.includes("package.json")) suggestions.push("node");
    if (files.includes("requirements.txt")) suggestions.push("python");
    if (files.includes("go.mod")) suggestions.push("go");
    if (files.includes("pom.xml")) suggestions.push("java");
  } catch (err) {
    console.warn("Dependency detection warning:", err.message);
  }
  return suggestions;
};

// --------------------------------------
// 🐳 DOCKER COMPOSE GENERATOR
// --------------------------------------
const generateComposeYaml = (
  nodes = [],
  detectedDeps = [],
  roomId,
  port,
  workspacePath,
  algorithm = "DVFS",
  sessionPassword = ""
) => {
  const suffix = roomId.substring(0, 6);
  const basePort = parseInt(port, 10);
  const normalizedPath = path.resolve(workspacePath).replace(/\\/g, "/");

  const services = {};

  // 1. CORE VS CODE EDITOR CONTAINER (Secured with session password)
  services[`workspace-${suffix}`] = {
    image: "dev-workspace",
    container_name: `workspace-core-${suffix}`,
    ports: [
      `${basePort}:8080`,
      `${basePort + 1000}:3000`
    ],
    volumes: [
      `${normalizedPath}:/workspace`,
      "/var/run/docker.sock:/var/run/docker.sock"
    ],
    networks: ["cloud-net"],
    environment: {
      ROOM_ID: roomId,
      USER_ID: "auto",
      ALGORITHM: algorithm,
      PASSWORD: sessionPassword
    },
    command: `
sh -c "
code-server --bind-addr 0.0.0.0:8080 --auth ${sessionPassword ? "password" : "none"} /workspace &
sleep 5 &&
if [ -f /workspace/runExperiment.js ]; then node /workspace/runExperiment.js; fi &&
tail -f /dev/null
"
`
  };

  // 2. EXTRACT SERVICES FROM NODES
  const activeServiceTypes = new Set();

  nodes.forEach((n) => {
    const rawType = (n.data?.serviceType || n.id || "").toLowerCase();
    if (rawType.includes("python")) activeServiceTypes.add("python");
    if (rawType.includes("redis")) activeServiceTypes.add("redis");
    if (rawType.includes("postgres")) activeServiceTypes.add("postgres");
    if (rawType.includes("mongo")) activeServiceTypes.add("mongodb");
    if (rawType.includes("node")) activeServiceTypes.add("node");
  });

  detectedDeps.forEach((dep) => activeServiceTypes.add(dep));

  // 3. ATTACH DYNAMIC SERVICE CONTAINERS (Bound locally to 127.0.0.1 for isolation)
  if (activeServiceTypes.has("python")) {
    services[`python-${suffix}`] = {
      image: "python:3.11-slim",
      container_name: `workspace-python-${suffix}`,
      volumes: [`${normalizedPath}:/workspace`],
      working_dir: "/workspace",
      command: "tail -f /dev/null",
      networks: ["cloud-net"]
    };
  }

  if (activeServiceTypes.has("redis")) {
    services[`redis-${suffix}`] = {
      image: "redis:7-alpine",
      container_name: `workspace-redis-${suffix}`,
      ports: [`127.0.0.1:${basePort + 200}:6379`],
      networks: ["cloud-net"]
    };
  }

  if (activeServiceTypes.has("postgres")) {
    services[`postgres-${suffix}`] = {
      image: "postgres:15-alpine",
      container_name: `workspace-postgres-${suffix}`,
      environment: {
        POSTGRES_USER: "root",
        POSTGRES_PASSWORD: "password",
        POSTGRES_DB: "cloudflow"
      },
      ports: [`127.0.0.1:${basePort + 300}:5432`],
      networks: ["cloud-net"]
    };
  }

  if (activeServiceTypes.has("mongodb")) {
    services[`mongo-${suffix}`] = {
      image: "mongo:6-jammy",
      container_name: `workspace-mongo-${suffix}`,
      ports: [`127.0.0.1:${basePort + 400}:27017`],
      networks: ["cloud-net"]
    };
  }

  return yaml.dump({
    version: "3.8",
    services,
    networks: {
      "cloud-net": { external: true }
    }
  });
};

// --------------------------------------
// 🚀 CREATE WORKSPACE
// --------------------------------------
exports.createWorkspace = async (req, res) => {
  const { roomId, userId, repoUrl, nodes = [], algorithm = "DVFS" } = req.body;
  const workspaceKey = `${roomId}-${userId}`;

  if (activeWorkspaces.has(workspaceKey)) {
    return res.status(200).json({
      message: "Workspace build already in progress. Please wait..."
    });
  }

  activeWorkspaces.add(workspaceKey);

  try {
    const room = await Room.findById(roomId);
    if (!room) {
      activeWorkspaces.delete(workspaceKey);
      return res.status(404).json({ error: "Room not found" });
    }

    // Allocate port starting safely at 9000
    const port = await findAvailablePort(9000);
    const workspacePath = path.resolve("workspaces", roomId, userId);
    const containerName = `workspace-core-${roomId.substring(0, 6)}`;

    // Generate unique session password for security
    const sessionToken = crypto.randomBytes(8).toString("hex");

    // Ensure external network exists
    try {
      execSync("docker network create cloud-net", { stdio: "ignore" });
    } catch (_) {}

    // Stop and remove existing container instance if one exists
    try {
      execSync(`docker stop ${containerName}`, { stdio: "ignore" });
      execSync(`docker rm ${containerName}`, { stdio: "ignore" });
    } catch (_) {}

    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Prepare fresh workspace folder
    await fs.remove(workspacePath);
    await fs.ensureDir(workspacePath);

    // Clone git repository
    const targetRepo = repoUrl || room.repoUrl;
    if (targetRepo) {
      try {
        await simpleGit().clone(targetRepo, workspacePath);
      } catch (cloneErr) {
        console.warn("Clone warning:", cloneErr.message);
      }
    }

    // Copy template boilerplate if configured
    if (await fs.pathExists(templatePath)) {
      await fs.copy(templatePath, workspacePath, {
        overwrite: true,
        errorOnExist: false
      });
    }

    // Dependency check & compose file generation
    const deps = await detectDependencies(workspacePath);
    const yamlContent = generateComposeYaml(
      nodes,
      deps,
      roomId,
      port,
      workspacePath,
      algorithm,
      sessionToken
    );

    const yamlPath = path.join(workspacePath, "docker-compose.yml");
    await fs.writeFile(yamlPath, yamlContent);

    // Launch containers
    exec(
      `docker-compose -f "${yamlPath}" up -d --remove-orphans`,
      async (err, stdout, stderr) => {
        if (err) {
          activeWorkspaces.delete(workspaceKey);
          console.error("Docker initialization failed:", stderr);
          return res.status(500).json({ error: "Failed to spawn Docker environment" });
        }

        // Wait for services to mount
        await new Promise((resolve) => setTimeout(resolve, 3500));

        await getGitData(workspacePath, roomId);
        startMetricsStream(roomId, containerName);

        // Secondary fallback metric file watcher
        const metricsFile = path.join(workspacePath, "metrics.log");
        if (activeMetricsIntervals.has(workspaceKey)) {
          clearInterval(activeMetricsIntervals.get(workspaceKey));
        }

        const intervalId = setInterval(() => {
          try {
            if (!fs.existsSync(metricsFile)) return;
            const content = fs.readFileSync(metricsFile, "utf-8").trim();
            if (!content) return;

            const lines = content.split("\n");
            const targetLine = lines[lines.length - 1];

            if (!targetLine || targetLine === lastMetric) return;
            lastMetric = targetLine;

            const metric = JSON.parse(targetLine);
            ioInstance?.to(roomId).emit("metrics-update", {
              ...metric,
              time: Date.now()
            });
          } catch (_) {}
        }, 2500);

        activeMetricsIntervals.set(workspaceKey, intervalId);
        activeWorkspaces.delete(workspaceKey);

        // Resolve live domain (strips incoming port if present in header)
        const host = req.get("host")?.split(":")[0] || "collabide.duckdns.org";

        return res.json({
          editorUrl: `http://${host}:${port}/?folder=/workspace`,
          previewUrl: `http://${host}:${port + 1000}`,
          accessPassword: sessionToken,
          port,
          message: "Workspace ready"
        });
      }
    );
  } catch (err) {
    console.error("Workspace creation exception:", err);
    activeWorkspaces.delete(workspaceKey);
    return res.status(500).json({ error: "Internal workspace error" });
  }
};

// --------------------------------------
// 🔄 SYNC INFRASTRUCTURE (ON CANVAS CHANGE)
// --------------------------------------
exports.syncInfrastructure = async (req, res) => {
  const { roomId, userId, nodes = [], assignedPort = 9000, algorithm = "DVFS" } = req.body;

  try {
    const workspacePath = path.resolve("workspaces", roomId, userId);
    if (!await fs.pathExists(workspacePath)) {
      return res.status(404).json({ error: "Workspace does not exist" });
    }

    const deps = await detectDependencies(workspacePath);
    const yamlContent = generateComposeYaml(
      nodes,
      deps,
      roomId,
      assignedPort,
      workspacePath,
      algorithm
    );

    const yamlPath = path.join(workspacePath, "docker-compose.yml");
    await fs.writeFile(yamlPath, yamlContent);

    exec(
      `docker-compose -f "${yamlPath}" up -d --remove-orphans`,
      (err, stdout, stderr) => {
        if (err) {
          console.error("Sync error:", stderr);
          return res.status(500).json({ error: "Docker sync failed" });
        }

        ioInstance?.to(roomId).emit("activity-log", "Infrastructure topology synchronized");
        return res.json({ success: true, message: "Topology updated" });
      }
    );
  } catch (err) {
    console.error("Infrastructure sync exception:", err);
    return res.status(500).json({ error: "Sync failed" });
  }
};

// --------------------------------------
// 🚀 PIPELINE SIMULATION
// --------------------------------------
exports.runPipeline = async (roomId, branch) => {
  if (!ioInstance) return;

  ioInstance.to(roomId).emit("pipeline-update", {
    branch,
    build: "running",
    test: "pending",
    deploy: "pending"
  });

  setTimeout(() => {
    ioInstance.to(roomId).emit("pipeline-update", {
      branch,
      build: "done",
      test: "running",
      deploy: "pending"
    });
  }, 2000);

  setTimeout(() => {
    ioInstance.to(roomId).emit("pipeline-update", {
      branch,
      build: "done",
      test: "passed",
      deploy: "running"
    });
  }, 4000);

  setTimeout(() => {
    ioInstance.to(roomId).emit("pipeline-update", {
      branch,
      build: "done",
      test: "passed",
      deploy: "success"
    });
  }, 6000);
};