"""
Evaluation metrics for ranking and retrieval tasks.

Retrieval-style metrics (mrr, ndcg_at_k, map_score, precision_at_k, bootstrap_ci)
work on ranked lists of item IDs compared against a set of relevant item IDs.

Legacy regression-style metrics (ranking_metrics, retrieval_metrics,
clustering_metrics) are kept for backward compatibility with evaluate.py.
"""
from __future__ import annotations

import math
import random
from typing import Any, Callable

import numpy as np


# ── Retrieval metrics ─────────────────────────────────────────────────────────

def mrr(ranked_lists: list[list], relevant_items: list[set | list]) -> float:
    """
    Mean Reciprocal Rank over multiple queries.

    For each query the reciprocal rank is 1/r where r is the 1-based position
    of the first relevant item in the ranked list. If no relevant item appears,
    the reciprocal rank is 0.

    Args:
        ranked_lists:    List of ranked item lists, one per query.
                         Each inner list contains item IDs in ranked order
                         (index 0 = highest rank).
        relevant_items:  List of relevant-item collections, one per query.
                         Each element may be a set or list of relevant item IDs.

    Returns:
        Mean reciprocal rank in [0, 1].

    Example:
        >>> mrr([[1, 0, 1]], [[0, 2]])
        0.5
    """
    if not ranked_lists:
        return 0.0

    rr_scores: list[float] = []
    for ranked, relevant in zip(ranked_lists, relevant_items):
        rel_set = set(relevant)
        rr = 0.0
        for rank, item in enumerate(ranked, start=1):
            if item in rel_set:
                rr = 1.0 / rank
                break
        rr_scores.append(rr)

    return float(sum(rr_scores) / len(rr_scores))


def ndcg_at_k(ranked_list: list, relevant_items: set | list, k: int) -> float:
    """
    Normalized Discounted Cumulative Gain at cutoff k (binary relevance).

    DCG@k  = sum_{i=1}^{k}  rel_i / log2(i+1)
    IDCG@k = sum_{i=1}^{n*} 1    / log2(i+1)  where n* = min(k, |relevant|)
    NDCG@k = DCG@k / IDCG@k

    Args:
        ranked_list:     List of item IDs in ranked order (index 0 = rank 1).
        relevant_items:  Set or list of relevant item IDs.
        k:               Cutoff depth.

    Returns:
        NDCG@k in [0, 1]. Returns 0.0 if there are no relevant items.

    Example:
        >>> round(ndcg_at_k([0, 1, 2, 3], {0, 1}, k=2), 5)
        1.0
    """
    rel_set = set(relevant_items)
    if not rel_set:
        return 0.0

    # DCG for the predicted ranking
    dcg = 0.0
    for i, item in enumerate(ranked_list[:k], start=1):
        if item in rel_set:
            dcg += 1.0 / math.log2(i + 1)

    # Ideal DCG: place all relevant items at the top
    n_ideal = min(k, len(rel_set))
    idcg = sum(1.0 / math.log2(i + 1) for i in range(1, n_ideal + 1))

    return dcg / idcg if idcg > 0 else 0.0


def map_score(ranked_lists: list[list], relevant_items: list[set | list]) -> float:
    """
    Mean Average Precision (MAP) over multiple queries.

    AP for a query = (1 / |R|) * sum_{k: item_k relevant} P@k
    where P@k = (# relevant in top k) / k and |R| = # relevant items.

    Args:
        ranked_lists:    List of ranked item lists, one per query.
        relevant_items:  List of relevant-item collections, one per query.

    Returns:
        MAP in [0, 1]. Queries with no relevant items are skipped.

    Example:
        >>> round(map_score([[0, 1, 2]], [{0, 1}]), 5)
        1.0
    """
    if not ranked_lists:
        return 0.0

    ap_scores: list[float] = []
    for ranked, relevant in zip(ranked_lists, relevant_items):
        rel_set = set(relevant)
        if not rel_set:
            continue

        hits = 0
        precision_sum = 0.0
        for k, item in enumerate(ranked, start=1):
            if item in rel_set:
                hits += 1
                precision_sum += hits / k

        ap_scores.append(precision_sum / len(rel_set))

    return float(sum(ap_scores) / len(ap_scores)) if ap_scores else 0.0


def precision_at_k(ranked_list: list, relevant_items: set | list, k: int) -> float:
    """
    Precision at cutoff k.

    P@k = (# relevant items in top-k positions) / k

    Args:
        ranked_list:     List of item IDs in ranked order (index 0 = rank 1).
        relevant_items:  Set or list of relevant item IDs.
        k:               Cutoff depth.

    Returns:
        Precision@k in [0, 1]. Returns 0.0 if k == 0.

    Example:
        >>> precision_at_k([0, 1, 2, 3], {0, 1}, k=2)
        1.0
    """
    if k == 0:
        return 0.0
    rel_set = set(relevant_items)
    hits = sum(1 for item in ranked_list[:k] if item in rel_set)
    return hits / k


def bootstrap_ci(
    metric_fn: Callable[[list], float],
    data: list,
    n_bootstrap: int = 1000,
    ci: float = 0.95,
    seed: int = 42,
) -> tuple[float, float, float]:
    """
    Non-parametric bootstrap confidence interval for any scalar metric.

    Resamples ``data`` with replacement ``n_bootstrap`` times, applies
    ``metric_fn`` to each resample, and returns the empirical percentile CI.

    Args:
        metric_fn:   Function that maps a list of samples → float.
        data:        Original dataset (list of any elements).
        n_bootstrap: Number of bootstrap resamples (default 1000).
        ci:          Confidence level in (0, 1), e.g. 0.95 for 95% CI.
        seed:        Random seed for reproducibility (default 42).

    Returns:
        (mean, lower, upper) where mean = metric_fn(data) and [lower, upper]
        is the bootstrap percentile CI.

    Example:
        >>> mean, lo, hi = bootstrap_ci(lambda d: sum(d)/len(d), [0, 0.5, 1.0])
        >>> lo <= mean <= hi
        True
    """
    if not data:
        return 0.0, 0.0, 0.0

    rng = random.Random(seed)
    n = len(data)
    bootstrap_stats: list[float] = []

    for _ in range(n_bootstrap):
        resample = [data[rng.randint(0, n - 1)] for _ in range(n)]
        bootstrap_stats.append(metric_fn(resample))

    bootstrap_stats.sort()
    alpha = 1.0 - ci
    lo_idx = int(alpha / 2 * n_bootstrap)
    hi_idx = int((1 - alpha / 2) * n_bootstrap) - 1
    hi_idx = min(hi_idx, n_bootstrap - 1)

    mean_val = metric_fn(data)
    return float(mean_val), float(bootstrap_stats[lo_idx]), float(bootstrap_stats[hi_idx])


# ── Legacy regression-style metrics (kept for backward compat) ─────────────────

def ranking_metrics(y_true: list[float], y_pred: list[float]) -> dict[str, float]:
    """
    Compute ranking metrics between true importance scores and predicted scores.

    Returns: MSE, MAE, Spearman rho, Kendall tau, NDCG@5, NDCG@10
    """
    if len(y_true) != len(y_pred):
        raise ValueError("y_true and y_pred must have the same length")
    if len(y_true) == 0:
        return {}

    yt = np.array(y_true, dtype=float)
    yp = np.array(y_pred, dtype=float)

    mse = float(np.mean((yt - yp) ** 2))
    mae = float(np.mean(np.abs(yt - yp)))
    spearman = _spearman(yt, yp)
    kendall = _kendall(yt, yp)
    ndcg5 = _ndcg(yt, yp, k=5)
    ndcg10 = _ndcg(yt, yp, k=10)

    return {
        "mse": round(mse, 6),
        "mae": round(mae, 6),
        "spearman_rho": round(spearman, 6),
        "kendall_tau": round(kendall, 6),
        "ndcg@5": round(ndcg5, 6),
        "ndcg@10": round(ndcg10, 6),
    }


def retrieval_metrics(
    queries: list[np.ndarray],
    retrieved_indices: list[list[int]],
    relevant_indices: list[list[int]],
    k_values: list[int] = (5, 10),
) -> dict[str, float]:
    """
    Compute retrieval metrics: Recall@k and MRR.

    Args:
        queries:            Not used directly; kept for API compatibility.
        retrieved_indices:  For each query, list of retrieved item indices.
        relevant_indices:   For each query, list of relevant item indices.
        k_values:           List of k values for Recall@k.
    """
    if not queries:
        return {}

    results: dict[str, float] = {}

    for k in k_values:
        recalls = []
        for retrieved, relevant in zip(retrieved_indices, relevant_indices):
            if not relevant:
                continue
            retrieved_k = set(retrieved[:k])
            relevant_set = set(relevant)
            recall = len(retrieved_k & relevant_set) / len(relevant_set)
            recalls.append(recall)
        results[f"recall@{k}"] = round(float(np.mean(recalls)) if recalls else 0.0, 6)

    reciprocal_ranks = []
    for retrieved, relevant in zip(retrieved_indices, relevant_indices):
        relevant_set = set(relevant)
        for rank, idx in enumerate(retrieved, 1):
            if idx in relevant_set:
                reciprocal_ranks.append(1.0 / rank)
                break
        else:
            reciprocal_ranks.append(0.0)

    results["mrr"] = round(
        float(np.mean(reciprocal_ranks)) if reciprocal_ranks else 0.0, 6
    )
    return results


def clustering_metrics(embeddings: np.ndarray, labels: list[int]) -> dict[str, float]:
    """
    Compute clustering quality: Silhouette score and Davies-Bouldin index.
    Requires sklearn.
    """
    unique_labels = set(labels)
    if len(unique_labels) < 2:
        return {"silhouette": 0.0, "davies_bouldin": float("inf")}

    try:
        from sklearn.metrics import silhouette_score, davies_bouldin_score
        sil = float(silhouette_score(embeddings, labels, metric="cosine"))
        db = float(davies_bouldin_score(embeddings, labels))
        return {
            "silhouette": round(sil, 6),
            "davies_bouldin": round(db, 6),
        }
    except ImportError:
        return {"silhouette": 0.0, "davies_bouldin": 0.0}


# ── Internal helpers ───────────────────────────────────────────────────────────

def _rank_array(arr: np.ndarray) -> np.ndarray:
    """Convert values to 1-based ranks (ascending)."""
    order = np.argsort(arr)
    ranks = np.empty_like(order, dtype=float)
    ranks[order] = np.arange(1, len(arr) + 1)
    return ranks


def _spearman(a: np.ndarray, b: np.ndarray) -> float:
    if len(a) < 2:
        return 0.0
    ra = _rank_array(a)
    rb = _rank_array(b)
    d = ra - rb
    n = len(a)
    return float(1 - 6 * np.sum(d ** 2) / (n * (n ** 2 - 1)))


def _kendall(a: np.ndarray, b: np.ndarray) -> float:
    if len(a) < 2:
        return 0.0
    n = len(a)
    concordant = discordant = 0
    for i in range(n):
        for j in range(i + 1, n):
            sign_a = np.sign(a[i] - a[j])
            sign_b = np.sign(b[i] - b[j])
            if sign_a * sign_b > 0:
                concordant += 1
            elif sign_a * sign_b < 0:
                discordant += 1
    total = n * (n - 1) // 2
    return float((concordant - discordant) / total) if total > 0 else 0.0


def _dcg(scores: list[float], k: int) -> float:
    return sum(rel / math.log2(rank + 2) for rank, rel in enumerate(scores[:k]))


def _ndcg(y_true: np.ndarray, y_pred: np.ndarray, k: int) -> float:
    if len(y_true) == 0:
        return 0.0
    pred_order = np.argsort(y_pred)[::-1]
    pred_gains = y_true[pred_order].tolist()
    ideal_order = np.argsort(y_true)[::-1]
    ideal_gains = y_true[ideal_order].tolist()
    ideal_dcg = _dcg(ideal_gains, k)
    if ideal_dcg == 0:
        return 0.0
    return _dcg(pred_gains, k) / ideal_dcg
