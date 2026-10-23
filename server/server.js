require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const connectDB = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const roomRoutes = require("./routes/roomRoutes");
const workspaceRoutes = require("./routes/workspaceRoutes");
const setupSocketLogic = require("./sockets/editorSocket"); // Renamed for clarity

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Database
connectDB();

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/rooms", roomRoutes);
app.use("/api/workspace", workspaceRoutes);
app.use("/api/metrics", require("./routes/metricsRoutes"));

// Create HTTP Server
const server = http.createServer(app);

// Initialize Socket.io
const io = new Server(server, {
  cors: {
    origin: "*", // In production, replace with your frontend URL
    methods: ["GET", "POST"]
  }
});
global.ioInstance = io;
// Attach Socket Logic
setupSocketLogic(io);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});