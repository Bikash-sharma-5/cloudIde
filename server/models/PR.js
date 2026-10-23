const mongoose = require("mongoose");

const prSchema = new mongoose.Schema({
  roomId: String,
  sourceBranch: String,
  targetBranch: { type: String, default: "main" },
  createdBy: String,
  reviewers: [String],
  status: { type: String, default: "open" }, // open, approved, merged, rejected
  comments: [
    {
      user: String,
      text: String,
      date: { type: Date, default: Date.now }
    }
  ]
});

module.exports = mongoose.model("PR", prSchema);
