const express = require("express");
const router = express.Router();
const { createWorkspace,syncInfrastructure } = require("../controllers/workspaceController");
const fileController = require("../controllers/fileController");

router.get("/files/:roomId/:userId", fileController.getFiles);

router.get("/file/:roomId/:userId", fileController.getFileContent);

router.post("/save/:roomId/:userId", fileController.saveFile);

router.post("/push/:roomId/:userId", fileController.commitPush);
router.post("/create", createWorkspace);
// Add this line to your existing workspace routes
router.post("/sync-infra", syncInfrastructure);
module.exports = router;
