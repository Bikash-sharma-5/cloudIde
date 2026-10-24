# CloudFlow: Resource-Aware Collaborative Cloud IDE

A real-time, browser-based collaborative cloud IDE and topology-aware micro-execution environment. CloudFlow pairs live collaborative infrastructure canvas orchestration with containerized development workspaces (`code-server`), dynamic runtime auto-provisioning, Git tree synchronization, and heuristic energy-optimization benchmarks (DVFS, PSO, ACO).

Developed at **Army Institute of Technology, Pune**, Department of Computer Engineering.

---

## System Overview

CloudFlow is built to address resource bloat, idle compute wastage, and multi-tenant developer environment drift in cloud IDEs. Rather than keeping heavy multi-container stacks perpetually running, CloudFlow combines canvas-based visual infrastructure design with dynamic Docker container orchestration, streaming logs, and automated idle session reclamation.

### Core Capabilities
* **Interactive Architecture Canvas:** Drag-and-drop distributed services (Node.js runtime, Python workers, Redis cache, PostgreSQL, MongoDB) directly onto an `@xyflow/react` canvas to dynamically provision matching containers inside the user workspace.
* **Ephemeral Workspaces:** Instantly clones repositories, detects dependency manifests (`package.json`, `requirements.txt`, `go.mod`, `pom.xml`), builds isolated multi-service Docker Compose networks, and connects users to an in-browser VS Code (`code-server`) instance.
* **Collaborative State Sync:** Socket.IO-driven multi-user canvas syncing, user presence indicators, activity feeds, and shared pipeline telemetry.
* **Energy & Allocation Benchmarks:** Real-time metrics streaming comparing Dynamic Voltage and Frequency Scaling (**DVFS**), Particle Swarm Optimization (**PSO**), and Ant Colony Optimization (**ACO**) for compute and memory energy footprints.
* **Lifecycle & Idle Reclaim:** Automated background metrics monitoring and container state management to minimize compute resource exhaustion.

---

## Architecture

```
                       +---------------------------------------+
                       |           Browser Client              |
                       |  React 18 + Vite | XYFlow Canvas     |
                       |  Recharts Telemetry | Socket.IO Client|
                       +-------------------+-------------------+
                                           |
                              REST / WSS   | Port 5000
                                           v
                       +---------------------------------------+
                       |           Node.js API Server          |
                       |  Express | Socket.IO | Dockerode       |
                       |  Simple-Git | JWT Auth | Mongoose     |
                       +-------------------+-------------------+
                                           |
                 +-------------------------+-------------------------+
                 |                                                   |
                 v /var/run/docker.sock                              v MongoDB
   +---------------------------+                        +-------------------------+
   |   Docker Engine / Compose |                        |   MongoDB Database      |
   |   (Bridge: `cloud-net`)   |                        |   Rooms, Users, State   |
   +-------------+-------------+                        +-------------------------+
                 |
  +--------------+---------------+---------------+----------------+
  |                              |               |                |
  v                              v               v                v
+------------------+   +-------------------+  +---------------+ +---------------+
| workspace-core-* |   | workspace-python* |  | redis-*       | | mongo-*       |
| code-server:8080 |   | Python 3.11 Slim  |  | Redis 7       | | Mongo 6       |
| Port: 9000-9500  |   | Background Worker |  | Port: :9200   | | Port: :9400   |
+------------------+   +-------------------+  +---------------+ +---------------+
```

### High-Level Components
1. **Frontend (`client/`):** React 18, `@xyflow/react`, `recharts`, `socket.io-client`, and `axios`. Delivers the visual node editor, collaborative canvas synchronization, live algorithm comparison charts, and workspace launch actions.
2. **Server (`server/`):** Express REST APIs and Socket.IO real-time engine. Manages user sessions, room lifecycle, dynamic workspace creation, git repo cloning, compose spec generation, and stdout/stderr log parsing.
3. **Execution Runtime (`dev-workspace`):** Debian-bullseye container image pre-baked with Node 20, Docker CLI, and `code-server`. Connects to the host daemon via socket mounting (`/var/run/docker.sock`) to manage sub-containers.

---

## Tech Stack

| Domain | Technologies |
|---|---|
| **Frontend** | React 18, Vite, `@xyflow/react`, Recharts, React Router v6, Axios |
| **Backend** | Node.js, Express.js, Socket.IO, Dockerode, `simple-git`, `js-yaml` |
| **Database** | MongoDB with Mongoose |
| **Containers & Networking** | Docker, Docker Compose, Linux bridge network (`cloud-net`), `code-server` |
| **Algorithms Evaluated** | DVFS (Dynamic Voltage & Frequency Scaling), PSO (Particle Swarm Optimization), ACO (Ant Colony Optimization) |

---

## Repository Structure

```
cloud-dev-platform/
├── client/                     # Vite + React Frontend
│   ├── src/
│   │   ├── Room.jsx            # Canvas workspace, charts, socket listeners
│   │   ├── Room.css            # Studio layout & dark-theme styling
│   │   └── ...
│   ├── .env.example
│   ├── .gitignore
│   ├── package.json
│   └── vite.config.js
├── server/                     # Node.js + Express + Docker Engine
│   ├── config/
│   │   └── db.js               # MongoDB connection
│   ├── controllers/
│   │   ├── roomController.js   # Room lifecycle
│   │   └── workspaceController.js # Compose generation, docker execution, metrics
│   ├── models/
│   │   ├── Room.js
│   │   └── User.js
│   ├── routes/
│   │   ├── authRoutes.js
│   │   ├── roomRoutes.js
│   │   ├── workspaceRoutes.js
│   │   └── metricsRoutes.js
│   ├── sockets/
│   │   └── editorSocket.js     # Real-time room events and canvas syncing
│   ├── templates/
│   │   └── workspace/          # Default scripts mounted into workspaces
│   ├── Dockerfile              # dev-workspace image recipe (code-server + CLI)
│   ├── server.js               # Express entrypoint & HTTP server
│   ├── .env.example
│   ├── .gitignore
│   └── package.json
├── UML_Diagram_Suite.pdf       # Complete system architecture & UML models
├── .gitignore
└── README.md
```

---

## Getting Started

### Prerequisites
* **Operating System:** Linux (Ubuntu 20.04/22.04/24.04 recommended), macOS, or Windows with WSL2
* **Node.js:** v18.x or v20.x
* **Docker Engine & Docker Compose:** Installed and running with non-root user permissions
* **MongoDB:** Local instance (`mongodb://localhost:27017`) or MongoDB Atlas URI

---

### Step 1: Clone and Configure Network

```bash
git clone https://github.com/<your-username>/cloud-dev-platform.git
cd cloud-dev-platform

# Create the internal bridge network for inter-container communication
docker network create cloud-net
```

---

### Step 2: Build the Core Workspace Image

The workspace provisioning pipeline requires the base `dev-workspace` image to exist locally:

```bash
cd server
docker build -t dev-workspace .
cd ..
```

---

### Step 3: Server Configuration & Launch

1. Enter the `server` directory and install dependencies:
   ```bash
   cd server
   npm install
   ```

2. Configure environment variables in `server/.env`:
   ```env
   PORT=5000
   MONGO_URI=mongodb://127.0.0.1:27017/cloudflow
   JWT_SECRET=your_development_secret_key_123
   PUBLIC_IP_OR_DOMAIN=localhost
   ```

3. Start the server:
   ```bash
   # Development mode with auto-reload
   npm run dev

   # Or standard launch
   node server.js
   ```

---

### Step 4: Client Configuration & Launch

1. Open a new terminal tab, navigate to `client`, and install packages:
   ```bash
   cd client
   npm install
   ```

2. Start the Vite development server:
   ```bash
   npm run dev
   ```

3. Open your browser and navigate to `http://localhost:5173`.

---

## Operating Workflow

```
1. Create/Join Room   -->  2. Draw Infrastructure  -->  3. Launch Workspace  -->  4. Live Dev & Telemetry
  (Generates Room ID)      (Drag Redis/Mongo/Py)         (Docker builds stack)     (code-server + Recharts)
```

1. **Room Creation:** Authenticate or join a room instance. A unique `roomId` creates a collaborative session.
2. **Infrastructure Design:** Drag runtime nodes from the sidebar onto the ReactFlow canvas (e.g., PostgreSQL, Redis, Python). Nodes define the multi-container configuration for the room.
3. **Workspace Provisioning:** Enter a target Git repository URL and click **Launch**. The backend:
   * Clones the repository into an isolated directory (`workspaces/<roomId>/<userId>`).
   * Detects project dependencies (`package.json`, `requirements.txt`).
   * Generates a tailor-made `docker-compose.yml`.
   * Provisions `code-server` on a dynamic port (`9000-9500`) and mounts the code volume.
   * Auto-links any dragged database or cache containers to the shared `cloud-net` network.
4. **Interactive Coding & Telemetry:** Write code inside the embedded editor while real-time CPU, RAM, and energy metrics stream to the live comparison dashboard.

---

## Service Networking & Container Discovery

When working inside a provisioned workspace terminal (`workspace-core`), helper containers are accessible across the shared `cloud-net` Docker network using their generated container hostnames:

| Canvas Service Node | Container Name Pattern | Internal Port | Host Port Range |
|---|---|---|---|
| **VS Code Core** | `workspace-core-<roomId>` | `8080` (Editor), `3000` (Web) | `9000+` / `10000+` |
| **Python Worker** | `workspace-python-<roomId>` | N/A (Volume mount) | N/A |
| **Redis Cache** | `workspace-redis-<roomId>` | `6379` | `9200+` |
| **PostgreSQL** | `workspace-postgres-<roomId>` | `5432` | `9300+` |
| **MongoDB** | `workspace-mongo-<roomId>` | `27017` | `9400+` |

To connect directly to adjacent database containers from inside your code-server terminal:
```bash
# Verify running stack services
docker ps

# Enter the MongoDB container shell
docker exec -it $(docker ps -q -f name=mongo) mongosh

# Enter the Redis container CLI
docker exec -it $(docker ps -q -f name=redis) redis-cli
```

---

## Research & Heuristic Models

CloudFlow incorporates comparative profiling for cloud container allocation under dynamic workloads:

* **DVFS (Dynamic Voltage & Frequency Scaling):** Baseline governor model adjusting processor operating frequencies according to compute utilization thresholds.
* **PSO (Particle Swarm Optimization):** Heuristic optimization algorithm exploring the multidimensional search space of CPU/RAM limits to minimize latency while cutting power draw.
* **ACO (Ant Colony Optimization):** Pheromone-weighted routing and scheduling heuristic optimizing placement of transient container workloads across cluster nodes.

The metrics engine calculates running Joules/Watt-hour estimates across CPU and memory baselines, plotting results live on the client telemetry chart.

---

## Deployment (Production VPS)

To deploy CloudFlow to an Ubuntu Linux host:

1. **Firewall:** Open ports `80`, `443`, and the dynamic allocation range `9000-9500`:
   ```bash
   sudo ufw allow 22/tcp
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   sudo ufw allow 9000:9500/tcp
   sudo ufw enable
   ```
2. **Reverse Proxy:** Configure Nginx with WebSocket upgrade directives (`Upgrade $http_upgrade`, `Connection "upgrade"`) for Socket.IO and the dynamic `code-server` endpoints.
3. **Process Supervision:** Manage the Node.js API with PM2 (`pm2 start server.js --name cloudflow-api`).

---

## Contributing

1. Fork the repository.
2. Create your feature branch (`git checkout -b feature/dynamic-scaling`).
3. Commit your changes (`git commit -m "Add dynamic node memory constraints"`).
4. Push to the branch (`git push origin feature/dynamic-scaling`).
5. Open a Pull Request.

---

## License

Distributed under the MIT License. See `LICENSE` for more information.
