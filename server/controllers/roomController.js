const mongoose = require("mongoose");
const Room = require("../models/Room");

// works whether your auth middleware sets req.user.id or req.user._id
const uid = (req) => req.user.id || req.user._id;

/*
  models/Room.js should have:
    name:    { type: String, required: true }
    owner:   { type: mongoose.Schema.Types.ObjectId, ref: "User" }
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }]
    repoUrl:        String
    workspaceReady: { type: Boolean, default: false }
    workspacePort:  Number
    { timestamps: true }
*/

exports.createRoom = async (req, res) => {
  try {
    const name = (req.body.name || "").trim();
    if (!name) return res.status(400).json({ message: "Room name is required" });

    const room = await Room.create({ name, owner: uid(req), members: [] });
    res.status(201).json(room);
  } catch (err) {
    res.status(500).json({ message: "Could not create room" });
  }
};

// rooms you own OR have joined
exports.getRooms = async (req, res) => {
  try {
    const me = uid(req);
    const rooms = await Room.find({ $or: [{ owner: me }, { members: me }] })
      .sort({ updatedAt: -1 })
      .lean();

    res.json(
      rooms.map((r) => ({
        ...r,
        memberCount: new Set([String(r.owner), ...(r.members || []).map(String)]).size,
      }))
    );
  } catch (err) {
    res.status(500).json({ message: "Could not load rooms" });
  }
};

// anyone with the room ID becomes a member
exports.joinRoom = async (req, res) => {
  try {
    const { roomId } = req.body;
    if (!mongoose.isValidObjectId(roomId)) {
      return res.status(400).json({ message: "Invalid room ID" });
    }

    const room = await Room.findByIdAndUpdate(
      roomId,
      { $addToSet: { members: uid(req) } },
      { new: true }
    );
    if (!room) return res.status(404).json({ message: "Room not found" });

    res.json(room);
  } catch (err) {
    res.status(500).json({ message: "Could not join room" });
  }
};

// Saves the repo URL ONCE per room (first launch decides). Every member reuses it.
exports.saveWorkspace = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: "Invalid room ID" });

    const room = await Room.findById(id);
    if (!room) return res.status(404).json({ message: "Room not found" });

    const me = String(uid(req));
    const isMember = String(room.owner) === me || (room.members || []).some((m) => String(m) === me);
    if (!isMember) return res.status(403).json({ message: "Join this room first" });

    if (!room.workspaceReady) room.repoUrl = String(req.body.repoUrl || "").trim();
    room.workspaceReady = true;
    if (req.body.port) room.workspacePort = req.body.port;

    await room.save();
    res.json(room);
  } catch (err) {
    res.status(500).json({ message: "Could not save workspace" });
  }
};