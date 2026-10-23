const mongoose = require("mongoose");

const metricsSchema = new mongoose.Schema({

  roomId: String,
  userId: String,
  algorithm: String,

  cpu: Number,
  memory: Number,
  time: Number,
  energy: Number,

  createdAt: {
    type: Date,
    default: Date.now
  }

});

module.exports = mongoose.model("Metrics", metricsSchema);
