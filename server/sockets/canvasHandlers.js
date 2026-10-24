// sockets/canvasHandlers.js
// Keeps each room's canvas on the server so people who join or re-enter see it.
const Canvas = require("../models/Canvas");

const cache = new Map();       // roomId -> Promise<state>  (hot copy in memory)
const MAX_NODES = 200;
const MAX_OPS = 50;

function load(roomId) {
  if (!cache.has(roomId)) {
    cache.set(
      roomId,
      Canvas.findOne({ roomId }).lean().then((doc) => ({
        nodes: doc?.nodes || [],
        edges: doc?.edges || [],
        workspace: doc?.workspace || { ready: false, port: null, repoUrl: "" },
        timer: null
      }))
    );
  }
  return cache.get(roomId);
}

// debounce saves so dragging does not hit the database on every move
function persist(roomId, s) {
  clearTimeout(s.timer);
  s.timer = setTimeout(() => {
    Canvas.updateOne(
      { roomId },
      { $set: { nodes: s.nodes, edges: s.edges, workspace: s.workspace } },
      { upsert: true }
    ).catch((e) => console.error("Canvas save failed:", e.message));
  }, 800);
}

function persistNow(roomId, s) {
  clearTimeout(s.timer);
  Canvas.updateOne(
    { roomId },
    { $set: { nodes: s.nodes, edges: s.edges, workspace: s.workspace } },
    { upsert: true }
  ).catch((e) => console.error("Canvas save failed:", e.message));
}

function apply(s, ops) {
  for (const op of ops) {
    switch (op?.type) {
      case "node:add":
        if (op.node?.id && s.nodes.length < MAX_NODES && !s.nodes.some((n) => n.id === op.node.id))
          s.nodes.push(op.node);
        break;
      case "node:move":
        s.nodes = s.nodes.map((n) => (n.id === op.id ? { ...n, position: op.position } : n));
        break;
      case "node:data": {   // version / cpu / memory / replicas edits from the inspector
        const allowed = ["version", "label", "cpu", "memMB", "replicas"];
        const patch = Object.fromEntries(Object.entries(op.data || {}).filter(([k]) => allowed.includes(k)));
        s.nodes = s.nodes.map((n) => (n.id === op.id ? { ...n, data: { ...n.data, ...patch } } : n));
        break;
      }
      case "node:remove":
        s.nodes = s.nodes.filter((n) => n.id !== op.id);
        s.edges = s.edges.filter((e) => e.source !== op.id && e.target !== op.id);
        break;
      case "edge:add":
        if (op.edge?.id && !s.edges.some((e) => e.id === op.edge.id)) s.edges.push(op.edge);
        break;
      case "edge:remove":
        s.edges = s.edges.filter((e) => e.id !== op.id);
        break;
    }
  }
}

module.exports = (io, socket) => {
  // send the saved canvas to whoever joins (first time or coming back)
  socket.on("join-room", async ({ roomId }) => {
    const s = await load(roomId);
    console.log(`[canvas] sent state to ${socket.id}: ${s.nodes.length} nodes (room ${roomId})`);
    socket.emit("canvas-state", { nodes: s.nodes, edges: s.edges, workspace: s.workspace });
  });

  socket.on("canvas-ops", async ({ roomId, ops }) => {
    if (!socket.rooms.has(roomId) || !Array.isArray(ops) || ops.length > MAX_OPS) return;
    const s = await load(roomId);
    apply(s, ops);
    console.log(`[canvas] ${ops.length} op(s) from ${socket.userName} in room ${roomId}`);
    persist(roomId, s);
    socket.to(roomId).emit("canvas-ops", { ops, by: socket.userName }); // everyone except sender
  });

  // The first launch saves the repo URL for the whole room.
  // Later launches (by anyone) keep the saved URL, so nobody has to type it again.
  socket.on("workspace-created", async ({ roomId, port, repoUrl }) => {
    if (!socket.rooms.has(roomId)) return;
    const s = await load(roomId);
    s.workspace = {
      ready: true,
      port: port ?? s.workspace.port,
      repoUrl: s.workspace.repoUrl || (typeof repoUrl === "string" ? repoUrl.trim() : "")
    };
    persistNow(roomId, s); // save right away, not debounced
    io.to(roomId).emit("workspace-ready", s.workspace);
  });
};

// lets the optimizer read the saved canvas (used by the simulated workload)
module.exports.getNodes = async (roomId) => (await load(roomId)).nodes;
