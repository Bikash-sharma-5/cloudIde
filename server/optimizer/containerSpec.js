"use strict";
/*
  Use this inside your /api/workspace/create and /sync code, where you create containers.
  It builds the dockerode options for every replica of a canvas node, and adds the labels
  the optimizer needs to find the containers and read their service/version.

    const { buildContainerSpecs } = require("../optimizer/containerSpec");
    for (const node of nodes) {
      for (const spec of buildContainerSpecs(roomId, userId, node)) {
        const c = await docker.createContainer(spec);
        await c.start();
      }
    }
*/
const { byType, imageFor } = require("./catalog");

const safe = (s) => String(s).replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 40);

function buildContainerSpecs(roomId, userId, node) {
  const d = node.data || {};
  const svc = byType[d.serviceType];
  if (!svc) return [];

  const replicas = Math.min(10, Math.max(1, parseInt(d.replicas, 10) || 1));
  const cpu = Math.min(8, Math.max(0.1, Number(d.cpu) || svc.cpu));
  const memMB = Math.min(8192, Math.max(64, Number(d.memMB) || svc.memMB));
  const version = svc.versions.includes(d.version) ? d.version : svc.defaultVersion;

  return Array.from({ length: replicas }, (_, r) => ({
    name: `ide-${safe(roomId).slice(-8)}-${safe(node.id)}-${r}`,
    Image: imageFor(svc.type, version),
    Labels: {
      "cloudide.room": String(roomId),
      "cloudide.user": String(userId),
      "cloudide.node": String(node.id),
      "cloudide.service": svc.type,
      "cloudide.version": version,
      "cloudide.cpuReq": String(cpu),
    },
    HostConfig: {
      NanoCpus: Math.round(cpu * 1e9),
      Memory: memMB * 1024 * 1024,
      MemorySwap: memMB * 1024 * 1024,        // equal to Memory = no swap
      NetworkMode: `ide-net-${safe(roomId)}`, // one isolated network per room (create it once)
    },
  }));
}

module.exports = { buildContainerSpecs };
