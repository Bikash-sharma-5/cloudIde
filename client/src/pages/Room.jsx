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
import MetricsPanel from "./MetricsPanel";
import "./Room.css";

const API_URL = import.meta.env?.VITE_API_URL || "http://localhost:5050/api";// move to an env variable before deploying

// Used only if GET /api/catalog fails. The real list (with versions) lives on the server.
const FALLBACK_CATALOG = [
  { type: "node", label: "Node.js", versions: ["20"], defaultVersion: "20", color: "#3c873a", cpu: 0.5, memMB: 256 },
  { type: "python", label: "Python", versions: ["3.11"], defaultVersion: "3.11", color: "#3572A5", cpu: 0.5, memMB: 256 },
  { type: "redis", label: "Redis", versions: ["7"], defaultVersion: "7", color: "#dc382d", cpu: 0.25, memMB: 128 },
  { type: "postgres", label: "PostgreSQL", versions: ["16"], defaultVersion: "16", color: "#336791", cpu: 0.5, memMB: 512 },
  { type: "mongodb", label: "MongoDB", versions: ["7"], defaultVersion: "7", color: "#13aa52", cpu: 0.5, memMB: 512 },
];

const initials = (name = "?") =>
  name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

// Apply canvas operations (same logic runs on the server)
function applyNodeOps(nodes, ops) {
  return ops.reduce((acc, op) => {
    if (op.type === "node:add") return acc.some((n) => n.id === op.node.id) ? acc : [...acc, op.node];
    if (op.type === "node:move") return acc.map((n) => (n.id === op.id ? { ...n, position: op.position } : n));
    if (op.type === "node:data") return acc.map((n) => (n.id === op.id ? { ...n, data: { ...n.data, ...op.data } } : n));
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

function makeNode(svc, position, userName, version) {
  const v = version && svc.versions.includes(version) ? version : svc.defaultVersion;
  return {
    id: `${svc.type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: "default",
    position,
    data: { label: `${svc.label} ${v}`, baseLabel: svc.label, serviceType: svc.type, version: v, cpu: svc.cpu, memMB: svc.memMB, replicas: 1, addedBy: userName },
    style: { border: `2px solid ${svc.color}`, borderRadius: "8px", padding: "10px", fontWeight: 600 },
  };
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

  const [catalog, setCatalog] = useState(FALLBACK_CATALOG);
  const [selectedId, setSelectedId] = useState(null);
  const [detected, setDetected] = useState(null);          // { services, conflicts }
  const [showOptimizer, setShowOptimizer] = useState(false);
  const [optimizer, setOptimizer] = useState({ mode: "OBSERVE", modes: ["OBSERVE"] });
  const [series, setSeries] = useState({});                 // algorithm -> [{t, power, util, unmet}]
  const [liveContainers, setLiveContainers] = useState([]);
  const [allocation, setAllocation] = useState(null);
  const [dataSource, setDataSource] = useState("");
  const [hostWatts, setHostWatts] = useState(null);
  const syncTimer = useRef(null);

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

  useEffect(() => {
    api.get("/catalog").then(({ data }) => Array.isArray(data) && data.length && setCatalog(data)).catch(() => {});
  }, []);

  // Repo URL + "workspace ready" live on the room in the database,
  // so every member sees the same thing, even before the socket connects.
  useEffect(() => {
    const headers = { Authorization: localStorage.getItem("token") };
    api
      .post("/rooms/join", { roomId: id }, { headers })          // idempotent: opening a link joins the room
      .catch((err) => {
        if (err.response?.status === 404) setNotice("This room doesn't exist.");
      })
      .then(() => api.get(`/rooms/${id}`, { headers }))
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

    socket.on("optimizer-mode", (d) => setOptimizer((o) => ({ mode: d.mode, modes: d.modes || o.modes })));
    socket.on("container-metrics", (d) => { setLiveContainers(Array.isArray(d.containers) ? d.containers : []); setDataSource(d.source); setHostWatts(d.hostWatts); });
    socket.on("allocation-update", (d) => setAllocation(d));
    socket.on("metrics-update", (m) => {
      if (!m?.algorithm) return;
      const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);   // old/foreign payloads may lack fields
      setSeries((prev) => ({
        ...prev,
        [m.algorithm]: [...(prev[m.algorithm] || []), { t: m.time, power: num(m.energy), util: num(m.cpu), unmet: num(m.unmet) }].slice(-60),
      }));
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

      const { type } = JSON.parse(raw);
      const service = catalog.find((c) => c.type === type);
      if (!service) return;
      // screenToFlowPosition respects zoom and pan
      const position = screenToFlowPosition({ x: event.clientX - 75, y: event.clientY - 20 });

      const newNode = makeNode(service, position, userName);
      setNodes((nds) => [...nds, newNode]);
      sendOps([{ type: "node:add", node: newNode }]);
      triggerBackendSync([...nodesRef.current, newNode]);
    },
    [catalog, screenToFlowPosition, sendOps, triggerBackendSync, userName]
  );

  // Inspector: change version / CPU / memory / replicas of the selected node
  const updateNodeData = useCallback(
    (nid, patch) => {
      setNodes((nds) => nds.map((n) => (n.id === nid ? { ...n, data: { ...n.data, ...patch } } : n)));
      sendOps([{ type: "node:data", id: nid, data: patch }]);
      clearTimeout(syncTimer.current);                         // re-provision once the user stops editing
      syncTimer.current = setTimeout(() => triggerBackendSync(nodesRef.current), 700);
    },
    [sendOps, triggerBackendSync]
  );

  // Repo analysis: suggest services + versions, report conflicting pins
  const detectFromRepo = async () => {
    try {
      const { data } = await api.get("/detect", { params: { roomId: id, userId }, headers: { Authorization: localStorage.getItem("token") } });
      setDetected(data);
    } catch {
      setNotice("Couldn't analyse the repo yet. Launch the workspace first.");
    }
  };

  const addSuggested = () => {
    const have = new Set(nodesRef.current.map((n) => n.data?.serviceType));
    const fresh = (detected?.services || []).filter((s) => !have.has(s.type));
    const added = fresh
      .map((s, i) => {
        const svc = catalog.find((c) => c.type === s.type);
        return svc ? makeNode(svc, { x: 40 + i * 230, y: 40 }, userName, s.version) : null;
      })
      .filter(Boolean);
    if (!added.length) return;
    setNodes((nds) => [...nds, ...added]);
    sendOps(added.map((node) => ({ type: "node:add", node })));
    triggerBackendSync([...nodesRef.current, ...added]);
  };

  const setMode = (mode) => socketRef.current?.emit("set-optimizer-mode", { roomId: id, mode });

  const exportCsv = async () => {
    try {
      const res = await api.get("/metrics/export", { params: { roomId: id }, headers: { Authorization: localStorage.getItem("token") }, responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url; a.download = `metrics-${id}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch { setNotice("Export failed."); }
  };

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

  const selected = nodes.find((n) => n.id === selectedId);
  const selectedSvc = selected && catalog.find((c) => c.type === selected.data?.serviceType);
  const repoLabel = savedRepoUrl.replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\.git$/, "");

  return (
    <div className="rm-page">
      {/* TOP BAR: navigation + status only */}
      <header className="rm-top">
        <Link to="/dashboard" className="rm-back">← Rooms</Link>
        <span className="rm-code" title={id}>Room …{id.slice(-6)}</span>
        <span className="rm-spacer" />
        {syncingInfra && <span className="rm-badge">Provisioning containers…</span>}
        <span className={`rm-conn ${connected ? "" : "off"}`}><i />{connected ? "Live" : "Reconnecting…"}</span>
        <button className={`rm-copy ${showOptimizer ? "active" : ""}`} onClick={() => setShowOptimizer((v) => !v)}>
          Optimizer{optimizer.mode !== "OBSERVE" ? ` · ${optimizer.mode.toLowerCase().replace("_", " ")}` : ""}
        </button>
        <button className="rm-copy" onClick={copyRoomId}>{copied ? "Copied" : "Copy room ID"}</button>
      </header>

      <div className="rm-body">
        {/* LEFT: palette, repo detection, people */}
        <aside className="rm-side">
          <section className="rm-section">
            <h4>Services</h4>
            <p className="rm-hint">Drag onto the canvas. Each node runs in its own container with the version you pick.</p>
            {catalog.map((c) => (
              <div
                key={c.type}
                className="rm-svc"
                style={{ "--svc": c.color }}
                draggable
                onDragStart={(e) => e.dataTransfer.setData("application/reactflow", JSON.stringify({ type: c.type }))}
              >
                {c.label}
                <span className="rm-ver">{c.versions.join(" · ")}</span>
              </div>
            ))}
          </section>

          {isInitialized && (
            <section className="rm-section">
              <h4>Repo environment</h4>
              <button className="rm-copy dark" onClick={detectFromRepo}>Detect versions from repo</button>
              {detected && (
                <div className="rm-detected">
                  {detected.conflicts?.map((c, i) => (
                    <p key={i} className="rm-conflict">
                      Version conflict ({c.type}): {c.a.source} says {c.a.version}, {c.b.source} says {c.b.version}. Using {c.a.version}.
                    </p>
                  ))}
                  {detected.services.length === 0 && <p className="rm-hint">Nothing detected.</p>}
                  {detected.services.map((d) => (
                    <p key={d.type} className="rm-found"><b>{d.type} {d.version}</b><em>{d.source}</em></p>
                  ))}
                  {detected.services.length > 0 && (
                    <button className="rm-copy dark" onClick={addSuggested}>Add missing to canvas</button>
                  )}
                </div>
              )}
            </section>
          )}

          <section className="rm-section rm-users">
            <h4>In this room ({activeUsers.length})</h4>
            {activeUsers.length === 0 && <p className="rm-empty">Just you for now.</p>}
            {activeUsers.map((u) => (
              <div className="rm-user" key={u.userId}>
                <span className="rm-avatar">{initials(u.name)}</span>
                <span className="rm-uname">{u.name}</span>
                {u.userId === userId && <span className="rm-you">you</span>}
              </div>
            ))}
          </section>
        </aside>

        <main className="rm-main">
          {/* TOOLBAR: launch controls live here, not on top of the nodes */}
          <div className="rm-toolbar">
            {isInitialized ? (
              <>
                <span className="rm-repo" title={savedRepoUrl}>{repoLabel || "Workspace ready"}</span>
                <span className="rm-spacer" />
                <button className="rm-primary" onClick={startWorkspace} disabled={loading}>
                  {loading ? "Opening…" : "Open code workspace"}
                </button>
              </>
            ) : (
              <>
                <input
                  className="rm-url"
                  placeholder="GitHub repo URL (asked once per room)"
                  value={repoUrl}
                  disabled={loading}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && repoUrl.trim() && startWorkspace()}
                />
                <button className="rm-primary" onClick={startWorkspace} disabled={loading || !repoUrl.trim()}>
                  {loading ? "Starting containers…" : "Launch infrastructure"}
                </button>
              </>
            )}
          </div>

          <div className="rm-canvas">
            {notice && (
              <div className="rm-notice" role="alert">
                {notice}
                <button onClick={() => setNotice("")} aria-label="Dismiss">×</button>
              </div>
            )}

            {nodes.length === 0 && (
              <div className="rm-emptyhint">Drag a service from the left to start building this room.</div>
            )}

            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onNodeClick={(_, node) => setSelectedId(node.id)}
              onPaneClick={() => setSelectedId(null)}
              fitView
            >
              <Background />
              <Controls position="bottom-left" />
            </ReactFlow>

            {/* floating inspector for the selected node */}
            {selected && selectedSvc && (
              <aside className="rm-inspector">
                <div className="rm-inspector-head">
                  <h4>{selected.data.baseLabel || selectedSvc.label}</h4>
                  <button onClick={() => setSelectedId(null)} aria-label="Close">×</button>
                </div>
                <label>Version
                  <select value={selected.data.version}
                    onChange={(e) => updateNodeData(selected.id, { version: e.target.value, label: `${selected.data.baseLabel || selectedSvc.label} ${e.target.value}` })}>
                    {selectedSvc.versions.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </label>
                <label>CPU request (cores)
                  <input type="number" min="0.1" max="8" step="0.25" value={selected.data.cpu}
                    onChange={(e) => updateNodeData(selected.id, { cpu: Math.min(8, Math.max(0.1, +e.target.value || 0.1)) })} />
                </label>
                <label>Memory (MB)
                  <input type="number" min="64" max="8192" step="64" value={selected.data.memMB}
                    onChange={(e) => updateNodeData(selected.id, { memMB: Math.min(8192, Math.max(64, +e.target.value || 64)) })} />
                </label>
                <label>Replicas
                  <input type="number" min="1" max="10" step="1" value={selected.data.replicas}
                    onChange={(e) => updateNodeData(selected.id, { replicas: Math.min(10, Math.max(1, Math.round(+e.target.value || 1))) })} />
                </label>
              </aside>
            )}
          </div>

          {showOptimizer && (
            <MetricsPanel
              series={series}
              containers={liveContainers}
              allocation={allocation}
              mode={optimizer.mode}
              modes={optimizer.modes}
              onMode={setMode}
              onExport={exportCsv}
              source={dataSource}
              hostWatts={hostWatts}
            />
          )}
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