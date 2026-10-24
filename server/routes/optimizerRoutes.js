// routes/optimizerRoutes.js    mount with:  app.use("/api", require("./routes/optimizerRoutes"));
const router = require("express").Router();
const path = require("path");
const auth = require("../middleware/authMiddleware");
const Room = require("../models/Room");
const Metric = require("../models/Metric");
const { publicCatalog } = require("../optimizer/catalog");
const { detectEnvironment } = require("../optimizer/detectEnv");

const SAFE = /^[a-zA-Z0-9_-]{1,64}$/;
const uid = (req) => String(req.user.id || req.user._id);

async function requireMember(req, res, roomId) {
  const room = await Room.findById(roomId).lean().catch(() => null);
  if (!room) { res.status(404).json({ message: "Room not found" }); return null; }
  const me = uid(req);
  if (String(room.owner) !== me && !(room.members || []).some((m) => String(m) === me)) {
    res.status(403).json({ message: "Join this room first" }); return null;
  }
  return room;
}

// services + versions shown in the palette
router.get("/catalog", (req, res) => res.json(publicCatalog()));

// suggest services/versions from the cloned repo
router.get("/detect", auth, async (req, res) => {
  const { roomId, userId } = req.query;
  if (!SAFE.test(roomId || "") || !SAFE.test(userId || "")) return res.status(400).json({ message: "Bad ids" });
  if (!(await requireMember(req, res, roomId))) return;
  const dir = path.resolve(process.cwd(), "workspaces", roomId, userId);
  res.json(await detectEnvironment(dir));   // { services, conflicts }
});

// CSV of everything the optimizer measured in this room (for the paper's real-system experiments)
router.get("/metrics/export", auth, async (req, res) => {
  const { roomId } = req.query;
  if (!SAFE.test(roomId || "")) return res.status(400).json({ message: "Bad room id" });
  if (!(await requireMember(req, res, roomId))) return;

  const cols = ["ts", "source", "algorithm", "applied", "containers", "hosts", "cpuUtilPct", "memMB", "powerW", "unmetPct", "wastePct", "imbalance", "decideMs", "raplW"];
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="metrics-${roomId}.csv"`);
  res.write(cols.join(",") + "\n");
  for await (const m of Metric.find({ roomId }).sort({ ts: 1 }).lean().cursor()) {
    res.write(cols.map((c) => (c === "ts" ? new Date(m.ts).toISOString() : m[c] ?? "")).join(",") + "\n");
  }
  res.end();
});

module.exports = router;
