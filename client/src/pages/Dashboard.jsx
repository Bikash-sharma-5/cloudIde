import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";
import RoomList from "../components/RoomList";
import { APP_NAME } from "./AuthLayout";
import "./Dashboard.css";

// accepts a raw room ID or a full link like https://app/room/<id>
const parseRoomId = (text) => (text.match(/[a-f0-9]{24}/i) || [""])[0];

export default function Dashboard() {
  const nav = useNavigate();
  const token = localStorage.getItem("token");
  const headers = { Authorization: token };

  let user = {};
  try { user = JSON.parse(localStorage.getItem("user") || "{}"); } catch { user = {}; }

  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");          // "create" | "join" | ""
  const [name, setName] = useState("");
  const [joinText, setJoinText] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadRooms = async () => {
    try {
      const res = await api.get("/rooms", { headers });
      setRooms(Array.isArray(res.data) ? res.data : []);
    } catch {
      setError("Couldn't load your rooms. Check your connection and refresh.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadRooms(); }, []);

  const createRoom = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError(""); setNotice(""); setBusy("create");
    try {
      await api.post("/rooms", { name: name.trim() }, { headers });
      setName("");
      setNotice("Room created.");
      await loadRooms();
    } catch (err) {
      setError(err.response?.data?.message || "Couldn't create the room.");
    } finally {
      setBusy("");
    }
  };

  const joinRoom = async (e) => {
    e.preventDefault();
    const roomId = parseRoomId(joinText);
    if (!roomId) return setError("Paste a valid room ID or invite link.");
    setError(""); setNotice(""); setBusy("join");
    try {
      await api.post("/rooms/join", { roomId }, { headers });   // adds you as a member
      nav(`/room/${roomId}`);
    } catch (err) {
      setError(err.response?.data?.message || "Couldn't join that room.");
      setBusy("");
    }
  };

  const logout = () => {
    ["token", "user", "userId"].forEach((k) => localStorage.removeItem(k));
    nav("/");
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rooms.filter((r) => r.name?.toLowerCase().includes(q)) : rooms;
  }, [rooms, query]);

  return (
    <div className="db-page">
      <aside className="db-side">
        <div className="db-brand">{APP_NAME}</div>
        <nav className="db-nav"><span>Rooms</span></nav>
        <div className="db-user">
          <strong>{user.fullName || user.name || "Signed in"}</strong>
          <button className="db-logout" onClick={logout}>Log out</button>
        </div>
      </aside>

      <main className="db-main">
        <div className="db-wrap">
          <h1>Your rooms</h1>
          <p className="db-lead">Create a room for your team, or join one with its ID.</p>

          {error && <p className="db-msg db-msg-error" role="alert">{error}</p>}
          {notice && !error && <p className="db-msg db-msg-ok" role="status">{notice}</p>}

          <div className="db-actions">
            <form className="db-panel" onSubmit={createRoom}>
              <h2>Create a room</h2>
              <p>Starts an empty shared workspace you own.</p>
              <div className="db-row">
                <input className="db-input" placeholder="Room name" value={name}
                  onChange={(e) => setName(e.target.value)} />
                <button className="db-btn" disabled={busy === "create" || !name.trim()}>
                  {busy === "create" ? "Creating…" : "Create"}
                </button>
              </div>
            </form>

            <form className="db-panel" onSubmit={joinRoom}>
              <h2>Join a room</h2>
              <p>Paste the room ID or link a teammate shared with you.</p>
              <div className="db-row">
                <input className="db-input" placeholder="Room ID or link" value={joinText}
                  onChange={(e) => setJoinText(e.target.value)} />
                <button className="db-btn db-btn-ghost" disabled={busy === "join" || !joinText.trim()}>
                  {busy === "join" ? "Joining…" : "Join"}
                </button>
              </div>
            </form>
          </div>

          <div className="db-list-head">
            <h2>Rooms</h2>
            <span className="db-count">{rooms.length}</span>
            <input className="db-input db-search" placeholder="Search rooms" value={query}
              onChange={(e) => setQuery(e.target.value)} />
          </div>

          {loading ? (
            <div className="db-empty">Loading rooms…</div>
          ) : (
            <RoomList rooms={visible} userId={user._id} filtered={!!query.trim()} />
          )}
        </div>
      </main>
    </div>
  );
}