// sockets/socket.js : your file with the canvas handlers wired in correctly.
// Adjust the require path if canvasHandlers.js lives somewhere else.
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs-extra");
const simpleGit = require("simple-git");
const registerCanvasHandlers = require("./canvasHandlers");

const activeIntervals = new Map();   // roomId -> metrics interval
const roomUsers = {};                // roomId -> Map(userId -> user)
const pullRequests = {};             // roomId -> PR list

function generateMetrics() {
  const algorithms = ["DVFS", "PSO", "ACO"];
  const cpu = Math.random() * 100;
  const memory = Math.random() * 1000;
  const factor = { DVFS: 0.45, PSO: 0.35, ACO: 0.25 };

  return algorithms.map((algo) => ({
    cpu: Number(cpu.toFixed(2)),
    memory: Number(memory.toFixed(2)),
    energy: Number((cpu * factor[algo] + Math.random() * 2).toFixed(2)),
    algorithm: algo,
    time: Date.now(),
  }));
}

const startMetricsStream = (io, roomId) => {
  if (activeIntervals.has(roomId)) return;          // one stream per room
  console.log(`📊 Metrics stream started for room: ${roomId}`);

  const interval = setInterval(() => {
    generateMetrics().forEach((metric) => {
      io.to(roomId).emit("metrics-update", { ...metric, time: Date.now() });
    });
  }, 2000);

  activeIntervals.set(roomId, interval);
};

module.exports = (io) => {
  io.on("connection", (socket) => {
    // canvas sync + saved workspace state (new)
    registerCanvasHandlers(io, socket);

    // ===== GIT STATE =====
    const broadcastGitState = async (roomId, userId) => {
      try {
        const workspacePath = path.resolve(process.cwd(), "workspaces", roomId, userId);
        if (!fs.existsSync(workspacePath)) return;

        const git = simpleGit(workspacePath);
        if (!(await git.checkIsRepo())) return;

        const branchData = await git.branch();
        const log = await git.log({ n: 5 });

        io.to(roomId).emit("git-sync-tree", {
          gitData: {
            current: branchData.current,
            all: branchData.all,
            commits: log.all.map((c) => ({
              hash: c.hash.slice(0, 7),
              message: c.message,
              author: c.author_name,
            })),
          },
          userId,
        });
      } catch (err) {
        console.error("Git Error:", err.message);
      }
    };

    // ===== JOIN ROOM =====
    socket.on("join-room", ({ roomId, user }) => {
      socket.join(roomId);

      socket.userId = user.id;
      socket.userName = user.name;
      socket.role = user.role || "dev";
      socket.roomId = roomId;

      if (!roomUsers[roomId]) roomUsers[roomId] = new Map();
      if (!pullRequests[roomId]) pullRequests[roomId] = [];

      roomUsers[roomId].set(user.id, {
        socketId: socket.id,
        userId: user.id,
        name: user.name,
        role: socket.role,
      });

      io.to(roomId).emit("user-presence-update", Array.from(roomUsers[roomId].values()));

      startMetricsStream(io, roomId);

      if (socket.gitWatcher) clearInterval(socket.gitWatcher);
      broadcastGitState(roomId, user.id);
      socket.gitWatcher = setInterval(() => broadcastGitState(roomId, user.id), 8000);
    });

    // ===== TERMINAL =====
    // WARNING: exec() runs on the host. Move this into the user's container before real users.
    socket.on("terminal-command", async ({ roomId, command }) => {
      const workspacePath = path.resolve(process.cwd(), "workspaces", roomId, socket.userId);

      if (command.includes("rm -rf") || command.includes("shutdown") || command.includes("reboot")) {
        return socket.emit("terminal-output", "❌ Dangerous command blocked");
      }

      const git = simpleGit(workspacePath);

      if (command.includes("git commit") || command.includes("git push")) {
        const branchInfo = await git.branch();
        if (branchInfo.current === "main") {
          return socket.emit("terminal-output", "❌ Cannot push to MAIN");
        }
      }

      if (command.includes("git push")) {
        const branch = (await git.branch()).current;
        const exists = pullRequests[roomId].find((p) => p.branch === branch);

        if (!exists) {
          const pr = {
            id: Date.now().toString(),
            branch,
            user: socket.userName,
            status: "OPEN",
            testStatus: "PENDING",
          };
          pullRequests[roomId].push(pr);
          io.to(roomId).emit("new-pr", pr);
          io.to(roomId).emit("activity-log", `🔁 PR created from ${branch}`);
        }
      }

      const child = exec(command, { cwd: workspacePath });
      child.stdout.on("data", (d) => socket.emit("terminal-output", d.toString()));
      child.stderr.on("data", (d) => socket.emit("terminal-output", `❌ ${d.toString()}`));
      child.on("close", () => {
        if (command.includes("git")) broadcastGitState(roomId, socket.userId);
      });
    });

    // ===== PR ACTION =====
    socket.on("pr-action", ({ id, action }) => {
      if (socket.role !== "admin") {
        return socket.emit("terminal-output", "❌ Only admin can approve PR");
      }
      const pr = (pullRequests[socket.roomId] || []).find((p) => p.id === id);
      if (!pr) return;

      pr.status = action === "approve" ? "APPROVED" : "REJECTED";
      io.to(socket.roomId).emit("pr-updated", pr);
      io.to(socket.roomId).emit("activity-log", `PR ${action} by ${socket.userName}`);
    });

    // ===== TEST RESULT =====
    socket.on("test-result", ({ id, status }) => {
      const pr = (pullRequests[socket.roomId] || []).find((p) => p.id === id);
      if (!pr) return;

      pr.testStatus = status;
      io.to(socket.roomId).emit("activity-log", `🧪 Test ${status} for ${pr.branch}`);
      io.to(socket.roomId).emit("pipeline-update", {
        branch: pr.branch,
        build: "done",
        test: status,
        deploy: status === "passed" ? "deploying" : "blocked",
      });
    });

    // ===== BUG REPORT =====
    socket.on("report-bug", async ({ roomId, targetUserId, bugDetails }) => {
      try {
        const targetPath = path.resolve(process.cwd(), "workspaces", roomId, targetUserId, "BUGS.md");
        await fs.appendFile(targetPath, `\n### 🐛 Bug by ${socket.userName}\n${bugDetails}\n`);
        io.to(roomId).emit("activity-log", `🐛 Bug reported by ${socket.userName}`);
      } catch (err) {
        console.error("Bug write error:", err);
      }
    });

    // ===== DISCONNECT =====
    socket.on("disconnect", () => {
      if (socket.gitWatcher) clearInterval(socket.gitWatcher);

      const roomId = socket.roomId;
      if (!roomId || !roomUsers[roomId]) return;

      // only remove the user if THIS socket is their current one (other tabs / reconnects stay)
      const entry = roomUsers[roomId].get(socket.userId);
      if (entry && entry.socketId === socket.id) roomUsers[roomId].delete(socket.userId);

      io.to(roomId).emit("user-presence-update", Array.from(roomUsers[roomId].values()));

      // last person left: stop the metrics timer
      if (roomUsers[roomId].size === 0) {
        clearInterval(activeIntervals.get(roomId));
        activeIntervals.delete(roomId);
        delete roomUsers[roomId];
      }
    });
  });
};