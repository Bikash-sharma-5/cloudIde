require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const connectDB = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const roomRoutes = require("./routes/roomRoutes");
const workspaceRoutes = require("./routes/workspaceRoutes");
const setupSocketLogic = require("./sockets/editorSocket");
const workspaceController = require("./controllers/workspaceController");

const app = express();

// Middleware
app.use(cors({ origin: "*" }));
app.use(express.json());

// Initialize MongoDB Database
connectDB();

// API Routes
app.use("/api", require("./routes/optimizerRoutes"));
app.use("/api/auth", authRoutes);
app.use("/api/rooms", roomRoutes);
app.use("/api/workspace", workspaceRoutes);
app.use("/api/metrics", require("./routes/metricsRoutes"));

// Create HTTP Server
const server = http.createServer(app);

// Initialize Socket.io
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

global.ioInstance = io;

// Wire up Socket handlers
if (workspaceController && typeof workspaceController.attachIO === "function") {
  workspaceController.attachIO(io);
}
setupSocketLogic(io);

// Default to 5050 to avoid port 5000 conflicts
const PORT = process.env.PORT || 5050;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});