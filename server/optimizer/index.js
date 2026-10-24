"use strict";
const { RoomController } = require("./controller");
const { MODES } = require("./algorithms");

const controllers = new Map();
const VALID = new Set(["OBSERVE", ...MODES]);

function get(io, roomId, getNodes) {
  if (!controllers.has(roomId)) controllers.set(roomId, new RoomController(io, roomId, getNodes));
  return controllers.get(roomId);
}

// call inside io.on("connection", ...) after registerCanvasHandlers
function registerOptimizer(io, socket, getNodes) {
  socket.on("join-room", ({ roomId }) => {
    const c = get(io, roomId, getNodes);
    c.start();
    socket.emit("optimizer-mode", { mode: c.mode, modes: ["OBSERVE", ...MODES] });
  });

  socket.on("set-optimizer-mode", ({ roomId, mode }) => {
    if (!socket.rooms.has(roomId) || !VALID.has(mode)) return;
    const c = controllers.get(roomId);
    if (!c) return;
    c.setMode(mode);
    io.to(roomId).emit("optimizer-mode", { mode });
    io.to(roomId).emit("activity-log", `Optimizer mode set to ${mode} by ${socket.userName}`);
  });
}

function releaseRoom(roomId) {            // call when the last user leaves
  const c = controllers.get(roomId);
  if (c) { c.stop(); controllers.delete(roomId); }
}

module.exports = { registerOptimizer, releaseRoom };
