import { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import api from "../services/api";
import { useParams, Link } from "react-router-dom";
import { io } from "socket.io-client";
import {
  ReactFlow,
  Background,
  Controls,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  ReactFlowProvider,
  useReactFlow
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./Room.css";

const API_URL = "http://localhost:5000"; // move to an env variable before deploying

const AVAILABLE_SERVICES = [
  { type: "node", label: "Node.js Environment", color: "#3c873a" },
  { type: "python", label: "Python 3.11 Worker", color: "#3572A5" },
  { type: "redis", label: "Redis Cache", color: "#dc382d" },
  { type: "postgres", label: "PostgreSQL DB", color: "#336791" },
  { type: "mongodb", label: "MongoDB Database", color: "#13aa52" }
];

const initials = (name = "?") =>
  name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

// Apply canvas operations (same logic runs on the server)
function applyNodeOps(nodes, ops) {
  return ops.reduce((acc, op) => {
    if (op.type === "node:add") return acc.some((n) => n.id === op.node.id) ? acc : [...acc, op.node];
    if (op.type === "node:move") return acc.map((n) => (n.id === op.id ? { ...n, position: op.position } : n));
    if (op.type === "node:remove") return acc.filter((n) => n.id !== op.id);
    return acc;
  }, nodes);
}
function applyEdgeOps(edges, ops) {
  return ops.reduce((acc, op) => {
    if (op.type === "edge:add") return acc.some((e) => e.id === op.edge.id) ? acc : [...acc, op.edge];
    if (op.type === "edge:remove") return acc.filter((e) => e.id !== op.id);
    return acc;
  }, edges);
}

function RoomContent() {
  const { id } = useParams();
  const { screenToFlowPosition, fitView } = useReactFlow();
  const fitViewRef = useRef(fitView);
  fitViewRef.current = fitView;

  let storedUser = {};
  try { storedUser = JSON.parse(localStorage.getItem("user") || "{}"); } catch { storedUser = {}; }

  // guest id must be created once, not on every render
  const [guestId] = useState(() => "guest-" + Math.random().toString(36).slice(2));
  const userId = storedUser?._id || guestId;
  const userName = storedUser?.fullName || storedUser?.name || "Guest";

  const [repoUrl, setRepoUrl] = useState("");
  const [isInitialized, setIsInitialized] = useState(false);
  const [savedRepoUrl, setSavedRepoUrl] = useState(""); // set once per room, reused after
  const [loading, setLoading] = useState(false);
  const [syncingInfra, setSyncingInfra] = useState(false);
  const [activeUsers, setActiveUsers] = useState([]);
  const [connected, setConnected] = useState(false);
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);

  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [assignedPort, setAssignedPort] = useState(9000);

  const nodesRef = useRef([]);
  const socketRef = useRef(null);
  const lastMoveSent = useRef(0);

  useEffect(() => { nodesRef.current = nodes; }, [nodes]);

  const sendOps = useCallback(
    (ops) => { if (ops.length) socketRef.current?.emit("canvas-ops", { roomId: id, ops }); },
    [id]
  );

  // Sync topology to the Docker backend
  const triggerBackendSync = useCallback(
    async (updatedNodes) => {
      if (!isInitialized) return;
      try {
        setSyncingInfra(true);
        await axios.post(`${API_URL}/api/workspace/sync`, { roomId: id, userId, nodes: updatedNodes, assignedPort });
      } catch (err) {
        console.error("Infrastructure sync error:", err);
      } finally {
        setSyncingInfra(false);
      }
    },
    [id, userId, isInitialized, assignedPort]
  );

  // Repo URL + "workspace ready" live on the room in the database,
  // so every member sees the same thing, even before the socket connects.
  useEffect(() => {
    api
      .get(`/rooms/${id}`, { headers: { Authorization: localStorage.getItem("token") } })
      .then(({ data }) => {
        if (data.workspaceReady) {
          setIsInitialized(true);
          setSavedRepoUrl(data.repoUrl || "");
          if (data.workspacePort) setAssignedPort(data.workspacePort);
        }
      })
      .catch(() => {});
  }, [id]);

  // Socket lifecycle
  useEffect(() => {
    const socket = io(API_URL);
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      // on every (re)connect: join and the server replies with the saved canvas
      socket.emit("join-room", { roomId: id, user: { id: userId, name: userName } });
    });
    socket.on("disconnect", () => setConnected(false));

    // Full saved state: sent to you when you enter or re-enter the room
    socket.on("canvas-state", ({ nodes: n = [], edges: e = [], workspace }) => {
      console.log("[room] canvas-state received:", n.length, "nodes");
      setNodes(n);
      setEdges(e);
      if (workspace?.ready) {
        setIsInitialized(true);
        setSavedRepoUrl(workspace.repoUrl || "");
        if (workspace.port) setAssignedPort(workspace.port);
      }
      setTimeout(() => fitViewRef.current({ padding: 0.3, duration: 200 }), 60);
    });

    // Small changes made by other people
    socket.on("canvas-ops", ({ ops }) => {
      setNodes((nds) => applyNodeOps(nds, ops));
      setEdges((eds) => applyEdgeOps(eds, ops));
    });

    socket.on("user-presence-update", (list) => setActiveUsers(Array.isArray(list) ? list : []));

    socket.on("workspace-ready", (data) => {
      setIsInitialized(true);
      if (data?.repoUrl) setSavedRepoUrl(data.repoUrl);
      if (data?.port) setAssignedPort(data.port);
    });

    return () => socket.disconnect();
  }, [id, userId, userName]);

  // Canvas callbacks (state is updated purely; changes are turned into small ops)
  const onNodesChange = useCallback(
    (changes) => {
      setNodes((nds) => applyNodeChanges(changes, nds));

      const ops = [];
      const now = Date.now();
      for (const c of changes) {
        if (c.type === "position" && c.position) {
          const finishing = c.dragging === false;
          if (finishing || now - lastMoveSent.current > 60) {
            ops.push({ type: "node:move", id: c.id, position: c.position });
            lastMoveSent.current = now;
          }
        } else if (c.type === "remove") {
          ops.push({ type: "node:remove", id: c.id });
        }
      }
      sendOps(ops);

      const removed = changes.filter((c) => c.type === "remove").map((c) => c.id);
      if (removed.length) triggerBackendSync(nodesRef.current.filter((n) => !removed.includes(n.id)));
    },
    [sendOps, triggerBackendSync]
  );

  const onEdgesChange = useCallback(
    (changes) => {
      setEdges((eds) => applyEdgeChanges(changes, eds));
      sendOps(changes.filter((c) => c.type === "remove").map((c) => ({ type: "edge:remove", id: c.id })));
    },
    [sendOps]
  );

  const onConnect = useCallback(
    (params) => {
      const edge = { ...params, id: `e-${params.source}-${params.target}-${Date.now()}` };
      setEdges((eds) => addEdge(edge, eds));
      sendOps([{ type: "edge:add", edge }]);
    },
    [sendOps]
  );

  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();
      const raw = event.dataTransfer.getData("application/reactflow");
      if (!raw) return;

      const service = JSON.parse(raw);
      // screenToFlowPosition respects zoom and pan
      const position = screenToFlowPosition({ x: event.clientX - 75, y: event.clientY - 20 });

      const newNode = {
        id: `${service.type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: "default",
        position,
        data: { label: service.label, serviceType: service.type, addedBy: userName },
        style: { border: `2px solid ${service.color}`, borderRadius: "8px", padding: "10px", fontWeight: 600 }
      };

      setNodes((nds) => [...nds, newNode]);
      sendOps([{ type: "node:add", node: newNode }]);
      triggerBackendSync([...nodesRef.current, newNode]);
    },
    [screenToFlowPosition, sendOps, triggerBackendSync, userName]
  );

  const startWorkspace = async () => {
    if (loading) return;
    setNotice("");

    // first launch uses what was typed; every launch after that reuses the saved URL
    const repo = savedRepoUrl || repoUrl.trim();
    if (!repo) return setNotice("Enter a GitHub repo URL to launch this room.");

    const win = window.open("", "_blank"); // opened first so popup blockers allow it
    setLoading(true);

    try {
      const res = await axios.post(`${API_URL}/api/workspace/create`, {
        roomId: id, userId, repoUrl: repo, nodes: nodesRef.current
      });

      if (res.data?.editorUrl) {
        if (win) win.location.href = res.data.editorUrl;
        else window.open(res.data.editorUrl, "_blank");
        setIsInitialized(true);
        if (res.data.port) setAssignedPort(res.data.port);
        setSavedRepoUrl(repo);
        api
          .patch(
            `/rooms/${id}/workspace`,
            { repoUrl: repo, port: res.data.port },
            { headers: { Authorization: localStorage.getItem("token") } }
          )
          .catch(() => {});
        socketRef.current?.emit("workspace-created", { roomId: id, port: res.data.port, repoUrl: repo });
      } else {
        win?.close();
        setNotice(res.data?.message || "Workspace is already starting…");
      }
    } catch {
      win?.close();
      setNotice("Failed to start workspace.");
    } finally {
      setLoading(false);
    }
  };

  const copyRoomId = async () => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  return (
    <div className="rm-page">
      <header className="rm-top">
        <Link to="/dashboard">← Rooms</Link>
        <span className="rm-code">…{id.slice(-8)}</span>
        {savedRepoUrl && (
          <span className="rm-code" title={savedRepoUrl}>
            {savedRepoUrl.replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\.git$/, "")}
          </span>
        )}
        {syncingInfra && <span className="rm-badge">Provisioning containers…</span>}
        <span className="rm-spacer" />
        <span className={`rm-conn ${connected ? "" : "off"}`}>{connected ? "Live" : "Reconnecting…"}</span>
        <button className="rm-copy" onClick={copyRoomId}>{copied ? "Copied" : "Copy room ID"}</button>
      </header>

      <div className="rm-body">
        <aside className="rm-side">
          <h4>Services</h4>
          <p className="rm-hint">Drag a service onto the canvas. Everyone in the room sees it.</p>

          {AVAILABLE_SERVICES.map((s) => (
            <div
              key={s.type}
              className="rm-svc"
              style={{ "--svc": s.color }}
              draggable
              onDragStart={(e) => e.dataTransfer.setData("application/reactflow", JSON.stringify(s))}
            >
              {s.label}
            </div>
          ))}

          <div className="rm-users">
            <h4>In this room ({activeUsers.length})</h4>
            {activeUsers.length === 0 && <p className="rm-empty">Just you for now.</p>}
            {activeUsers.map((u) => (
              <div className="rm-user" key={u.userId}>
                <span className="rm-avatar">{initials(u.name)}</span>
                {u.name}
                {u.userId === userId && <span className="rm-you">you</span>}
              </div>
            ))}
          </div>
        </aside>

        <main className="rm-canvas">
          {notice && <div className="rm-notice" role="alert">{notice}</div>}

          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDrop={onDrop}
            onDragOver={onDragOver}
            fitView
          >
            <Background />
            <Controls />
          </ReactFlow>

          <div className="rm-action">
            {!isInitialized && (
              <input placeholder="GitHub repo URL" value={repoUrl} disabled={loading}
                onChange={(e) => setRepoUrl(e.target.value)} />
            )}
            <button onClick={startWorkspace} disabled={loading || (!isInitialized && !repoUrl.trim())}>
              {loading ? "Starting containers…" : isInitialized ? "Open code workspace" : "Launch infrastructure"}
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}

export default function Room() {
  return (
    <ReactFlowProvider>
      <RoomContent />
    </ReactFlowProvider>
  );
}