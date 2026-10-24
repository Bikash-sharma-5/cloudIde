import axios from "axios";

// Automatically uses VITE_API_URL in production or defaults to localhost:5050 (or 5000)
const baseURL = import.meta.env?.VITE_API_URL || "http://localhost:5050/api";

const API = axios.create({
  baseURL,
  headers: {
    "Content-Type": "application/json"
  }
});

// Attach auth token automatically if present in localStorage
API.interceptors.request.use((config) => {
  try {
    const storedUser = JSON.parse(localStorage.getItem("user") || "{}");
    if (storedUser?.token) {
      config.headers.Authorization = `Bearer ${storedUser.token}`;
    }
  } catch {
    // Ignore JSON parse errors
  }
  return config;
});

/* --------------------------
   ROOM APIs
---------------------------*/
export const getRooms = () => API.get("/rooms");

export const createRoom = (data) => API.post("/rooms/create", data);

/* --------------------------
   WORKSPACE APIs
---------------------------*/
export const createWorkspace = (data) =>
  API.post("/workspace/create", data);

// Sync dragged nodes & infrastructure topology to Docker
export const syncInfrastructure = (data) =>
  API.post("/workspace/sync", data);

export const getFiles = (roomId, userId) =>
  API.get(`/workspace/files/${roomId}/${userId}`);

export const getFileContent = (roomId, userId, filePath) =>
  API.get("/workspace/file", {
    params: { roomId, userId, filePath }
  });

export const saveFile = (data) =>
  API.post("/workspace/save", data);

export const readFile = (roomId, userId, file) =>
  API.get(`/workspace/file/${roomId}/${userId}`, {
    params: { file }
  });

export const pushChanges = (roomId, userId, message) =>
  API.post(`/workspace/push/${roomId}/${userId}`, { message });

export default API;