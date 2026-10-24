# Benchmark summary
30 seeded workloads, 288 steps (5 min each), 16 containers, 4 hosts x 6 cores. Mean ± 95% CI.

| Strategy | Energy (Wh/day) | Wh per core-hour served | Unmet demand (%) | Idle allocation (%) | CPU util (%) | Imbalance | Migrations | Decision (ms) | Cost J |
|---|---|---|---|---|---|---|---|---|---|
| Static allocation | 7481.61 ± 62.95 | 27.425 ± 0.247 | 8.56 ± 0.25 | 30.18 ± 0.20 | 47.42 ± 0.82 | 0.170 ± 0.009 | 0.00 ± 0.00 | 0.00 ± 0.00 | 2.495 ± 0.052 |
| K8s-style least-requested | 7482.91 ± 63.59 | 27.421 ± 0.249 | 8.54 ± 0.25 | 30.18 ± 0.20 | 47.43 ± 0.83 | 0.081 ± 0.004 | 0.00 ± 0.00 | 0.00 ± 0.00 | 2.463 ± 0.051 |
| ACO placement | 7703.46 ± 70.58 | 26.528 ± 0.226 | 3.14 ± 0.08 | 23.44 ± 0.06 | 50.74 ± 0.85 | 0.097 ± 0.003 | 65.73 ± 2.35 | 0.05 ± 0.03 | 1.388 ± 0.020 |
| PSO allocation | 7661.14 ± 61.79 | 26.759 ± 0.218 | 4.38 ± 0.20 | 16.23 ± 0.15 | 49.75 ± 0.80 | 0.189 ± 0.008 | 0.00 ± 0.00 | 0.83 ± 0.03 | 1.636 ± 0.045 |
| DVFS only | 6640.41 ± 97.91 | 22.969 ± 0.074 | 3.55 ± 0.18 | 23.44 ± 0.06 | 62.82 ± 0.46 | 0.146 ± 0.007 | 0.00 ± 0.00 | 0.00 ± 0.00 | 1.394 ± 0.044 |
| ACO+PSO+DVFS (reactive) | 6341.36 ± 96.76 | 21.993 ± 0.059 | 3.87 ± 0.09 | 16.94 ± 0.07 | 65.85 ± 0.41 | 0.071 ± 0.002 | 109.93 ± 2.44 | 1.28 ± 0.05 | 1.388 ± 0.024 |
| ACO+PSO+DVFS + forecast | 6721.12 ± 103.55 | 23.194 ± 0.067 | 3.43 ± 0.11 | 25.49 ± 0.22 | 61.49 ± 0.42 | 0.090 ± 0.003 | 116.90 ± 3.11 | 1.31 ± 0.08 | 1.366 ± 0.029 |

Forecast margin z = 1.

**Hybrid + forecast vs Static:** Wh/core-h -15.4%, unmet -60.0%, cost J -45.3%
**Hybrid + forecast vs Hybrid reactive (prior-work proxy):** Wh/core-h 5.5%, unmet -11.6%, cost J -1.6%
