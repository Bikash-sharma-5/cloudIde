import axios from "axios";

// Normalize baseURL so it does not contain a trailing slash or accidental double /api
let rawBaseUrl = import.meta.env?.VITE_API_URL || "https://collabide.duckdns.org/api";
rawBaseUrl = rawBaseUrl.replace(/\/+$/, "");

const API = axios.create({
  baseURL: rawBaseUrl,
  headers: {
    "Content-Type": "application/json"
  }
});

// Attach auth token automatically if present in localStorage
API.interceptors.request.use((config) => {
  try {
    const storedUser = JSON.parse(localStorage.getItem("user") || "{}");
    const token = storedUser?.token || storedUser?.data?.token;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
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
export const createWorkspace = (data) => API.post("/workspace/create", data);

export const syncInfrastructure = (data) => API.post("/workspace/sync", data);

export const getFiles = (roomId, userId) =>
  API.get(`/workspace/files/${roomId}/${userId}`);

export const getFileContent = (roomId, userId, filePath) =>
  API.get("/workspace/file", {
    params: { roomId, userId, filePath }
  });

export const saveFile = (data) => API.post("/workspace/save", data);

export const readFile = (roomId, userId, file) =>
  API.get(`/workspace/file/${roomId}/${userId}`, {
    params: { file }
  });

export const pushChanges = (roomId, userId, message) =>
  API.post(`/workspace/push/${roomId}/${userId}`, { message });

export default API;