"use strict";
/*
  Reproducible experiment:   node optimizer/benchmark.js --seeds 30 --steps 288 --out results
  Compares 7 strategies on identical, seeded, time-varying workloads and writes
    results/runs.csv        one row per (seed, strategy)  -> use for statistical tests
    results/summary.md      mean +/- 95% CI per strategy
    results/timeseries.csv  per-step power/util/unmet for seed 0 -> use for plots
*/
const fs = require("fs");
const path = require("path");
const { rng, gauss, makeHosts, evaluate, DEFAULT_WEIGHTS } = require("./model");
const { MODES, MODE_CFG, decide, Holt } = require("./algorithms");

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > -1 ? process.argv[i + 1] : d; };
const SEEDS = +arg("seeds", 30), STEPS = +arg("steps", 288), HOSTS = +arg("hosts", 4);
const N = +arg("containers", 16), OUT = arg("out", "results");
const HOST_CORES = +arg("cores", 6), HOST_MEM = +arg("mem", 16384);
const SEED_START = +arg("seedStart", 0);   // tune on 1000+, report on 0..29 (never tune on test seeds)
const Z = +arg("z", 1);                    // forecast safety margin (std devs)
const STEP_HOURS = 5 / 60;                 // one step = 5 minutes -> 288 steps = one day
const PLACEMENT_EVERY = 12;                // ACO re-runs hourly
const HEADROOM = 1.1;                      // reactive strategies plan for last observation * 1.1

const TYPES = {
  web:    { base: 0.9,  amp: 0.6,  periods: 1, burstP: 0.02,  mem: 300 },
  worker: { base: 0.6,  amp: 0.9,  periods: 3, burstP: 0.04,  mem: 500 },
  db:     { base: 0.7,  amp: 0.25, periods: 1, burstP: 0.005, mem: 1200 },
  cache:  { base: 0.35, amp: 0.3,  periods: 1, burstP: 0.01,  mem: 400 },
};

function workload(seed) {
  const r = rng(seed * 7919 + 1), names = Object.keys(TYPES);
  const spec = Array.from({ length: N }, (_, i) => {
    const t = TYPES[names[i % names.length]];
    return { t, base: t.base * (0.7 + 0.6 * r()), phase: r() * 2 * Math.PI, mem: t.mem * (0.8 + 0.4 * r()) };
  });
  const burst = new Array(N).fill(0);
  const demand = [];
  for (let k = 0; k < STEPS; k++) {
    demand.push(spec.map((s, i) => {
      burst[i] *= 0.8;
      if (r() < s.t.burstP) burst[i] += s.base * (1.5 + 1.5 * r());
      const wave = Math.sin((2 * Math.PI * s.t.periods * k) / STEPS + s.phase);
      return Math.max(0.02, s.base * (1 + s.t.amp * wave) + burst[i] + 0.1 * s.base * gauss(r));
    }));
  }
  const mean = spec.map((_, i) => demand.reduce((a, d) => a + d[i], 0) / STEPS);
  return { demand, mem: spec.map((s) => s.mem), mean };
}

function runOne(seed, mode, wl, hosts, ts) {
  const rand = rng(seed * 1000 + MODES.indexOf(mode));
  const lo = new Array(N).fill(0.1), hi = new Array(N).fill(HOST_CORES);
  const req = wl.mean.map((m) => 1.3 * m);                         // typical hand-set request: 130% of mean demand
  const holts = Array.from({ length: N }, () => new Holt());
  let last = wl.demand[0].slice(), prev = null, migrations = 0, decideMs = 0;
  const acc = { energyWh: 0, unmet: 0, waste: 0, util: 0, imb: 0, cost: 0, workCoreH: 0 };

  for (let k = 0; k < STEPS; k++) {
    const planDemand = MODE_CFG[mode].forecast
      ? holts.map((h) => h.forecast(Z))
      : last.map((d) => d * HEADROOM);

    const t0 = process.hrtime.bigint();
    const plan = decide(mode, {
      planDemand, mem: wl.mem, hosts, lo, hi, req, rand,
      weights: DEFAULT_WEIGHTS, prevPlace: prev, redoPlacement: k % PLACEMENT_EVERY === 0,
    });
    decideMs += Number(process.hrtime.bigint() - t0) / 1e6;

    if (prev) for (let i = 0; i < N; i++) if (prev[i] !== plan.place[i]) migrations++;
    prev = plan.place;

    const ev = evaluate(plan, wl.demand[k], wl.mem, hosts);        // what actually happened
    acc.energyWh += ev.powerW * STEP_HOURS;
    acc.cost += ev.cost;
    acc.workCoreH += wl.demand[k].reduce((a, b) => a + b, 0) * (1 - ev.unmetPct) * STEP_HOURS;
    acc.unmet += ev.unmetPct; acc.waste += ev.wastePct; acc.util += ev.util; acc.imb += ev.imbalance;
    if (ts) ts.push([seed, mode, k, ev.powerW.toFixed(2), ev.util.toFixed(4), ev.unmetPct.toFixed(5)].join(","));

    wl.demand[k].forEach((d, i) => holts[i].update(d));
    last = wl.demand[k];
  }
  return {
    energyWh: acc.energyWh, whPerCoreH: acc.energyWh / acc.workCoreH, costAvg: acc.cost / STEPS, unmetPct: (100 * acc.unmet) / STEPS, wastePct: (100 * acc.waste) / STEPS,
    utilPct: (100 * acc.util) / STEPS, imbalance: acc.imb / STEPS, migrations, decideMs: decideMs / STEPS,
  };
}

const METRICS = ["energyWh", "whPerCoreH", "unmetPct", "wastePct", "utilPct", "imbalance", "migrations", "decideMs", "costAvg"];
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const ci = (a) => (1.96 * sd(a)) / Math.sqrt(a.length);

fs.mkdirSync(OUT, { recursive: true });
const hosts = makeHosts(HOSTS, HOST_CORES, HOST_MEM);
const runs = [], ts = ["seed,strategy,step,powerW,util,unmetFrac"];
const started = Date.now();

for (let seed = SEED_START; seed < SEED_START + SEEDS; seed++) {
  const wl = workload(seed);
  for (const mode of MODES) runs.push({ seed, mode, ...runOne(seed, mode, wl, hosts, seed === SEED_START ? ts : null) });
  process.stdout.write(`\rseed ${seed - SEED_START + 1}/${SEEDS}`);
}
console.log(`\ndone in ${((Date.now() - started) / 1000).toFixed(1)} s`);

fs.writeFileSync(path.join(OUT, "runs.csv"),
  ["seed,strategy," + METRICS.join(","), ...runs.map((r) => [r.seed, r.mode, ...METRICS.map((m) => r[m].toFixed(4))].join(","))].join("\n"));
fs.writeFileSync(path.join(OUT, "timeseries.csv"), ts.join("\n"));

const by = (mode, m) => runs.filter((r) => r.mode === mode).map((r) => r[m]);
const rows = MODES.map((mode) =>
  `| ${MODE_CFG[mode].label} | ` + METRICS.map((m) => {
    const v = by(mode, m), d = ["imbalance", "whPerCoreH", "costAvg"].includes(m) ? 3 : 2;
    return `${mean(v).toFixed(d)} ± ${ci(v).toFixed(d)}`;
  }).join(" | ") + " |");
const pct = (a, b, m) => (100 * (mean(by(a, m)) - mean(by(b, m)))) / mean(by(b, m));

const md = [
  `# Benchmark summary`,
  `${SEEDS} seeded workloads, ${STEPS} steps (5 min each), ${N} containers, ${HOSTS} hosts x ${HOST_CORES} cores. Mean ± 95% CI.`, "",
  `| Strategy | Energy (Wh/day) | Wh per core-hour served | Unmet demand (%) | Idle allocation (%) | CPU util (%) | Imbalance | Migrations | Decision (ms) | Cost J |`,
  `|---|---|---|---|---|---|---|---|---|---|`, ...rows, "",
  `Forecast margin z = ${Z}.`, "",
  `**Hybrid + forecast vs Static:** Wh/core-h ${pct("HYBRID_FC", "STATIC", "whPerCoreH").toFixed(1)}%, unmet ${pct("HYBRID_FC", "STATIC", "unmetPct").toFixed(1)}%, cost J ${pct("HYBRID_FC", "STATIC", "costAvg").toFixed(1)}%`,
  `**Hybrid + forecast vs Hybrid reactive (prior-work proxy):** Wh/core-h ${pct("HYBRID_FC", "HYBRID", "whPerCoreH").toFixed(1)}%, unmet ${pct("HYBRID_FC", "HYBRID", "unmetPct").toFixed(1)}%, cost J ${pct("HYBRID_FC", "HYBRID", "costAvg").toFixed(1)}%`, "",
].join("\n");
fs.writeFileSync(path.join(OUT, "summary.md"), md);
console.log("\n" + md);
