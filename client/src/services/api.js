import axios from "axios";

const API = axios.create({
  baseURL: "http://localhost:5000/api"
});

/* --------------------------
   ROOM APIs
---------------------------*/

export const getRooms = () => API.get("/rooms");

export const createRoom = (data) =>
  API.post("/rooms/create", data);

/* --------------------------
   WORKSPACE APIs
---------------------------*/

export const createWorkspace = (data) =>
  API.post("/workspace/create", data);

export const getFiles = (roomId, userId) =>
  API.get(`/workspace/files/${roomId}/${userId}`);

export const getFileContent = (roomId, userId, filePath) =>
  API.get("/workspace/file", {
    params: { roomId, userId, filePath }
  });

export const saveFile = (data) =>
  API.post("/workspace/save", data);

/* --------------------------
   EXPORT AXIOS INSTANCE
---------------------------*/
export const readFile = (roomId, userId, file) =>
  API.get(`/workspace/file/${roomId}/${userId}?file=${file}`);
export const pushChanges = (roomId, userId, message) =>
  API.post(`/workspace/push/${roomId}/${userId}`, { message });
export default API;
