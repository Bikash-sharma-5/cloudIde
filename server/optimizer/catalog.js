"use strict";
/*
  Single source of truth for every service a room can run.
  To add a service or a version: edit this file only. The UI, validation and
  container creation all read from here (nothing is hard-coded in the frontend).

  Version isolation is what removes "works on my machine" conflicts:
  every node is its own container pinned to image:version, so Python 3.9 and
  Python 3.12 (or Node 18 and Node 22) can run side by side in the same room.
*/
const CATALOG = [
  { type: "node",    label: "Node.js",    image: "node",     suffix: "-alpine", versions: ["18", "20", "22"],           defaultVersion: "20",  color: "#3c873a", cpu: 0.5, memMB: 256,  port: 3000  },
  { type: "python",  label: "Python",     image: "python",   suffix: "-slim",   versions: ["3.9", "3.10", "3.11", "3.12"], defaultVersion: "3.11", color: "#3572A5", cpu: 0.5, memMB: 256,  port: 8000  },
  { type: "redis",   label: "Redis",      image: "redis",    suffix: "-alpine", versions: ["6", "7"],                   defaultVersion: "7",   color: "#dc382d", cpu: 0.25, memMB: 128, port: 6379  },
  { type: "postgres",label: "PostgreSQL", image: "postgres", suffix: "",        versions: ["14", "15", "16"],           defaultVersion: "16",  color: "#336791", cpu: 0.5, memMB: 512,  port: 5432  },
  { type: "mongodb", label: "MongoDB",    image: "mongo",    suffix: "",        versions: ["6", "7"],                   defaultVersion: "7",   color: "#13aa52", cpu: 0.5, memMB: 512,  port: 27017 },
];

const byType = Object.fromEntries(CATALOG.map((s) => [s.type, s]));

function imageFor(type, version) {
  const s = byType[type];
  if (!s) throw new Error(`Unknown service type: ${type}`);
  const v = s.versions.includes(version) ? version : s.defaultVersion;   // never pull an unvalidated tag
  return `${s.image}:${v}${s.suffix}`;
}

// closest supported version for something detected in a repo (e.g. "18.17.1" -> "18")
function pickVersion(type, wanted) {
  const s = byType[type];
  if (!s) return null;
  if (!wanted) return s.defaultVersion;
  const m = String(wanted).match(/\d+(\.\d+)?/);
  if (!m) return s.defaultVersion;
  const full = m[0], major = full.split(".")[0];
  if (s.versions.includes(full)) return full;
  const candidates = s.versions.filter((v) => v.split(".")[0] === major);
  if (candidates.length) {
    const minor = +full.split(".")[1] || 0;
    return candidates.find((v) => +v.split(".")[1] >= minor) || candidates[candidates.length - 1];
  }
  const higher = s.versions.filter((v) => parseFloat(v) > parseFloat(full));
  return higher[0] || s.versions[s.versions.length - 1];
}

const publicCatalog = () => CATALOG.map(({ suffix, image, ...rest }) => rest);

module.exports = { CATALOG, byType, imageFor, pickVersion, publicCatalog };
