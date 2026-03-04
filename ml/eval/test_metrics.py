"""
Unit tests for ml/eval/metrics.py — retrieval-style metrics.

All expected values are verified by hand below each test.
Run with:  pytest ml/eval/test_metrics.py -v
"""
from __future__ import annotations

import math
import pytest

from ml.eval.metrics import (
    mrr,
    ndcg_at_k,
    map_score,
    precision_at_k,
    bootstrap_ci,
)


# ── MRR ───────────────────────────────────────────────────────────────────────

class TestMRR:
    def test_first_item_relevant(self):
        # ranked=[0,2,1], relevant={0,2}
        # Rank 1 → item 0 → relevant → RR = 1/1 = 1.0
        assert mrr([[0, 2, 1]], [{0, 2}]) == pytest.approx(1.0)

    def test_second_item_relevant(self):
        # ranked=[1,0,1] (item IDs), relevant={0,2}
        # Rank 1 → item 1 → not relevant
        # Rank 2 → item 0 → relevant → RR = 1/2 = 0.5
        # MRR = 0.5
        assert mrr([[1, 0, 1]], [[0, 2]]) == pytest.approx(0.5)

    def test_no_relevant_item(self):
        # ranked=[3,4], relevant={0,1} → no match → RR = 0
        assert mrr([[3, 4]], [{0, 1}]) == pytest.approx(0.0)

    def test_multiple_queries_averaged(self):
        # Query 1: ranked=[3,4], relevant={0,2} → RR=0
        # Query 2: ranked=[0,1], relevant={0}   → RR=1.0
        # MRR = (0 + 1.0) / 2 = 0.5
        assert mrr([[3, 4], [0, 1]], [{0, 2}, {0}]) == pytest.approx(0.5)

    def test_relevant_at_third_position(self):
        # ranked=[2,3,0], relevant={0}
        # Rank 3 → item 0 → RR = 1/3
        assert mrr([[2, 3, 0]], [{0}]) == pytest.approx(1 / 3)

    def test_empty_ranked_list(self):
        assert mrr([[]], [{0}]) == pytest.approx(0.0)

    def test_empty_queries(self):
        assert mrr([], []) == pytest.approx(0.0)

    def test_perfect_ranking_multiple_queries(self):
        # Both queries find their relevant item at rank 1
        assert mrr([[0, 1, 2], [1, 0, 2]], [{0}, {1}]) == pytest.approx(1.0)


# ── NDCG@k ────────────────────────────────────────────────────────────────────

class TestNDCGAtK:
    def test_perfect_ranking(self):
        # ranked=[0,1,2,3], relevant={0,1}, k=2
        # DCG@2 = 1/log2(2) + 1/log2(3) = 1.0 + 0.63093 = 1.63093
        # IDCG@2 = same (both relevant at top-2)
        # NDCG@2 = 1.0
        assert ndcg_at_k([0, 1, 2, 3], {0, 1}, k=2) == pytest.approx(1.0)

    def test_imperfect_ranking(self):
        # ranked=[2,0,1,3], relevant={0,1}, k=2
        # Position 0: item 2 → not relevant (rel=0)
        # Position 1: item 0 → relevant    (rel=1)
        # DCG@2  = 0/log2(2) + 1/log2(3) = 0.63093
        # IDCG@2 = 1/log2(2) + 1/log2(3) = 1.63093
        # NDCG@2 = 0.63093 / 1.63093 ≈ 0.38685
        expected = (1 / math.log2(3)) / (1 / math.log2(2) + 1 / math.log2(3))
        assert ndcg_at_k([2, 0, 1, 3], {0, 1}, k=2) == pytest.approx(expected, abs=1e-5)

    def test_no_relevant_in_top_k(self):
        # ranked=[3,4,5], relevant={0,1}, k=2 → DCG@2 = 0 → NDCG = 0
        assert ndcg_at_k([3, 4, 5], {0, 1}, k=2) == pytest.approx(0.0)

    def test_empty_relevant_set(self):
        # No relevant items → IDCG=0 → return 0
        assert ndcg_at_k([0, 1, 2], set(), k=2) == pytest.approx(0.0)

    def test_k_larger_than_list(self):
        # ranked=[0,1], relevant={0,1}, k=10
        # DCG@10 = 1/log2(2) + 1/log2(3)
        # IDCG@10 = same (only 2 relevant)
        # NDCG = 1.0
        assert ndcg_at_k([0, 1], {0, 1}, k=10) == pytest.approx(1.0)

    def test_single_relevant_at_rank_1(self):
        # ranked=[0,1,2], relevant={0}, k=5
        # DCG  = 1/log2(2)
        # IDCG = 1/log2(2) (only 1 relevant, placed at rank 1 ideally)
        # NDCG = 1.0
        assert ndcg_at_k([0, 1, 2], {0}, k=5) == pytest.approx(1.0)

    def test_single_relevant_at_rank_2(self):
        # ranked=[1,0,2], relevant={0}, k=5
        # DCG  = 1/log2(3)
        # IDCG = 1/log2(2)
        # NDCG = log2(2)/log2(3)
        expected = math.log2(2) / math.log2(3)
        assert ndcg_at_k([1, 0, 2], {0}, k=5) == pytest.approx(expected, abs=1e-5)

    def test_ndcg_at_5_versus_10(self):
        # With all 3 relevant in top 3, both k=5 and k=10 should give 1.0
        assert ndcg_at_k([0, 1, 2, 3, 4], {0, 1, 2}, k=5) == pytest.approx(1.0)
        assert ndcg_at_k([0, 1, 2, 3, 4], {0, 1, 2}, k=10) == pytest.approx(1.0)


# ── MAP ───────────────────────────────────────────────────────────────────────

class TestMAPScore:
    def test_perfect_ranking(self):
        # ranked=[0,1,2], relevant={0,1}
        # Position 0: item 0 → relevant → P@1=1.0
        # Position 1: item 1 → relevant → P@2=1.0
        # AP = (1.0 + 1.0) / 2 = 1.0 ; MAP = 1.0
        assert map_score([[0, 1, 2]], [{0, 1}]) == pytest.approx(1.0)

    def test_imperfect_ranking(self):
        # ranked=[2,0,1], relevant={0,1}
        # Position 0: item 2 → not relevant
        # Position 1: item 0 → relevant → P@2 = 1/2
        # Position 2: item 1 → relevant → P@3 = 2/3
        # AP = (0.5 + 2/3) / 2 = 7/12 ≈ 0.5833
        expected = (0.5 + 2 / 3) / 2
        assert map_score([[2, 0, 1]], [{0, 1}]) == pytest.approx(expected, abs=1e-5)

    def test_no_relevant_found(self):
        # ranked=[3,4], relevant={0,1} → no hits → AP=0
        assert map_score([[3, 4]], [{0, 1}]) == pytest.approx(0.0)

    def test_multiple_queries_averaged(self):
        # Query 1: ranked=[0,2,1], relevant={0} → P@1=1 → AP=1.0
        # Query 2: ranked=[1,0,2], relevant={1} → P@1=1 → AP=1.0
        # MAP = 1.0
        assert map_score([[0, 2, 1], [1, 0, 2]], [{0}, {1}]) == pytest.approx(1.0)

    def test_multiple_queries_mixed(self):
        # Query 1: ranked=[2,0,1], relevant={0} → P@2=1/2 → AP=0.5
        # Query 2: ranked=[2,1,0], relevant={1} → P@2=1/2 → AP=0.5
        # MAP = 0.5
        assert map_score([[2, 0, 1], [2, 1, 0]], [{0}, {1}]) == pytest.approx(0.5)

    def test_empty_queries(self):
        assert map_score([], []) == pytest.approx(0.0)

    def test_query_with_empty_relevant_skipped(self):
        # Query 1 has no relevant → skipped
        # Query 2: ranked=[0,1], relevant={0} → AP=1.0
        # MAP = 1.0 (only 1 valid query)
        assert map_score([[0, 1], [0, 1]], [set(), {0}]) == pytest.approx(1.0)


# ── Precision@k ───────────────────────────────────────────────────────────────

class TestPrecisionAtK:
    def test_perfect_precision_at_2(self):
        # ranked=[0,1,2,3], relevant={0,1}, k=2
        # Top-2: [0,1] → 2 relevant → P@2 = 2/2 = 1.0
        assert precision_at_k([0, 1, 2, 3], {0, 1}, k=2) == pytest.approx(1.0)

    def test_half_precision_at_2(self):
        # ranked=[2,0,1,3], relevant={0,1}, k=2
        # Top-2: [2,0] → 1 relevant → P@2 = 1/2 = 0.5
        assert precision_at_k([2, 0, 1, 3], {0, 1}, k=2) == pytest.approx(0.5)

    def test_perfect_precision_at_1(self):
        # ranked=[0,1,2], relevant={0,1}, k=1 → item 0 relevant → P@1=1.0
        assert precision_at_k([0, 1, 2], {0, 1}, k=1) == pytest.approx(1.0)

    def test_zero_precision_at_1(self):
        # ranked=[2,3,4], relevant={0,1}, k=1 → item 2 not relevant → P@1=0.0
        assert precision_at_k([2, 3, 4], {0, 1}, k=1) == pytest.approx(0.0)

    def test_precision_at_k_zero(self):
        assert precision_at_k([0, 1, 2], {0, 1}, k=0) == pytest.approx(0.0)

    def test_precision_at_5_partial(self):
        # ranked=[0,2,3,4,1], relevant={0,1}, k=5
        # Top-5: all items, 2 relevant (0 and 1) → P@5 = 2/5 = 0.4
        assert precision_at_k([0, 2, 3, 4, 1], {0, 1}, k=5) == pytest.approx(0.4)

    def test_precision_at_k_larger_than_list(self):
        # k > len(list): only consider items that exist
        # ranked=[0,1], relevant={0,1}, k=5
        # Only 2 items in top-5 → both relevant → hits=2, P = 2/5 = 0.4
        assert precision_at_k([0, 1], {0, 1}, k=5) == pytest.approx(0.4)

    def test_no_relevant_items(self):
        assert precision_at_k([0, 1, 2], set(), k=3) == pytest.approx(0.0)


# ── Bootstrap CI ──────────────────────────────────────────────────────────────

class TestBootstrapCI:
    def test_ci_contains_mean(self):
        data = [0.0, 0.5, 1.0]
        mean, lo, hi = bootstrap_ci(lambda d: sum(d) / len(d), data, n_bootstrap=500)
        assert lo <= mean <= hi

    def test_mean_matches_metric(self):
        data = [0.2, 0.4, 0.6, 0.8]
        mean, _, _ = bootstrap_ci(lambda d: sum(d) / len(d), data, n_bootstrap=200)
        assert mean == pytest.approx(0.5, abs=1e-6)

    def test_bounds_ordered(self):
        data = list(range(20))
        mean, lo, hi = bootstrap_ci(lambda d: sum(d) / len(d), data, n_bootstrap=500)
        assert lo <= hi

    def test_empty_data(self):
        mean, lo, hi = bootstrap_ci(lambda d: 0.0, [], n_bootstrap=100)
        assert (mean, lo, hi) == (0.0, 0.0, 0.0)

    def test_constant_data_narrow_ci(self):
        # All values identical → all resamples give same metric → CI width ≈ 0
        data = [1.0] * 20
        mean, lo, hi = bootstrap_ci(lambda d: sum(d) / len(d), data, n_bootstrap=200)
        assert mean == pytest.approx(1.0)
        assert (hi - lo) == pytest.approx(0.0, abs=1e-6)

    def test_reproducibility(self):
        data = [0.1, 0.3, 0.5, 0.7, 0.9]
        r1 = bootstrap_ci(lambda d: sum(d) / len(d), data, seed=7)
        r2 = bootstrap_ci(lambda d: sum(d) / len(d), data, seed=7)
        assert r1 == r2

    def test_95_ci_wider_than_80_ci(self):
        data = [float(i) for i in range(50)]
        _, lo95, hi95 = bootstrap_ci(lambda d: sum(d) / len(d), data, ci=0.95)
        _, lo80, hi80 = bootstrap_ci(lambda d: sum(d) / len(d), data, ci=0.80)
        assert (hi95 - lo95) >= (hi80 - lo80)
