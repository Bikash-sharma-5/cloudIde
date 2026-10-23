import React, { useState } from 'react';

export default function QALab({ activeUsers, roomId }) {
  const [bug, setBug] = useState("");
  const [target, setTarget] = useState("");

  const submitBug = () => {
    if (!bug || !target) return alert("Select a dev and describe the bug");
    socket.emit("report-bug", { roomId, targetUserId: target, bugDetails: bug });
    setBug("");
    alert("Bug report sent to developer's workspace!");
  };

  return (
    <div className="qa-lab-panel glass">
      <h3>🧪 QA Testing Lab</h3>
      <div className="qa-form">
        <label>Target Developer:</label>
        <select onChange={(e) => setTarget(e.target.value)}>
          <option value="">Select Dev...</option>
          {activeUsers.map(u => <option key={u.userId} value={u.userId}>{u.name}</option>)}
        </select>

        <textarea 
          placeholder="Describe the bug found in this branch..." 
          value={bug}
          onChange={(e) => setBug(e.target.value)}
        />
        <button onClick={submitBug} className="btn-bug">🚨 Report Bug</button>
      </div>
    </div>
  );
}