"use strict";
/*
  "Repository analysis": read the cloned repo and suggest which services + versions it needs.
  Explicit pins (.nvmrc, engines, .python-version, docker-compose image tags) win over dependency hints.
*/
const fs = require("fs-extra");
const path = require("path");
const { pickVersion, byType } = require("./catalog");

const IMAGE_TO_TYPE = { node: "node", python: "python", redis: "redis", postgres: "postgres", mongo: "mongodb" };

async function detectEnvironment(dir) {
  const read = (f) => fs.readFile(path.join(dir, f), "utf8").catch(() => null);
  const found = new Map();                                   // type -> { type, version, source, explicit }
  const conflicts = [];                                      // two files pinning different versions of one runtime
  const add = (type, wanted, source, explicit) => {
    if (!byType[type]) return;
    const prev = found.get(type);
    if (prev && prev.explicit && explicit) {
      const v = pickVersion(type, wanted);
      if (v !== prev.version) conflicts.push({ type, a: { version: prev.version, source: prev.source }, b: { version: v, source } });
    }
    if (prev && (prev.explicit || !explicit)) return;
    found.set(type, { type, version: pickVersion(type, wanted), source, explicit });
  };

  // explicit version pins
  const nvmrc = (await read(".nvmrc")) || (await read(".node-version"));
  if (nvmrc) add("node", nvmrc.trim(), ".nvmrc", true);

  const pkgText = await read("package.json");
  let pkg = null;
  try { pkg = pkgText ? JSON.parse(pkgText) : null; } catch { /* ignore broken JSON */ }
  if (pkg?.engines?.node) add("node", pkg.engines.node, "package.json engines", true);

  const pyver = await read(".python-version");
  if (pyver) add("python", pyver.trim(), ".python-version", true);
  const runtime = await read("runtime.txt");
  if (runtime) add("python", runtime.replace("python-", ""), "runtime.txt", true);
  const pyproject = await read("pyproject.toml");
  const req = pyproject?.match(/requires-python\s*=\s*["']([^"']+)/);
  if (req) add("python", req[1], "pyproject.toml", true);

  const compose = (await read("docker-compose.yml")) || (await read("docker-compose.yaml")) || (await read("compose.yml"));
  if (compose) {
    for (const m of compose.matchAll(/image:\s*["']?([\w./-]+)(?::([\w.-]+))?/g)) {
      const type = IMAGE_TO_TYPE[m[1].split("/").pop()];
      if (type) add(type, m[2], "docker-compose.yml", !!m[2]);
    }
  }

  // dependency hints (default version)
  const deps = Object.keys({ ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) });
  if (pkg) add("node", null, "package.json", false);
  if (deps.some((d) => ["pg", "postgres", "sequelize", "typeorm"].includes(d))) add("postgres", null, "dependency: pg", false);
  if (deps.some((d) => ["redis", "ioredis", "bullmq"].includes(d))) add("redis", null, "dependency: redis", false);
  if (deps.some((d) => ["mongoose", "mongodb"].includes(d))) add("mongodb", null, "dependency: mongodb", false);

  const reqs = (await read("requirements.txt")) || "";
  if (reqs || pyproject) add("python", null, "python project", false);
  if (/psycopg|asyncpg|sqlalchemy/i.test(reqs)) add("postgres", null, "dependency: psycopg", false);
  if (/^redis/im.test(reqs)) add("redis", null, "dependency: redis", false);
  if (/pymongo|motor/i.test(reqs)) add("mongodb", null, "dependency: pymongo", false);

  return { services: [...found.values()].map(({ explicit, ...rest }) => rest), conflicts };
}

module.exports = { detectEnvironment };
