"use strict";
/*
  System model used by BOTH the live controller and the offline benchmark,
  so the numbers in the paper and in the app come from the same code.

  Host h : cpuCap cores, memMB, frequency level f in FREQ_LEVELS (normalised, 1.0 = nominal)
  Plan   : place[i] = host of container i, alloc[i] = CPU limit (cores), freq[h] = host frequency

  Served CPU of a host      = min(sum of min(demand, alloc), cpuCap * f)   (over-subscribed hosts scale down)
  Busy fraction b_h         = served / (cpuCap * f)
  Host power (active)       = P_idle + (P_max - P_idle) * f^3 * b_h        (classic DVFS model: dynamic power ~ f * V^2, V ~ f)
  Host power (no container) = P_sleep
  Cost J = wE * P_total/P_ref + wU * unmet + wW * waste/capTotal + wI * imbalance + 10 * memViolation
*/

function rng(seed) {                       // mulberry32: reproducible experiments
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r) => Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r());

const FREQ_LEVELS = [0.6, 0.8, 1.0];
const TARGET_UTIL = 0.85;
const DEFAULT_WEIGHTS = { energy: 1, unmet: 20, waste: 0.4, imbalance: 0.3 };

function makeHosts(count, cpuCap, memMB, power = {}) {
  return Array.from({ length: count }, (_, id) => ({
    id, cpuCap, memMB,
    pIdle: power.pIdle ?? 40,
    pMax: power.pMax ?? 120,
    pSleep: power.pSleep ?? 8,
  }));
}

function evaluate(plan, demand, mem, hosts, weights = DEFAULT_WEIGHTS) {
  const H = hosts.length, N = demand.length;
  const want = new Array(H).fill(0), memUse = new Array(H).fill(0), count = new Array(H).fill(0);
  for (let i = 0; i < N; i++) {
    const h = plan.place[i];
    want[h] += Math.min(demand[i], plan.alloc[i]);
    memUse[h] += mem[i];
    count[h]++;
  }

  const scale = new Array(H), busy = [];
  let powerW = 0, memViol = 0, pRef = 0, capTotal = 0;
  for (let h = 0; h < H; h++) {
    const host = hosts[h];
    pRef += host.pMax; capTotal += host.cpuCap;
    const cap = host.cpuCap * plan.freq[h];
    scale[h] = want[h] > cap ? cap / want[h] : 1;
    if (count[h] === 0) { powerW += host.pSleep; continue; }
    const b = Math.min(1, (want[h] * scale[h]) / cap);
    busy.push(b);
    powerW += host.pIdle + (host.pMax - host.pIdle) * Math.pow(plan.freq[h], 3) * b;
    memViol += Math.max(0, memUse[h] - host.memMB) / host.memMB;
  }

  let dTotal = 0, unmet = 0, allocTotal = 0, waste = 0;
  for (let i = 0; i < N; i++) {
    const served = Math.min(demand[i], plan.alloc[i]) * scale[plan.place[i]];
    dTotal += demand[i]; unmet += demand[i] - served;
    allocTotal += plan.alloc[i]; waste += Math.max(0, plan.alloc[i] - demand[i]);
  }

  const mean = busy.length ? busy.reduce((a, b) => a + b, 0) / busy.length : 0;
  const imbalance = busy.length ? Math.sqrt(busy.reduce((a, b) => a + (b - mean) ** 2, 0) / busy.length) : 0;
  const unmetPct = dTotal ? unmet / dTotal : 0;
  const wastePct = allocTotal ? waste / allocTotal : 0;
  const cost =
    weights.energy * (powerW / pRef) +
    weights.unmet * unmetPct +
    weights.waste * (waste / capTotal) +
    weights.imbalance * imbalance +
    10 * memViol;

  return { cost, powerW, unmetPct, wastePct, util: mean, imbalance, memViol };
}

module.exports = { rng, gauss, FREQ_LEVELS, TARGET_UTIL, DEFAULT_WEIGHTS, makeHosts, evaluate };
