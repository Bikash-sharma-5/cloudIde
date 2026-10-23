const router = require("express").Router();
const Metrics = require("../models/Metrics");

// save metrics
router.post("/", async (req, res) => {
  try {
    const data = await Metrics.create(req.body);

    // 🔥 ADD THIS (IMPORTANT)
    if (global.ioInstance) {
      global.ioInstance.to(req.body.roomId).emit("metrics-update", data);
    }

    console.log("📡 METRIC EMITTED:", data);

    res.json(data);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save metric" });
  }
});

// get metrics by room
router.get("/:roomId", async (req, res) => {
  const data = await Metrics.find({ roomId: req.params.roomId });
  res.json(data);
});

module.exports = router;
