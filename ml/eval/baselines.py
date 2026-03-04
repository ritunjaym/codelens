"""
Baseline rankers for the CodeLens evaluation suite.

All classes expose the same interface:
    rank(files: list[dict]) -> list[dict]

Each returned dict is the original file dict extended with a ``baseline_score``
key (float in [0, 1]).  The list is sorted by ``baseline_score`` descending.

Baselines (weakest → strongest):
1. RandomBaseline        — uniform random (floor)
2. FileSizeBaseline      — sigmoid of (additions + deletions)
3. BM25Baseline          — BM25 score against code-importance keywords
4. DenseOnlyBaseline     — CodeBERT cosine similarity (no reranker)
5. FullPipelineBaseline  — prism-reranker (ritunjaym/prism-reranker)
"""
from __future__ import annotations

import math
import random
import re


def _sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def _minmax(scores: list[float]) -> list[float]:
    """Min-max normalise to [0, 1]; returns 0.5 for constant lists."""
    lo, hi = min(scores), max(scores)
    if hi - lo < 1e-9:
        return [0.5] * len(scores)
    return [(s - lo) / (hi - lo) for s in scores]


# ── 1. Random ─────────────────────────────────────────────────────────────────

class RandomBaseline:
    """Scores files uniformly at random. Useful as a floor baseline."""

    def __init__(self, seed: int = 42):
        self._rng = random.Random(seed)

    def rank(self, files: list[dict]) -> list[dict]:
        """
        Args:
            files: List of file dicts with at least ``filename``.

        Returns:
            Shuffled list of files with ``baseline_score`` in [0, 1].
        """
        scored = [{**f, "baseline_score": self._rng.random()} for f in files]
        return sorted(scored, key=lambda x: x["baseline_score"], reverse=True)


# ── 2. FileSize ───────────────────────────────────────────────────────────────

class FileSizeBaseline:
    """
    Scores files by sigmoid of (additions + deletions).
    Larger changes → higher score.  Centred around 100 LOC.
    """

    def rank(self, files: list[dict]) -> list[dict]:
        """
        Args:
            files: List of file dicts with ``additions`` and ``deletions``.

        Returns:
            Files sorted by change size (desc), with ``baseline_score``.
        """
        scored = []
        for f in files:
            change_size = f.get("additions", 0) + f.get("deletions", 0)
            score = _sigmoid(change_size / 50.0 - 2.0)
            scored.append({**f, "baseline_score": score})
        return sorted(scored, key=lambda x: x["baseline_score"], reverse=True)


# ── 3. BM25 ───────────────────────────────────────────────────────────────────

_BM25_QUERY = [
    "def", "class", "import", "function", "auth", "api", "security",
    "critical", "fix", "feature", "token", "secret", "password", "key",
    "permission", "middleware", "handler", "router", "controller",
]


class BM25Baseline:
    """
    BM25 ranking of files against a fixed ``code-importance'' query.

    Requires the ``rank_bm25`` package (``pip install rank_bm25``).
    Falls back to FileSizeBaseline if not installed.
    """

    def rank(self, files: list[dict]) -> list[dict]:
        """
        Args:
            files: List of file dicts with ``patch`` text and ``filename``.

        Returns:
            Files sorted by BM25 relevance (desc), with ``baseline_score``.
        """
        try:
            from rank_bm25 import BM25Okapi
        except ImportError:
            print("BM25Baseline: rank_bm25 not installed, falling back to FileSize")
            return FileSizeBaseline().rank(files)

        corpus = [
            (f"{f.get('filename', '')} {(f.get('patch') or '')}").lower().split()
            for f in files
        ]
        # BM25 needs at least one non-empty document
        if not any(corpus):
            return [{**f, "baseline_score": 0.0} for f in files]

        bm25 = BM25Okapi(corpus)
        raw_scores = bm25.get_scores(_BM25_QUERY).tolist()
        normalized = _minmax(raw_scores)

        scored = [
            {**f, "baseline_score": normalized[i]}
            for i, f in enumerate(files)
        ]
        return sorted(scored, key=lambda x: x["baseline_score"], reverse=True)


# ── 4. Dense (CodeBERT) ───────────────────────────────────────────────────────

class DenseOnlyBaseline:
    """
    Ranks files by cosine similarity of their CodeBERT embedding to a fixed
    "important code change" anchor embedding.

    The anchor is the mean embedding of a curated set of security/core phrases.
    Falls back to FileSizeBaseline if transformers is not available.
    """

    _ANCHOR_TEXTS = [
        "authentication security token password",
        "critical bug fix core api",
        "refactor core business logic",
        "security vulnerability patch",
    ]

    def __init__(self):
        self._tokenizer = None
        self._model = None
        self._anchor: "np.ndarray | None" = None
        self._loaded = False

    def _load(self) -> None:
        if self._loaded:
            return
        self._loaded = True
        try:
            import numpy as np
            import torch
            from transformers import AutoModel, AutoTokenizer

            tok = AutoTokenizer.from_pretrained(
                "microsoft/codebert-base", cache_dir="/tmp/hf-cache"
            )
            mdl = AutoModel.from_pretrained(
                "microsoft/codebert-base", cache_dir="/tmp/hf-cache"
            )
            mdl.eval()
            self._tokenizer = tok
            self._model = mdl

            # Pre-compute anchor embedding
            anchor_embs = [self._embed(t) for t in self._ANCHOR_TEXTS]
            self._anchor = np.mean(anchor_embs, axis=0)
            self._anchor = self._anchor / (np.linalg.norm(self._anchor) + 1e-8)
        except Exception as e:
            print(f"DenseOnlyBaseline: could not load CodeBERT: {e}")

    def _embed(self, text: str) -> "np.ndarray":
        import numpy as np
        import torch

        inputs = self._tokenizer(
            text, return_tensors="pt", truncation=True, max_length=128
        )
        with torch.no_grad():
            out = self._model(**inputs)
        emb = out.last_hidden_state.mean(dim=1).squeeze().numpy()
        return emb / (np.linalg.norm(emb) + 1e-8)

    def rank(self, files: list[dict]) -> list[dict]:
        """
        Args:
            files: List of file dicts with ``filename`` and ``patch``.

        Returns:
            Files sorted by CodeBERT similarity (desc), with ``baseline_score``.
        """
        self._load()
        if self._model is None:
            return FileSizeBaseline().rank(files)

        import numpy as np

        raw_scores = []
        for f in files:
            text = f"{f.get('filename', '')}\n{(f.get('patch') or '')[:512]}"
            emb = self._embed(text)
            raw_scores.append(float(np.dot(emb, self._anchor)))

        normalized = _minmax(raw_scores)
        scored = [
            {**f, "baseline_score": normalized[i]}
            for i, f in enumerate(files)
        ]
        return sorted(scored, key=lambda x: x["baseline_score"], reverse=True)


# ── 5. Full Pipeline (prism-reranker) ─────────────────────────────────────────

class FullPipelineBaseline:
    """
    Ranks files using the fine-tuned prism-reranker model
    (``ritunjaym/prism-reranker``).

    Logits are min-max normalised across the PR so scores are always relative.
    Falls back to FileSizeBaseline if the model cannot be loaded.
    """

    def __init__(self):
        self._tokenizer = None
        self._model = None
        self._loaded = False

    def _load(self) -> None:
        if self._loaded:
            return
        self._loaded = True
        try:
            import torch
            from transformers import (
                AutoModelForSequenceClassification,
                AutoTokenizer,
            )

            self._tokenizer = AutoTokenizer.from_pretrained(
                "ritunjaym/prism-reranker", cache_dir="/tmp/hf-cache"
            )
            self._model = AutoModelForSequenceClassification.from_pretrained(
                "ritunjaym/prism-reranker", cache_dir="/tmp/hf-cache"
            )
            self._model.eval()
            print("FullPipelineBaseline: prism-reranker loaded")
        except Exception as e:
            print(f"FullPipelineBaseline: could not load reranker: {e}")

    def rank(self, files: list[dict]) -> list[dict]:
        """
        Args:
            files: List of file dicts with ``filename`` and ``patch``.

        Returns:
            Files sorted by reranker score (desc), with ``baseline_score``.
        """
        self._load()
        if self._model is None:
            return FileSizeBaseline().rank(files)

        import torch

        texts = [
            f"<file>{f.get('filename', '')}\n{(f.get('patch') or '')[:512]}"
            for f in files
        ]
        enc = self._tokenizer(
            texts,
            padding=True,
            truncation=True,
            max_length=128,
            return_tensors="pt",
        )
        with torch.no_grad():
            logits = self._model(**enc).logits.squeeze(-1)

        lo, hi = logits.min().item(), logits.max().item()
        if hi - lo < 1e-6:
            scores = [0.5] * len(files)
        else:
            scores = [(l - lo) / (hi - lo) for l in logits.tolist()]

        scored = [
            {**f, "baseline_score": scores[i]}
            for i, f in enumerate(files)
        ]
        return sorted(scored, key=lambda x: x["baseline_score"], reverse=True)


# ── Legacy ────────────────────────────────────────────────────────────────────
# Keep old PathHeuristicBaseline for backward compatibility with evaluate.py

_PATH_RE = re.compile(r"^(src|lib|core|pkg|cmd|internal|app)/", re.IGNORECASE)
_SEC_RE = re.compile(r"auth|crypto|secret|token|password", re.IGNORECASE)
_DOC_RE = re.compile(r"\.(md|txt|rst)$|^docs?/", re.IGNORECASE)


class PathHeuristicBaseline:
    """Path-based heuristic baseline (legacy, kept for backward compat)."""

    def rank(self, pr_files: list[dict]) -> list[dict]:
        scored = []
        for f in pr_files:
            filename = f.get("filename", "")
            score = self._path_score(filename)
            scored.append({**f, "baseline_score": score})
        return sorted(scored, key=lambda x: x["baseline_score"], reverse=True)

    def _path_score(self, filename: str) -> float:
        if _DOC_RE.search(filename):
            return 0.1
        if _SEC_RE.search(filename):
            return 0.95
        if _PATH_RE.match(filename):
            return 0.85
        ext = "." + filename.rsplit(".", 1)[-1] if "." in filename else ""
        if ext in {".json", ".yaml", ".yml", ".toml", ".lock", ".ini", ".cfg"}:
            return 0.3
        return 0.5
