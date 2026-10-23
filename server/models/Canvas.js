// models/Canvas.js : one document per room, stores the saved canvas
const mongoose = require("mongoose");

module.exports = mongoose.model(
  "Canvas",
  new mongoose.Schema(
    {
      roomId: { type: String, required: true, unique: true, index: true },
      nodes: { type: Array, default: [] },
      edges: { type: Array, default: [] },
      workspace: {
        ready: { type: Boolean, default: false },
        port: Number,
        repoUrl: String
      }
    },
    { timestamps: true }
  )
);