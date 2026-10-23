const mongoose = require("mongoose");

const roomSchema = new mongoose.Schema({

  name: String,

  owner: String,

  members: [String],

  repoUrl: {
    type: String,
    default: ""
  },

  code: {
    type: String,
    default: ""
  }

});

module.exports = mongoose.model("Room", roomSchema);
