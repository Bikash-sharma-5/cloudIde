const router = require("express").Router();
const mongoose = require("mongoose");
const auth = require("../middleware/authMiddleware");
const { createRoom, getRooms, joinRoom, saveWorkspace } = require("../controllers/roomController");
const Room = require("../models/Room");

router.post("/", auth, createRoom);
router.get("/", auth, getRooms);
router.post("/join", auth, joinRoom);          // join with a room ID
router.patch("/:id/workspace", auth, saveWorkspace); // NEW: remember repo URL for the room

router.get("/:id", auth, async (req, res) => { // auth added: it was open to anyone before
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid ID format" });
    }

    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).json({ message: "Room not found" });

    res.json(room);
  } catch (err) {
    console.error("GET ROOM ERROR:", err.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

module.exports = router;