const os = require("os");

exports.getMetrics = (start) => {

  const end = Date.now();

  return {
    cpu: os.loadavg()[0],
    memory: process.memoryUsage().rss / 1024 / 1024,
    time: (end - start) / 1000
  };

};
