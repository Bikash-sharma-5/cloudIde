import { io } from "socket.io-client";

// In production, reads VITE_SOCKET_URL; in local dev, falls back to port 5050 to avoid port 5000 conflicts
const SOCKET_URL = import.meta.env?.VITE_SOCKET_URL || "http://localhost:5050";

export const socket = io(SOCKET_URL, {
  autoConnect: true,
  transports: ["websocket", "polling"]
});