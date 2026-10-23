import { useState } from "react";
import { Link } from "react-router-dom";

export default function RoomList({ rooms, userId, filtered }) {
  const [copied, setCopied] = useState("");

  const copyId = async (id) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(id);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      /* clipboard blocked: ignore */
    }
  };

  if (rooms.length === 0) {
    return (
      <div className="db-empty">
        {filtered
          ? "No rooms match your search."
          : "No rooms yet. Create one above, or join a teammate's room with its ID."}
      </div>
    );
  }

  return (
    <ul className="db-rooms">
      {rooms.map((r) => {
        const ownerId = String(r.owner?._id || r.owner || "");
        const isOwner = userId && ownerId === String(userId);
        const members = r.memberCount ?? (r.members?.length || 0) + 1;

        return (
          <li className="db-room" key={r._id}>
            <div className="db-room-name">
              <Link to={`/room/${r._id}`}>{r.name}</Link>
              {isOwner && <span className="db-tag">Owner</span>}
            </div>

            <button className="db-id" onClick={() => copyId(r._id)} title="Copy room ID to share">
              …{r._id.slice(-8)} <em>{copied === r._id ? "Copied" : "Copy"}</em>
            </button>

            <div className="db-meta">{members} {members === 1 ? "member" : "members"}</div>
            <div className="db-meta">
              {r.createdAt ? new Date(r.createdAt).toLocaleDateString() : ""}
            </div>

            <Link className="db-open" to={`/room/${r._id}`}>Open</Link>
          </li>
        );
      })}
    </ul>
  );
}