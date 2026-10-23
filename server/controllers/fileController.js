const fs = require("fs-extra");
const path = require("path");
const simpleGit = require("simple-git");

/* --------------------------------
   GET FILE LIST
---------------------------------*/

exports.getFiles = async (req, res) => {

  const { roomId, userId } = req.params;

  try {

    const dirPath = path.join(
      __dirname,
      "..",
      "workspaces",
      roomId,
      userId
    );

    const exists = await fs.pathExists(dirPath);

    if (!exists) {
      return res.json([]);
    }

    const files = await fs.readdir(dirPath);

    res.json(files);

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: "Cannot read files"
    });

  }

};


/* --------------------------------
   READ FILE CONTENT
---------------------------------*/

exports.getFileContent = async (req, res) => {

  const { roomId, userId } = req.params;
  const { file } = req.query;

  try {

    const filePath = path.join(
      __dirname,
      "..",
      "workspaces",
      roomId,
      userId,
      file
    );

    const content = await fs.readFile(filePath, "utf8");

    res.json({ content });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: "Cannot read file"
    });

  }

};


/* --------------------------------
   SAVE FILE
---------------------------------*/

exports.saveFile = async (req, res) => {

  const { roomId, userId } = req.params;
  const { file, content } = req.body;

  try {

    const filePath = path.join(
      __dirname,
      "..",
      "workspaces",
      roomId,
      userId,
      file
    );

    await fs.writeFile(filePath, content);

    res.json({
      message: "File saved"
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: "Save failed"
    });

  }

};


/* --------------------------------
   GIT COMMIT + PUSH
---------------------------------*/

exports.commitPush = async (req, res) => {

  const { roomId, userId } = req.params;
  const { message } = req.body;

  try {

    const repoPath = path.join(
      __dirname,
      "..",
      "workspaces",
      roomId,
      userId
    );

    const git = simpleGit(repoPath);

    await git.add(".");
    await git.commit(message);

    await git.push("origin", `user-${userId}`);

    res.json({
      message: "Changes pushed successfully"
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: "Git push failed"
    });

  }

};
