const LABELS = {
  OBSERVE: "Observe only (apply nothing)",
  STATIC: "Static allocation",
  K8S: "K8s-style least-requested",
  ACO: "ACO placement",
  PSO: "PSO allocation",
  DVFS: "DVFS only",
  HYBRID: "ACO + PSO + DVFS",
  HYBRID_FC: "ACO + PSO + DVFS + forecast",
};
const fmt = (v, d = 1) => (Number.isFinite(Number(v)) ? Number(v).toFixed(d) : "–");
const COLORS = {
  STATIC: "#98a2b3", K8S: "#667085", ACO: "#12a150", PSO: "#2e90fa",
  DVFS: "#dc8a00", HYBRID: "#7a5af8", HYBRID_FC: "#c2410c",
};

function Lines({ series }) {
  const W = 520, H = 130, pad = 6;
  const all = Object.values(series).flat().map((p) => p.power).filter(Number.isFinite);
  if (all.length < 2) return <p className="rm-empty">Waiting for data…</p>;
  const lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1;
  const maxLen = Math.max(...Object.values(series).map((a) => a.length));
  const pt = (v, i, n) => `${pad + (i / Math.max(1, maxLen - 1)) * (W - 2 * pad)},${H - pad - ((v - lo) / span) * (H - 2 * pad)}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="rm-chart" role="img" aria-label="Modelled power per strategy over time">
      {Object.entries(series).map(([algo, pts]) => (
        <polyline key={algo} fill="none" stroke={COLORS[algo] || "#98a2b3"} strokeWidth={algo === "HYBRID_FC" || algo === "STATIC" ? 2.2 : 1.4}
          points={pts.map((p, i) => pt(p.power, i + (maxLen - pts.length))).join(" ")} />
      ))}
      <text x={W - pad} y={12} textAnchor="end" fontSize="10" fill="#667085">{fmt(hi, 0)} W</text>
      <text x={W - pad} y={H - 8} textAnchor="end" fontSize="10" fill="#667085">{fmt(lo, 0)} W</text>
    </svg>
  );
}

export default function MetricsPanel({ series, containers, allocation, mode, modes, onMode, onExport, source, hostWatts }) {
  const latest = Object.entries(series)
    .filter(([, pts]) => pts && pts.length)
    .map(([algo, pts]) => ({ algo, ...pts[pts.length - 1] }));
  const minPower = latest.length ? Math.min(...latest.map((l) => Number(l.power) || 0)) : null;
  const plan = Object.fromEntries((allocation?.plan || []).map((p) => [p.id, p]));

  return (
    <section className="rm-metrics">
      <div className="rm-metrics-head">
        <h4>Resource optimizer</h4>
        <span className={`rm-source ${source === "simulated" ? "sim" : ""}`}>
          {source === "simulated" ? "Simulated workload" : source === "docker" ? "Real Docker metrics" : "No data yet"}
        </span>
        {hostWatts != null && <span className="rm-source">Host {fmt(hostWatts, 1)} W (RAPL)</span>}
        <span className="rm-spacer" />
        <label className="rm-mode">
          Apply strategy
          <select value={mode} onChange={(e) => onMode(e.target.value)}>
            {modes.map((m) => <option key={m} value={m}>{LABELS[m] || m}</option>)}
          </select>
        </label>
        <button className="rm-copy dark" onClick={onExport}>Export CSV</button>
      </div>

      <div className="rm-metrics-body">
        <div>
          <Lines series={series} />
          <table className="rm-table">
            <thead><tr><th>Strategy (what-if on current load)</th><th>Power</th><th>CPU util</th><th>Unmet</th></tr></thead>
            <tbody>
              {latest.map((l) => (
                <tr key={l.algo} className={l.algo === mode ? "on" : ""}>
                  <td><i style={{ background: COLORS[l.algo] || "#98a2b3" }} />{LABELS[l.algo] || l.algo}{l.algo === mode && <b> · applied</b>}</td>
                  <td>{fmt(l.power, 1)} W{l.power === minPower && <b className="best"> lowest</b>}</td>
                  <td>{fmt(l.util, 0)}%</td>
                  <td>{fmt(l.unmet, 1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <table className="rm-table">
            <thead><tr><th>Container</th><th>CPU used / limit</th><th>Memory</th><th>Host → planned</th></tr></thead>
            <tbody>
              {containers.length === 0 && <tr><td colSpan="4" className="rm-empty">No running containers for this room.</td></tr>}
              {containers.map((c) => {
                const p = plan[c.id];
                return (
                  <tr key={c.id}>
                    <td>{c.name} <span className="rm-ver">{c.service} {c.version}</span></td>
                    <td>{fmt(c.cpu, 2)} / {fmt(c.cpuLimit, 2)}</td>
                    <td>{fmt(c.mem, 0)} MB</td>
                    <td>{p ? `h${p.host} → ${fmt(p.cpuAfter, 2)} cores` : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {allocation && (
            <p className="rm-hint">
              Host frequency levels (modelled DVFS): {allocation.hosts.map((h) => `h${h.id} ${h.freq}×`).join(" · ")}.
              {allocation.applied ? " Limits and CPU sets were applied to the containers." : " Nothing applied (observe mode or simulated)."}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}