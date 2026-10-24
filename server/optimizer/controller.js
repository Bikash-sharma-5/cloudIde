"use strict";
/*
  Per-room MAPE-K loop:  Monitor (docker stats) -> Analyse/Predict (Holt) -> Plan (strategies) -> Execute (docker update)

  * Every SAMPLE_MS : read real CPU/memory of the room's containers and emit them.
  * Every OPTIMIZE_EVERY samples : run ALL strategies on the same observed demand ("shadow" evaluation),
    emit/store their predicted power, utilisation and unmet demand, and APPLY only the selected mode.
  * Mode OBSERVE (default) applies nothing, so it is safe to leave on.
  * If no labelled containers exist and OPT_SIMULATE=1, a labelled SIMULATED workload is generated from the
    canvas nodes so the pipeline can be demonstrated without Docker. Simulated rows never mix with real ones.
*/
const os = require("os");
const fs = require("fs");
const Docker = require("dockerode");
const docker = new Docker();

const { MODES, MODE_CFG, decide, Holt } = require("./algorithms");
const { makeHosts, evaluate, rng, DEFAULT_WEIGHTS } = require("./model");
const { byType } = require("./catalog");
const Metric = require("../models/Metric");

const SAMPLE_MS = Number(process.env.OPT_SAMPLE_MS) || 2000;
const OPTIMIZE_EVERY = 5;               // -> every 10 s
const PLACEMENT_EVERY = 6;              // -> ACO every ~60 s
const SIMULATE = process.env.OPT_SIMULATE === "1";
const APPLY_MEMORY = process.env.OPT_APPLY_MEMORY === "1";   // memory right-sizing is OFF unless you opt in (OOM risk)
const HEADROOM = 1.1;

// ---------- hosts = CPU core groups of this machine (real placement via cpuset) ----------
function buildHosts() {
  // OPT_VIRTUAL_CORES is for SIMULATION on small machines only (cpusets are never applied to simulated rows)
  const cores = Number(process.env.OPT_VIRTUAL_CORES) || os.cpus().length;
  const wanted = Number(process.env.OPT_HOST_GROUPS) || Math.max(2, Math.min(4, Math.floor(cores / 2)));
  const groups = Math.max(1, Math.min(wanted, cores));             // never more groups than cores
  const per = Math.floor(cores / groups);
  const memMB = Math.floor(((os.totalmem() / 1048576) * 0.8) / groups);
  const hosts = makeHosts(groups, per, memMB);
  hosts.forEach((h, i) => {
    const start = i * per, end = i === groups - 1 ? cores - 1 : start + per - 1;   // last group takes the remainder
    h.cpuset = start === end ? `${start}` : `${start}-${end}`;
    h.cpuCap = end - start + 1;
  });
  return hosts;
}

// ---------- optional real power (Intel RAPL). Returns watts since last call, or null ----------
const RAPL = "/sys/class/powercap/intel-rapl:0/energy_uj";
let lastRapl = null;
function readRaplWatts() {
  try {
    const uj = Number(fs.readFileSync(RAPL, "utf8")), now = Date.now();
    const prev = lastRapl; lastRapl = { uj, now };
    if (!prev || uj < prev.uj) return null;
    return (uj - prev.uj) / 1e6 / ((now - prev.now) / 1000);
  } catch { return null; }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i).catch(() => null); }
  }));
  return out.filter(Boolean);
}

function cpuCoresUsed(s) {
  const cpuDelta = s.cpu_stats.cpu_usage.total_usage - s.precpu_stats.cpu_usage.total_usage;
  const sysDelta = s.cpu_stats.system_cpu_usage - s.precpu_stats.system_cpu_usage;
  const cores = s.cpu_stats.online_cpus || os.cpus().length;
  return sysDelta > 0 && cpuDelta >= 0 ? (cpuDelta / sysDelta) * cores : 0;
}
const memUsedMB = (s) => Math.max(0, s.memory_stats.usage - (s.memory_stats.stats?.inactive_file ?? s.memory_stats.stats?.cache ?? 0)) / 1048576;

class RoomController {
  constructor(io, roomId, getNodes) {
    this.io = io; this.roomId = roomId; this.getNodes = getNodes;
    this.mode = "OBSERVE";
    this.hosts = buildHosts();
    this.holts = new Map();            // container id -> Holt
    this.prev = {};                    // mode -> previous placement (array), reset when container set changes
    this.idsKey = "";
    this.tick = 0; this.round = 0; this.timer = null; this.busy = false;
  }

  start() { if (!this.timer) this.timer = setInterval(() => this.step(), SAMPLE_MS); }
  stop() { clearInterval(this.timer); this.timer = null; }
  setMode(mode) { this.mode = mode; }

  // ---------- Monitor ----------
  async collect() {
    try {
      const list = await docker.listContainers({ filters: { label: [`cloudide.room=${this.roomId}`], status: ["running"] } });
      if (list.length) {
        const rows = await mapLimit(list, 8, async (info) => {
          const c = docker.getContainer(info.Id);
          const [s, ins] = await Promise.all([c.stats({ stream: false }), c.inspect()]);
          const hc = ins.HostConfig || {};
          return {
            id: info.Id.slice(0, 12), name: (info.Names[0] || "").replace("/", ""),
            service: info.Labels["cloudide.service"], version: info.Labels["cloudide.version"],
            cpu: cpuCoresUsed(s), mem: memUsedMB(s),
            cpuLimit: hc.NanoCpus ? hc.NanoCpus / 1e9 : Number(info.Labels["cloudide.cpuReq"]) || 1,
            memLimit: hc.Memory ? hc.Memory / 1048576 : 0,
            cpuReq: Number(info.Labels["cloudide.cpuReq"]) || (hc.NanoCpus ? hc.NanoCpus / 1e9 : 1),
          };
        });
        if (rows.length) return { source: "docker", rows };
      }
    } catch (e) { if (!SIMULATE) console.error("[optimizer] docker:", e.message); }

    if (!SIMULATE) return { source: "docker", rows: [] };
    const nodes = (await this.getNodes(this.roomId)) || [];
    return { source: "simulated", rows: this.simulate(nodes) };
  }

  simulate(nodes) {          // deterministic, time-varying demand derived from node id; clearly labelled "simulated"
    const t = this.tick;
    return nodes.flatMap((n) => {
      const svc = byType[n.data?.serviceType]; if (!svc) return [];
      const reps = Math.max(1, parseInt(n.data.replicas, 10) || 1);
      return Array.from({ length: reps }, (_, r) => {
        let h = 0; for (const ch of `${n.id}${r}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
        const rand = rng(h + Math.floor(t / 8)), base = (n.data.cpu || svc.cpu) * 0.6;
        const wave = Math.sin(t / 25 + (h % 628) / 100);
        const burst = rand() < 0.06 ? base * 1.5 : 0;
        return {
          id: `${n.id}-${r}`, name: `${n.data.label || svc.label}#${r}`, service: svc.type, version: n.data.version,
          cpu: Math.max(0.02, base * (1 + 0.5 * wave) + burst), mem: (n.data.memMB || svc.memMB) * 0.6,
          cpuLimit: n.data.cpu || svc.cpu, memLimit: n.data.memMB || svc.memMB, cpuReq: n.data.cpu || svc.cpu,
        };
      });
    });
  }

  async step() {
    if (this.busy) return;
    this.busy = true;
    try {
      const { source, rows } = await this.collect();
      if (!rows.length) return;
      this.tick++;

      for (const r of rows) {
        if (!this.holts.has(r.id)) this.holts.set(r.id, new Holt());
        this.holts.get(r.id).update(r.cpu);
      }
      const key = rows.map((r) => r.id).join(",");
      if (key !== this.idsKey) { this.idsKey = key; this.prev = {}; }

      this.io.to(this.roomId).emit("container-metrics", {
        time: Date.now(), source, hostWatts: readRaplWatts(),
        containers: rows.map((r) => ({ id: r.id, name: r.name, service: r.service, version: r.version, cpu: +r.cpu.toFixed(3), mem: +r.mem.toFixed(1), cpuLimit: r.cpuLimit })),
      });

      if (this.tick % OPTIMIZE_EVERY === 0) await this.optimize(source, rows);
    } catch (e) {
      console.error("[optimizer] step failed:", e.message);
    } finally { this.busy = false; }
  }

  // ---------- Analyse + Plan + Execute ----------
  async optimize(source, rows) {
    this.round++;
    const N = rows.length, hosts = this.hosts;
    const demand = rows.map((r) => r.cpu), mem = rows.map((r) => r.mem);
    const req = rows.map((r) => r.cpuReq);
    const lo = rows.map(() => 0.1), hi = rows.map(() => Math.max(...hosts.map((h) => h.cpuCap)));
    const rand = rng(this.round * 7919);
    const redoPlacement = this.round % PLACEMENT_EVERY === 1;
    const raplW = readRaplWatts();

    const records = [], plans = {};
    for (const mode of MODES) {
      const planDemand = MODE_CFG[mode].forecast
        ? rows.map((r) => this.holts.get(r.id).forecast(1))
        : demand.map((d) => d * HEADROOM);

      const t0 = process.hrtime.bigint();
      const plan = decide(mode, { planDemand, mem, hosts, lo, hi, req, rand, weights: DEFAULT_WEIGHTS, prevPlace: this.prev[mode], redoPlacement });
      const decideMs = Number(process.hrtime.bigint() - t0) / 1e6;
      this.prev[mode] = plan.place; plans[mode] = plan;

      const ev = evaluate(plan, demand, mem, hosts);
      const time = Date.now();
      this.io.to(this.roomId).emit("metrics-update", {    // same shape your dashboard already listens to
        algorithm: mode, cpu: +(ev.util * 100).toFixed(2), memory: +mem.reduce((a, b) => a + b, 0).toFixed(1),
        energy: +ev.powerW.toFixed(2), unmet: +(ev.unmetPct * 100).toFixed(2), time, source,
      });
      records.push({
        roomId: this.roomId, source, algorithm: mode, applied: mode === this.mode, containers: N, hosts: hosts.length,
        cpuUtilPct: ev.util * 100, memMB: mem.reduce((a, b) => a + b, 0), powerW: ev.powerW,
        unmetPct: ev.unmetPct * 100, wastePct: ev.wastePct * 100, imbalance: ev.imbalance, decideMs, raplW,
      });
    }
    Metric.insertMany(records, { ordered: false }).catch((e) => console.error("[optimizer] metric save:", e.message));

    // Execute the selected strategy
    const chosen = plans[this.mode];
    const applied = !!chosen && source === "docker";
    if (applied) await this.apply(rows, chosen);

    if (chosen) {
      this.io.to(this.roomId).emit("allocation-update", {
        time: Date.now(), mode: this.mode, applied, source,
        hosts: hosts.map((h, i) => ({ id: i, cpuset: h.cpuset, freq: chosen.freq[i] })),
        plan: rows.map((r, i) => ({ id: r.id, name: r.name, host: chosen.place[i], cpuBefore: +r.cpuLimit.toFixed(2), cpuAfter: +chosen.alloc[i].toFixed(2) })),
      });
    }
  }

  async apply(rows, plan) {
    await mapLimit(rows, 6, async (r, i) => {
      const nano = Math.round(plan.alloc[i] * 1e9);
      const update = { CpusetCpus: this.hosts[plan.place[i]].cpuset };
      if (Math.abs(plan.alloc[i] - r.cpuLimit) / Math.max(r.cpuLimit, 0.1) > 0.1) update.NanoCpus = nano;   // ignore tiny changes
      if (APPLY_MEMORY && r.memLimit) {
        const m = Math.max(64, Math.ceil(r.mem * 1.3 + 64)) * 1048576;
        update.Memory = m; update.MemorySwap = m;
      }
      await docker.getContainer(r.id).update(update);
    });
    // NOTE: frequency (DVFS) is modelled, not set on hardware. plan.freq drives the power model only.
  }
}

module.exports = { RoomController, buildHosts };
