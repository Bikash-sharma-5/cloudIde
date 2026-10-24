// models/Metric.js : one row per (room, strategy, optimisation round). Auto-deleted after 30 days.
const mongoose = require("mongoose");

const metricSchema = new mongoose.Schema({
  roomId:      { type: String, index: true, required: true },
  ts:          { type: Date, default: Date.now, index: true },
  source:      { type: String, enum: ["docker", "simulated"], required: true },  // never mix these in analysis
  algorithm:   String,        // STATIC | K8S | ACO | PSO | DVFS | HYBRID | HYBRID_FC
  applied:     Boolean,       // was this strategy the one actually applied this round?
  containers:  Number,
  hosts:       Number,
  cpuUtilPct:  Number,        // mean busy fraction of active hosts under this plan
  memMB:       Number,
  powerW:      Number,        // modelled power under this plan
  unmetPct:    Number,        // % of demand not served under this plan
  wastePct:    Number,
  imbalance:   Number,
  decideMs:    Number,        // time the optimiser took
  raplW:       Number,        // measured package power if RAPL is readable (null otherwise)
}, { timestamps: false });

metricSchema.index({ ts: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

module.exports = mongoose.model("Metric", metricSchema);
