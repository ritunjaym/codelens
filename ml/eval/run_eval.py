"""
CodeLens — ML Evaluation Suite
================================
Loads the test split, runs all 5 baselines, computes retrieval metrics
with 95 % bootstrap CI, runs paired t-tests vs FullPipeline, then saves:
  - ml/eval/results.json
  - ml/eval/results_table.md

Usage:
    python -m ml.eval.run_eval                  # uses HF test split
    python -m ml.eval.run_eval --max-prs 50     # limit for quick runs
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Callable

EVAL_DIR = Path(__file__).parent
REPO_ROOT = EVAL_DIR.parent.parent

if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from ml.eval.metrics import (
    bootstrap_ci,
    map_score,
    mrr,
    ndcg_at_k,
    precision_at_k,
)
from ml.eval.baselines import (
    BM25Baseline,
    DenseOnlyBaseline,
    FileSizeBaseline,
    FullPipelineBaseline,
    RandomBaseline,
)

# ── Constants ─────────────────────────────────────────────────────────────────

RELEVANCE_THRESHOLD = 0.5   # importance_score ≥ this → "relevant"
BASELINES: dict[str, object] = {
    "Random":       RandomBaseline(seed=42),
    "FileSize":     FileSizeBaseline(),
    "BM25":         BM25Baseline(),
    "DenseOnly":    DenseOnlyBaseline(),
    "FullPipeline": FullPipelineBaseline(),
}


# ── Data loading ──────────────────────────────────────────────────────────────

def _load_test_prs(max_prs: int = 0) -> dict[int, list[dict]]:
    """
    Load test-split PR records grouped by pr_id.

    Priority:
    1. ml/data/hf_dataset (test split)
    2. ml/data/processed/pr_files.jsonl  (all data, used as fallback)

    Returns:
        {pr_id: [file_record, ...]} where each pr has ≥ 2 files.
    """
    records: list[dict] = []

    # 1 — HF dataset test split
    hf_path = REPO_ROOT / "ml" / "data" / "hf_dataset"
    if hf_path.exists():
        try:
            from datasets import load_from_disk
            ds = load_from_disk(str(hf_path))
            split = ds.get("test") or ds.get("validation") or ds.get("train")
            if split:
                records = [split[i] for i in range(len(split))]
                print(f"Loaded {len(records)} records from HF test split")
        except Exception as e:
            print(f"HF dataset load failed ({e}), trying JSONL …")

    # 2 — JSONL fallback
    if not records:
        jsonl = REPO_ROOT / "ml" / "data" / "processed" / "pr_files.jsonl"
        if jsonl.exists():
            with open(jsonl) as fh:
                for line in fh:
                    if line.strip():
                        records.append(json.loads(line))
            print(f"Loaded {len(records)} records from pr_files.jsonl")

    if not records:
        raise FileNotFoundError(
            "No evaluation data found. Expected ml/data/hf_dataset or "
            "ml/data/processed/pr_files.jsonl"
        )

    # Group by pr_id
    by_pr: dict[int, list[dict]] = defaultdict(list)
    for r in records:
        by_pr[r["pr_id"]].append(r)

    # Keep only PRs with ≥ 2 files (needed for meaningful ranking)
    by_pr = {k: v for k, v in by_pr.items() if len(v) >= 2}

    if max_prs and len(by_pr) > max_prs:
        keys = sorted(by_pr)[:max_prs]
        by_pr = {k: by_pr[k] for k in keys}

    print(f"Evaluating on {len(by_pr)} PRs")
    return by_pr


# ── Per-PR metric computation ─────────────────────────────────────────────────

def _relevant_set(files: list[dict]) -> set[str]:
    """
    Return the set of filenames considered "relevant" for review.

    Uses a fixed threshold; if no file exceeds it, treats the top half
    of files (by importance_score) as relevant to avoid empty-positive sets.
    """
    above = {
        f["filename"]
        for f in files
        if f.get("importance_score", 0.0) >= RELEVANCE_THRESHOLD
    }
    if above:
        return above
    # Fallback: top half by score
    sorted_files = sorted(files, key=lambda f: f.get("importance_score", 0), reverse=True)
    half = max(1, len(sorted_files) // 2)
    return {f["filename"] for f in sorted_files[:half]}


def _metrics_for_pr(ranked_filenames: list[str], relevant: set[str]) -> dict[str, float]:
    """Compute all retrieval metrics for a single PR."""
    return {
        "ndcg@5":  ndcg_at_k(ranked_filenames, relevant, k=5),
        "ndcg@10": ndcg_at_k(ranked_filenames, relevant, k=10),
        "mrr":     mrr([ranked_filenames], [relevant]),
        "map":     map_score([ranked_filenames], [relevant]),
        "p@1":     precision_at_k(ranked_filenames, relevant, k=1),
        "p@5":     precision_at_k(ranked_filenames, relevant, k=5),
    }


# ── Evaluation loop ───────────────────────────────────────────────────────────

def _run_baseline(
    name: str,
    baseline,
    prs: dict[int, list[dict]],
) -> dict[str, list[float]]:
    """
    Run *baseline* on every PR and return per-PR metric lists.

    Returns:
        {"ndcg@5": [score_pr1, score_pr2, ...], ...}
    """
    per_metric: dict[str, list[float]] = defaultdict(list)

    for pr_id, files in prs.items():
        try:
            ranked = baseline.rank(files)
            ranked_names = [r["filename"] for r in ranked]
            relevant = _relevant_set(files)
            m = _metrics_for_pr(ranked_names, relevant)
            for metric, val in m.items():
                per_metric[metric].append(val)
        except Exception as e:
            print(f"  [{name}] PR {pr_id} failed: {e}")

    return dict(per_metric)


def _aggregate(per_metric: dict[str, list[float]]) -> dict[str, dict]:
    """
    Aggregate per-PR scores into mean ± 95 % bootstrap CI.

    Returns:
        {"ndcg@5": {"mean": 0.42, "ci_lo": 0.38, "ci_hi": 0.46}, ...}
    """
    agg: dict[str, dict] = {}
    for metric, scores in per_metric.items():
        mean_fn: Callable[[list[float]], float] = lambda d: sum(d) / len(d) if d else 0.0
        mean, lo, hi = bootstrap_ci(mean_fn, scores, n_bootstrap=1000, ci=0.95)
        agg[metric] = {"mean": round(mean, 4), "ci_lo": round(lo, 4), "ci_hi": round(hi, 4)}
    return agg


# ── Statistical significance ──────────────────────────────────────────────────

def _paired_ttest(a: list[float], b: list[float]) -> tuple[float, float]:
    """
    Paired t-test: H0 that mean(a - b) = 0.

    Returns:
        (t_statistic, p_value)
    """
    try:
        from scipy.stats import ttest_rel
        n = min(len(a), len(b))
        result = ttest_rel(a[:n], b[:n])
        return float(result.statistic), float(result.pvalue)
    except ImportError:
        # Manual implementation
        import math
        diffs = [x - y for x, y in zip(a, b)]
        n = len(diffs)
        if n < 2:
            return 0.0, 1.0
        mean_d = sum(diffs) / n
        var_d = sum((d - mean_d) ** 2 for d in diffs) / (n - 1)
        se = math.sqrt(var_d / n) + 1e-12
        t = mean_d / se
        # Approximate p-value via normal distribution for large n
        z = abs(t)
        p = 2 * (1 - _norm_cdf(z))
        return t, p


def _norm_cdf(x: float) -> float:
    """Approximation of the standard normal CDF via math.erfc."""
    import math
    return 0.5 * math.erfc(-x / math.sqrt(2))


# ── Formatting ────────────────────────────────────────────────────────────────

_METRICS = ["ndcg@5", "ndcg@10", "mrr", "map", "p@1", "p@5"]
_METRIC_LABELS = {
    "ndcg@5":  "NDCG@5",
    "ndcg@10": "NDCG@10",
    "mrr":     "MRR",
    "map":     "MAP",
    "p@1":     "P@1",
    "p@5":     "P@5",
}


def _build_table(
    aggregated: dict[str, dict[str, dict]],
    significance: dict[str, dict[str, tuple[float, float]]],
) -> str:
    """Render results as a Markdown table."""
    # Header
    col_headers = [
        f"{_METRIC_LABELS[m]}" for m in _METRICS
    ]
    header = "| Baseline | " + " | ".join(col_headers) + " |"
    sep = "|" + "|".join(["-" * (len(h) + 2) for h in ["Baseline"] + col_headers]) + "|"

    rows = [header, sep]
    for name, metrics in aggregated.items():
        cells = []
        for m in _METRICS:
            if m not in metrics:
                cells.append("—")
                continue
            s = metrics[m]
            cell = f"{s['mean']:.4f} [{s['ci_lo']:.4f}, {s['ci_hi']:.4f}]"
            # Add significance marker vs FullPipeline
            if name != "FullPipeline" and name in significance:
                _, p = significance[name].get(m, (0.0, 1.0))
                cell += " **" if p < 0.05 else ""
            cells.append(cell)
        rows.append(f"| {name} | " + " | ".join(cells) + " |")

    rows.append("")
    rows.append("\\*\\* p < 0.05 vs FullPipeline (paired t-test, primary metric: NDCG@5)")
    return "\n".join(rows)


# ── Main ──────────────────────────────────────────────────────────────────────

def run_eval(max_prs: int = 0) -> dict:
    """
    Run the full evaluation and return the results dict.

    Args:
        max_prs: If > 0, evaluate on at most this many PRs (for quick runs).

    Returns:
        Nested dict: {baseline_name: {metric: {mean, ci_lo, ci_hi}}}
    """
    prs = _load_test_prs(max_prs=max_prs)

    # Run all baselines
    per_baseline: dict[str, dict[str, list[float]]] = {}
    for name, baseline in BASELINES.items():
        print(f"\nRunning {name} …")
        per_baseline[name] = _run_baseline(name, baseline, prs)

    # Aggregate with bootstrap CI
    aggregated: dict[str, dict[str, dict]] = {
        name: _aggregate(scores)
        for name, scores in per_baseline.items()
    }

    # Statistical significance vs FullPipeline (primary: ndcg@5)
    full_scores = per_baseline.get("FullPipeline", {})
    significance: dict[str, dict[str, tuple[float, float]]] = {}

    for name, scores in per_baseline.items():
        if name == "FullPipeline":
            continue
        sig_for_baseline: dict[str, tuple[float, float]] = {}
        for m in _METRICS:
            a = full_scores.get(m, [])
            b = scores.get(m, [])
            if a and b:
                sig_for_baseline[m] = _paired_ttest(a, b)
        significance[name] = sig_for_baseline

    # Build output
    results = {
        "baselines": aggregated,
        "significance_vs_fullpipeline": {
            name: {m: {"t": round(t, 4), "p": round(p, 4)}
                   for m, (t, p) in metrics.items()}
            for name, metrics in significance.items()
        },
        "n_prs": len(prs),
        "relevance_threshold": RELEVANCE_THRESHOLD,
    }

    # Save JSON
    results_json = EVAL_DIR / "results.json"
    results_json.write_text(json.dumps(results, indent=2))
    print(f"\nSaved {results_json}")

    # Build and save Markdown table
    table_md = "# CodeLens ML Evaluation Results\n\n"
    table_md += f"PRs evaluated: {len(prs)} | Relevance threshold: ≥ {RELEVANCE_THRESHOLD}\n\n"
    table_md += _build_table(aggregated, significance)
    table_md += "\n\n## Significance Tests (FullPipeline vs. others)\n\n"
    table_md += "| Baseline | Metric | t | p |\n|---|---|---|---|\n"
    for name, metrics in significance.items():
        for m, (t, p) in sorted(metrics.items()):
            marker = " ✓" if p < 0.05 else ""
            table_md += f"| {name} | {_METRIC_LABELS.get(m, m)} | {t:.3f} | {p:.4f}{marker} |\n"

    results_md = EVAL_DIR / "results_table.md"
    results_md.write_text(table_md)
    print(f"Saved {results_md}")

    # Print summary table
    print("\n" + "=" * 72)
    print("EVALUATION RESULTS")
    print("=" * 72)
    print(f"{'Baseline':<18}  {'NDCG@5':>8}  {'NDCG@10':>9}  {'MRR':>8}  {'MAP':>8}  {'P@1':>8}  {'P@5':>8}")
    print("-" * 72)
    for name, metrics in aggregated.items():
        row = f"{name:<18}"
        for m in _METRICS:
            mean = metrics.get(m, {}).get("mean", 0.0)
            row += f"  {mean:>8.4f}"
        print(row)
    print("=" * 72)

    # Print significance summary
    print("\nStatistical significance vs. FullPipeline (primary: NDCG@5):")
    for name, metrics in significance.items():
        t, p = metrics.get("ndcg@5", (0.0, 1.0))
        sig = "SIGNIFICANT" if p < 0.05 else "not significant"
        print(f"  {name:<18}  t={t:+.3f}  p={p:.4f}  → {sig}")

    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CodeLens ML Evaluation Suite")
    parser.add_argument(
        "--max-prs", type=int, default=0,
        help="Max PRs to evaluate (0 = all; use 20 for quick test)"
    )
    args = parser.parse_args()
    run_eval(max_prs=args.max_prs)
