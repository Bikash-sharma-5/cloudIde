const fs = require("fs");

const ALGO = process.env.ALGORITHM || "DVFS";

function generateMetrics() {
  const cpu = Math.random() * 100;
  const memory = Math.random() * 1000;

  let energy = 0;

  switch (ALGO) {
    case "DVFS":
      energy = cpu * 0.45 + Math.random() * 5;
      break;

    case "PSO":
      energy = cpu * 0.35 + Math.random() * 4;
      break;

    case "ACO":
      energy = cpu * 0.25 + Math.random() * 3;
      break;

    default:
      energy = cpu * 0.6;
  }

  return {
    cpu: Number(cpu.toFixed(2)),
    memory: Number(memory.toFixed(2)),
    energy: Number(energy.toFixed(2)),
    algorithm: ALGO,
    time: Date.now()
  };
}


// 🔥 SEND TO BACKEND (via file)
setInterval(() => {
  const metric = generateMetrics();

  console.log("METRIC:", metric);

  fs.appendFileSync(
    "/workspace/metrics.log",
    JSON.stringify(metric) + "\n"
  );
}, 2000);
