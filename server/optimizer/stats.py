"""Paired Wilcoxon signed-rank tests on optimizer/results/runs.csv  (same seeds => paired).
   pip install pandas scipy   then:   python optimizer/stats.py
"""
import pandas as pd
from scipy.stats import wilcoxon

df = pd.read_csv("optimizer/results/runs.csv")
metrics = ["whPerCoreH", "unmetPct", "costAvg"]
pairs = [("HYBRID_FC", "STATIC"), ("HYBRID_FC", "K8S"), ("HYBRID_FC", "HYBRID"), ("HYBRID", "STATIC")]

rows = []
for a, b in pairs:
    for m in metrics:
        x = df[df.strategy == a].sort_values("seed")[m].values
        y = df[df.strategy == b].sort_values("seed")[m].values
        stat, p = wilcoxon(x, y)
        rows.append((f"{a} vs {b}", m, x.mean(), y.mean(), 100 * (x.mean() - y.mean()) / y.mean(), p))

out = pd.DataFrame(rows, columns=["comparison", "metric", "mean_A", "mean_B", "change_%", "p_value"])
print(out.to_string(index=False, float_format=lambda v: f"{v:.4g}"))
print("\nBonferroni-corrected alpha for", len(rows), "tests:", 0.05 / len(rows))
