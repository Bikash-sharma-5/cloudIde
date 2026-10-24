"use strict";
const { evaluate, FREQ_LEVELS, TARGET_UTIL } = require("./model");

const clip = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const ones = (n) => new Array(n).fill(1);

/* ---------------- DVFS governor ----------------
   Lowest frequency level whose capacity still covers the planned load at TARGET_UTIL. */
function chooseFreq(place, alloc, planDemand, hosts) {
  const load = new Array(hosts.length).fill(0);
  for (let i = 0; i < place.length; i++) load[place[i]] += Math.min(planDemand[i], alloc[i]);
  return hosts.map((h, i) => {
    for (const f of FREQ_LEVELS) if (load[i] <= TARGET_UTIL * h.cpuCap * f) return f;
    return 1;
  });
}

const headroomAlloc = (planDemand, lo, hi, margin = 1.15) =>
  planDemand.map((d, i) => clip(d * margin, lo[i], hi[i]));

/* ---------------- Baseline placements ---------------- */
const roundRobin = (n, H) => Array.from({ length: n }, (_, i) => i % H);

function leastRequested(req, mem, hosts) {          // what the default Kubernetes scheduler roughly does
  const H = hosts.length, used = new Array(H).fill(0), mu = new Array(H).fill(0);
  const place = new Array(req.length);
  const order = [...req.keys()].sort((a, b) => req[b] - req[a]);
  for (const i of order) {
    let best = 0, bestScore = Infinity;
    for (let h = 0; h < H; h++) {
      const feasible = mu[h] + mem[i] <= hosts[h].memMB;
      const score = used[h] / hosts[h].cpuCap + (feasible ? 0 : 1000);
      if (score < bestScore) { bestScore = score; best = h; }
    }
    place[i] = best; used[best] += req[i]; mu[best] += mem[i];
  }
  return place;
}

/* ---------------- PSO: continuous CPU allocation ---------------- */
function pso(ctx, opt = {}) {
  const { place, planDemand, mem, hosts, lo, hi, rand, useDvfs, weights } = ctx;
  const P = opt.particles ?? 20, I = opt.iters ?? 40, N = planDemand.length;
  const fit = (x) =>
    evaluate(
      { place, alloc: x, freq: useDvfs ? chooseFreq(place, x, planDemand, hosts) : ones(hosts.length) },
      planDemand, mem, hosts, weights
    ).cost;

  const X = [], V = [], PB = [], PF = [];
  let gb = null, gf = Infinity;
  for (let p = 0; p < P; p++) {
    const x = p === 0
      ? headroomAlloc(planDemand, lo, hi)
      : planDemand.map((d, i) => clip(d * (0.8 + 0.8 * rand()), lo[i], hi[i]));
    const f = fit(x);
    X.push(x); V.push(new Array(N).fill(0)); PB.push(x.slice()); PF.push(f);
    if (f < gf) { gf = f; gb = x.slice(); }
  }

  for (let it = 0; it < I; it++) {
    const w = 0.9 - (0.5 * it) / I;                      // inertia 0.9 -> 0.4
    for (let p = 0; p < P; p++) {
      for (let i = 0; i < N; i++) {
        const vmax = 0.3 * (hi[i] - lo[i]);
        V[p][i] = clip(
          w * V[p][i] + 1.5 * rand() * (PB[p][i] - X[p][i]) + 1.5 * rand() * (gb[i] - X[p][i]),
          -vmax, vmax
        );
        X[p][i] = clip(X[p][i] + V[p][i], lo[i], hi[i]);
      }
      const f = fit(X[p]);
      if (f < PF[p]) { PF[p] = f; PB[p] = X[p].slice(); }
      if (f < gf) { gf = f; gb = X[p].slice(); }
    }
  }
  return gb;
}

/* ---------------- ACO: container -> host placement ---------------- */
function aco(ctx, opt = {}) {
  const { planDemand, mem, hosts, lo, hi, rand, useDvfs, weights, prevPlace } = ctx;
  const A = opt.ants ?? 10, I = opt.iters ?? 15, alpha = 1, beta = 2, rho = 0.3;
  const N = planDemand.length, H = hosts.length;
  const alloc = headroomAlloc(planDemand, lo, hi);
  const tau = Array.from({ length: N }, (_, i) =>
    Array.from({ length: H }, (_, h) => (prevPlace && prevPlace[i] === h ? 2 : 1)));
  const order = [...Array(N).keys()].sort((a, b) => planDemand[b] - planDemand[a]);

  const costOf = (place) => {
    const freq = useDvfs ? chooseFreq(place, alloc, planDemand, hosts) : ones(H);
    let c = evaluate({ place, alloc, freq }, planDemand, mem, hosts, weights).cost;
    if (prevPlace) for (let i = 0; i < N; i++) if (prevPlace[i] !== place[i]) c += 0.01;   // discourage migrations
    return c;
  };

  let best = null, bestCost = Infinity;
  for (let it = 0; it < I; it++) {
    let itBest = null, itCost = Infinity;
    for (let a = 0; a < A; a++) {
      const load = new Array(H).fill(0), mu = new Array(H).fill(0), place = new Array(N);
      for (const i of order) {
        const p = new Array(H); let sum = 0;
        for (let h = 0; h < H; h++) {
          const feasible = mu[h] + mem[i] <= hosts[h].memMB;
          const proj = (load[h] + planDemand[i]) / hosts[h].cpuCap;
          const eta = feasible ? Math.max(0.05, 1.2 - proj) : 1e-6;
          p[h] = Math.pow(tau[i][h], alpha) * Math.pow(eta, beta);
          sum += p[h];
        }
        let r = rand() * sum, h = 0;
        while (h < H - 1 && (r -= p[h]) > 0) h++;
        place[i] = h; load[h] += planDemand[i]; mu[h] += mem[i];
      }
      const c = costOf(place);
      if (c < itCost) { itCost = c; itBest = place; }
    }
    if (itCost < bestCost) { bestCost = itCost; best = itBest.slice(); }
    for (let i = 0; i < N; i++) for (let h = 0; h < H; h++) tau[i][h] = Math.max(0.05, tau[i][h] * (1 - rho));
    for (let i = 0; i < N; i++) {
      tau[i][itBest[i]] = Math.min(10, tau[i][itBest[i]] + 1 / (1 + itCost));
      tau[i][best[i]] = Math.min(10, tau[i][best[i]] + 1 / (1 + bestCost));
    }
  }
  return best;
}

/* ---------------- Workload forecaster: Holt double exponential smoothing ----------------
   forecast = level + trend + z * (running residual std)  -> proactive, with a safety margin */
class Holt {
  constructor(alpha = 0.5, beta = 0.3) { this.a = alpha; this.bt = beta; this.l = null; this.b = 0; this.s2 = 0; }
  update(x) {
    if (this.l === null) { this.l = x; return; }
    const pred = this.l + this.b, err = x - pred;
    this.s2 = 0.9 * this.s2 + 0.1 * err * err;
    const l = this.a * x + (1 - this.a) * pred;
    this.b = this.bt * (l - this.l) + (1 - this.bt) * this.b;
    this.l = l;
  }
  forecast(z = 1) {
    return this.l === null ? 0 : Math.max(0, this.l + this.b + z * Math.sqrt(this.s2));
  }
}

/* ---------------- Strategies compared in the paper ---------------- */
const MODE_CFG = {
  STATIC:    { label: "Static allocation",          place: "rr",  alloc: "req",      dvfs: false, forecast: false },
  K8S:       { label: "K8s-style least-requested",  place: "k8s", alloc: "req",      dvfs: false, forecast: false },
  ACO:       { label: "ACO placement",              place: "aco", alloc: "headroom", dvfs: false, forecast: false },
  PSO:       { label: "PSO allocation",             place: "rr",  alloc: "pso",      dvfs: false, forecast: false },
  DVFS:      { label: "DVFS only",                  place: "rr",  alloc: "headroom", dvfs: true,  forecast: false },
  HYBRID:    { label: "ACO+PSO+DVFS (reactive)",    place: "aco", alloc: "pso",      dvfs: true,  forecast: false },
  HYBRID_FC: { label: "ACO+PSO+DVFS + forecast",    place: "aco", alloc: "pso",      dvfs: true,  forecast: true  },
};
const MODES = Object.keys(MODE_CFG);

/* ctx: { planDemand, mem, hosts, lo, hi, req, rand, weights, prevPlace, redoPlacement } */
function decide(mode, ctx) {
  const cfg = MODE_CFG[mode], N = ctx.planDemand.length, H = ctx.hosts.length;
  const full = { ...ctx, useDvfs: cfg.dvfs };

  let place;
  if (cfg.place === "aco") place = ctx.redoPlacement || !ctx.prevPlace ? aco(full) : ctx.prevPlace;
  else if (cfg.place === "k8s") place = ctx.prevPlace || leastRequested(ctx.req, ctx.mem, ctx.hosts);
  else place = ctx.prevPlace || roundRobin(N, H);

  let alloc;
  if (cfg.alloc === "req") alloc = ctx.req.map((r, i) => clip(r, ctx.lo[i], ctx.hi[i]));
  else if (cfg.alloc === "headroom") alloc = headroomAlloc(ctx.planDemand, ctx.lo, ctx.hi);
  else alloc = pso({ ...full, place });

  const freq = cfg.dvfs ? chooseFreq(place, alloc, ctx.planDemand, ctx.hosts) : ones(H);
  return { place, alloc, freq };
}

module.exports = { MODES, MODE_CFG, decide, Holt, chooseFreq, headroomAlloc, pso, aco, roundRobin, leastRequested };
