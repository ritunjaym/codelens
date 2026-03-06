import math
import os
import pickle
import time
import tracemalloc
from collections import deque
from typing import Optional

import numpy as np
import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

logger = structlog.get_logger()

tracemalloc.start()

app = FastAPI(title="CodeLens API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Latency tracking ──────────────────────────────────────────────────────────
_latency_ms: deque = deque(maxlen=1000)
_request_count: int = 0


# ── CodeBERT embedder ─────────────────────────────────────────────────────────
_embedder = None
try:
    from transformers import AutoModel, AutoTokenizer
    import torch

    _tokenizer = AutoTokenizer.from_pretrained(
        "microsoft/codebert-base", cache_dir="/tmp/hf-cache"
    )
    _model = AutoModel.from_pretrained(
        "microsoft/codebert-base", cache_dir="/tmp/hf-cache"
    )
    _model.eval()
    _embedder = (_tokenizer, _model)
    logger.info("CodeBERT loaded successfully")
except Exception as e:
    logger.warning("CodeBERT not loaded (using heuristics)", error=str(e))


# ── Fine-tuned reranker ───────────────────────────────────────────────────────
_reranker_tokenizer = None
_reranker_model = None

try:
    from transformers import AutoModelForSequenceClassification, AutoTokenizer
    import torch

    _reranker_tokenizer = AutoTokenizer.from_pretrained(
        "ritunjaym/prism-reranker", cache_dir="/tmp/hf-cache"
    )
    _reranker_model = AutoModelForSequenceClassification.from_pretrained(
        "ritunjaym/prism-reranker", cache_dir="/tmp/hf-cache"
    )
    _reranker_model.eval()
    logger.info("Reranker model loaded successfully")
except Exception as e:
    logger.warning("Reranker not loaded (using heuristics)", error=str(e))


# ── FAISS index ───────────────────────────────────────────────────────────────
_faiss_index = None
_faiss_metadata = None

try:
    import faiss

    _faiss_index = faiss.read_index("hunk_index.faiss")
    with open("hunk_index.faiss.meta", "rb") as _f:
        _faiss_metadata = pickle.load(_f)
    logger.info("FAISS index loaded", vectors=_faiss_index.ntotal, metadata_entries=len(_faiss_metadata))
except Exception as e:
    logger.warning("FAISS index not loaded", error=str(e))


# ── Cluster auto-labeling helpers ─────────────────────────────────────────────
import re as _re

_TEST_RE = _re.compile(r"test|spec", _re.IGNORECASE)
_DEP_RE = _re.compile(
    r"package\.json|requirements|setup\.py|pyproject\.toml|go\.(mod|sum)|Cargo\.toml",
    _re.IGNORECASE,
)
_DOC_RE = _re.compile(r"\.md$|docs?/|readme|changelog|\.rst$", _re.IGNORECASE)


def _label_cluster(filenames: list[str], patches: list[str]) -> str:
    """Auto-label a cluster from filenames and patch content."""
    n = len(filenames)
    if n == 0:
        return "Core changes"
    majority = n // 2 + 1
    if sum(1 for f in filenames if _TEST_RE.search(f)) >= majority:
        return "Test changes"
    if sum(1 for f in filenames if _DEP_RE.search(f)) >= majority:
        return "Dependency update"
    if sum(1 for f in filenames if _DOC_RE.search(f)) >= majority:
        return "Documentation"
    cleanup = sum(1 for p in patches if p and p.count("\n-") > p.count("\n+"))
    if cleanup >= majority:
        return "Cleanup / Refactor"
    dirs = [f.split("/")[0] for f in filenames if "/" in f]
    if dirs:
        from collections import Counter
        top, cnt = Counter(dirs).most_common(1)[0]
        if cnt >= majority:
            return top
    return "Core changes"


# ── Pydantic models ───────────────────────────────────────────────────────────
class FileInput(BaseModel):
    filename: str
    patch: Optional[str] = ""
    additions: int = 0
    deletions: int = 0
    status: str = "modified"


class RankRequest(BaseModel):
    pr_id: str
    repo: str
    files: list[FileInput]


class ClusterRequest(BaseModel):
    pr_id: str
    files: list[FileInput]


class RetrieveRequest(BaseModel):
    query_diff: str
    k: int = 10


class HunkRankRequest(BaseModel):
    filename: str
    patch: str


# ── Heuristic importance scoring ──────────────────────────────────────────────
def _path_score(filename: str) -> float:
    high = ["src/", "lib/", "core/", "app/", "api/", "auth", "crypto",
            "secret", "token", "password", "security"]
    low = ["docs/", ".md", ".txt", ".github/", "LICENSE", "CHANGELOG"]
    f = filename.lower()
    if any(p in f for p in high):
        return 0.9
    if any(f.endswith(p.replace("*", "")) or p in f for p in low):
        return 0.2
    return 0.5


def _size_score(additions: int, deletions: int, total: int) -> float:
    if total == 0:
        return 0.5
    ratio = (additions + deletions) / max(total, 1)
    return 1 / (1 + math.exp(-5 * (ratio - 0.3)))


def _security_score(filename: str) -> float:
    keywords = ["auth", "crypto", "secret", "token", "password",
                "security", "permission", "oauth", "jwt", "key"]
    return 1.0 if any(k in filename.lower() for k in keywords) else 0.0


def _test_penalty(filename: str) -> float:
    keywords = ["test", "spec", "__tests__", ".test.", ".spec."]
    return 0.7 if any(k in filename.lower() for k in keywords) else 1.0


def _config_penalty(filename: str, additions: int, deletions: int) -> float:
    exts = [".json", ".yaml", ".yml", ".toml", ".lock", ".env"]
    if any(filename.endswith(e) for e in exts) and (additions + deletions) < 50:
        return 0.5
    return 1.0


def _embed_score(filename: str, patch: str) -> float:
    if _embedder is None:
        return -1.0
    try:
        tokenizer, model = _embedder
        import torch

        text = f"<file>{filename}</file><diff>{(patch or '')[:512]}</diff>"
        inputs = tokenizer(text, return_tensors="pt", truncation=True, max_length=128)
        with torch.no_grad():
            out = model(**inputs)
        emb = out.last_hidden_state.mean(dim=1).squeeze()
        norm = emb / (emb.norm() + 1e-8)
        return float(torch.sigmoid(norm.mean()).item())
    except Exception:
        return -1.0


def score_file(f: FileInput, total_changes: int) -> dict:
    path = _path_score(f.filename)
    size = _size_score(f.additions, f.deletions, total_changes)
    sec = _security_score(f.filename)
    raw = 0.3 * path + 0.3 * size + 0.4 * sec
    raw *= _test_penalty(f.filename)
    raw *= _config_penalty(f.filename, f.additions, f.deletions)

    emb = _embed_score(f.filename, f.patch or "")
    if emb >= 0:
        raw = 0.6 * raw + 0.4 * emb

    score = min(max(raw, 0.0), 1.0)

    reasons = []
    if sec > 0:
        reasons.append("security-sensitive path")
    if size > 0.7:
        reasons.append("large change")
    if path > 0.7:
        reasons.append("core source file")
    if emb >= 0:
        reasons.append("CodeBERT scored")
    if not reasons:
        reasons.append("standard change")

    return {
        "filename": f.filename,
        "reranker_score": round(score, 4),
        "retrieval_score": round(score * 0.9, 4),
        "final_score": round(score, 4),
        "label": _score_label(score),
        "explanation": ", ".join(reasons).capitalize(),
    }


# ── Reranker scoring ──────────────────────────────────────────────────────────
def _reranker_rank_files(files: list[FileInput]) -> list[dict]:
    import torch

    texts = [f"<file>{f.filename}\n{(f.patch or '')[:512]}" for f in files]
    enc = _reranker_tokenizer(
        texts, padding=True, truncation=True, max_length=128, return_tensors="pt"
    )
    with torch.no_grad():
        out = _reranker_model(**enc)
        logits = out.logits.squeeze(-1)

    lo, hi = logits.min().item(), logits.max().item()
    if hi - lo < 1e-6:
        scores = [0.5] * len(files)
    else:
        scores = [(l - lo) / (hi - lo) for l in logits.tolist()]

    results = []
    for f, score in zip(files, scores):
        reasons = []
        if "auth" in f.filename.lower() or "security" in f.filename.lower():
            reasons.append("security-sensitive path")
        if (f.additions + f.deletions) > 50:
            reasons.append("large change")
        if not reasons:
            reasons.append("model-ranked")
        results.append({
            "filename": f.filename,
            "reranker_score": round(score, 4),
            "retrieval_score": round(score * 0.9, 4),
            "final_score": round(score, 4),
            "label": _score_label(score),
            "explanation": ", ".join(reasons).capitalize(),
        })
    return results


# ── Score label ───────────────────────────────────────────────────────────────
def _score_label(score: float) -> str:
    if score >= 0.7:
        return "Critical"
    if score >= 0.4:
        return "Important"
    return "Low"


# ── FAISS query embedding ─────────────────────────────────────────────────────
def _embed_query(text: str) -> np.ndarray:
    """Embed a query string with CodeBERT → (1, 768) float32, L2-normalized."""
    if _embedder is None:
        raise RuntimeError("CodeBERT embedder not available")
    import torch

    tokenizer, model = _embedder
    inputs = tokenizer(
        text[:512], return_tensors="pt", truncation=True, max_length=128
    )
    with torch.no_grad():
        out = model(**inputs)
    emb = out.last_hidden_state.mean(dim=1)  # (1, 768)
    emb = emb / (emb.norm(dim=1, keepdim=True) + 1e-8)
    return emb.numpy().astype(np.float32)


# ── Endpoints ─────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    global _request_count
    start = time.time()
    try:
        result = {
            "status": "ok",
            "version": "2.0.0",
            "codebert": _embedder is not None,
            "reranker": _reranker_model is not None,
            "faiss_loaded": _faiss_index is not None,
        }
        return result
    finally:
        elapsed = (time.time() - start) * 1000
        _latency_ms.append(elapsed)
        _request_count += 1


@app.get("/metrics")
def metrics():
    global _request_count
    start = time.time()
    try:
        lats = list(_latency_ms)
        if lats:
            p50, p95, p99 = np.percentile(lats, [50, 95, 99])
        else:
            p50 = p95 = p99 = 0.0

        current_mem, peak_mem = tracemalloc.get_traced_memory()
        return {
            "request_count": _request_count,
            "latency_p50_ms": round(float(p50), 2),
            "latency_p95_ms": round(float(p95), 2),
            "latency_p99_ms": round(float(p99), 2),
            "memory_current_mb": round(current_mem / 1e6, 1),
            "memory_peak_mb": round(peak_mem / 1e6, 1),
            "faiss_loaded": _faiss_index is not None,
            "faiss_size": _faiss_index.ntotal if _faiss_index is not None else 0,
            "reranker_loaded": _reranker_model is not None,
            "codebert_loaded": _embedder is not None,
        }
    except Exception as e:
        logger.error("metrics endpoint failed", error=str(e))
        return JSONResponse(status_code=500, content={"error": str(e), "code": "METRICS_ERROR"})
    finally:
        elapsed = (time.time() - start) * 1000
        _latency_ms.append(elapsed)
        _request_count += 1


@app.post("/rank")
def rank(req: RankRequest):
    global _request_count
    start = time.time()
    try:
        if _reranker_model is not None and len(req.files) > 0:
            try:
                scored = _reranker_rank_files(req.files)
            except Exception as e:
                logger.warning("Reranker failed, using heuristics", error=str(e))
                total = sum(f.additions + f.deletions for f in req.files)
                scored = [score_file(f, total) for f in req.files]
        else:
            total = sum(f.additions + f.deletions for f in req.files)
            scored = [score_file(f, total) for f in req.files]

        scored.sort(key=lambda x: x["final_score"], reverse=True)
        ranked = [{"rank": i + 1, **s} for i, s in enumerate(scored)]
        return {
            "pr_id": req.pr_id,
            "ranked_files": ranked,
            "processing_ms": int((time.time() - start) * 1000),
        }
    except Exception as e:
        logger.error("rank endpoint failed", error=str(e))
        return JSONResponse(status_code=500, content={"error": str(e), "code": "RANK_ERROR"})
    finally:
        elapsed = (time.time() - start) * 1000
        _latency_ms.append(elapsed)
        _request_count += 1


@app.post("/cluster")
def cluster(req: ClusterRequest):
    global _request_count
    start = time.time()
    try:
        files = req.files
        filenames = [f.filename for f in files]
        patches = [f.patch or "" for f in files]

        if len(files) < 2:
            groups = [
                {"cluster_id": i, "label": f.filename.split("/")[-1],
                 "files": [f.filename], "coherence": 1.0}
                for i, f in enumerate(files)
            ]
            return {"pr_id": req.pr_id, "groups": groups}

        # ── Embedding-based HDBSCAN clustering ────────────────────────────────
        embeddings = None
        labels = None

        if _embedder is not None:
            try:
                import torch

                tokenizer, model = _embedder
                texts = [
                    f"<file>{f.filename}</file><diff>{(f.patch or '')[:512]}</diff>"
                    for f in files
                ]
                inputs = tokenizer(
                    texts, padding=True, truncation=True,
                    max_length=128, return_tensors="pt"
                )
                with torch.no_grad():
                    out = model(**inputs)
                emb = out.last_hidden_state.mean(dim=1)
                norms = emb.norm(dim=1, keepdim=True) + 1e-8
                embeddings = (emb / norms).numpy().astype(np.float32)

                import hdbscan as _hdbscan
                clusterer = _hdbscan.HDBSCAN(
                    min_cluster_size=2, metric="euclidean",
                    cluster_selection_method="eom",
                )
                labels = clusterer.fit_predict(embeddings).tolist()
            except Exception as e:
                logger.warning("Embedding clustering failed, using directory fallback", error=str(e))
                embeddings = None
                labels = None

        # ── Directory-based fallback ───────────────────────────────────────────
        if labels is None:
            from collections import defaultdict as _dd
            dir_map: dict[str, list[int]] = _dd(list)
            for i, f in enumerate(files):
                parts = f.filename.split("/")
                key = parts[0] if len(parts) > 1 else "root"
                dir_map[key].append(i)
            labels = [0] * len(files)
            for cluster_id, idxs in enumerate(dir_map.values()):
                for idx in idxs:
                    labels[idx] = cluster_id

        # ── Assemble groups ────────────────────────────────────────────────────
        from collections import defaultdict as _dd2
        cluster_to_idxs: dict[int, list[int]] = _dd2(list)
        for i, lbl in enumerate(labels):
            cluster_to_idxs[lbl].append(i)

        groups = []
        output_id = 0

        for lbl in sorted(k for k in cluster_to_idxs if k >= 0):
            idxs = cluster_to_idxs[lbl]
            c_filenames = [filenames[i] for i in idxs]
            c_patches = [patches[i] for i in idxs]
            label = _label_cluster(c_filenames, c_patches)

            if embeddings is not None and len(idxs) > 1:
                e = embeddings[idxs]
                sim = e @ e.T
                mask = np.ones(sim.shape, dtype=bool)
                np.fill_diagonal(mask, False)
                coherence = float(np.clip(np.mean(sim[mask]), 0.0, 1.0))
            else:
                coherence = 1.0 if len(idxs) == 1 else round(0.7 + 0.3 * min(len(idxs) / 5, 1.0), 2)

            groups.append({
                "cluster_id": output_id,
                "label": label,
                "files": c_filenames,
                "coherence": round(coherence, 2),
            })
            output_id += 1

        # Noise points (-1) as singletons
        if -1 in cluster_to_idxs:
            for idx in cluster_to_idxs[-1]:
                groups.append({
                    "cluster_id": output_id,
                    "label": filenames[idx].split("/")[-1],
                    "files": [filenames[idx]],
                    "coherence": 1.0,
                })
                output_id += 1

        return {"pr_id": req.pr_id, "groups": groups}
    except Exception as e:
        logger.error("cluster endpoint failed", error=str(e))
        return JSONResponse(status_code=500, content={"error": str(e), "code": "CLUSTER_ERROR"})
    finally:
        elapsed = (time.time() - start) * 1000
        _latency_ms.append(elapsed)
        _request_count += 1


@app.post("/retrieve")
def retrieve(req: RetrieveRequest):
    global _request_count
    start = time.time()
    try:
        if _faiss_index is None or _faiss_metadata is None:
            return {
                "results": [],
                "message": "FAISS index not loaded. Check hunk_index.faiss is present.",
            }
        if _embedder is None:
            return {
                "results": [],
                "message": "CodeBERT embedder not available for query encoding.",
            }

        emb = _embed_query(req.query_diff[:512])  # (1, 768) float32
        k = min(req.k, _faiss_index.ntotal)
        scores, indices = _faiss_index.search(emb, k)

        results = []
        for score, idx in zip(scores[0], indices[0]):
            if idx < 0 or idx >= len(_faiss_metadata):
                continue
            hunk = _faiss_metadata[idx]
            results.append({**hunk, "similarity": float(score)})

        return {"results": results}
    except Exception as e:
        logger.error("retrieve endpoint failed", error=str(e))
        return JSONResponse(status_code=500, content={"error": str(e), "code": "RETRIEVE_ERROR"})
    finally:
        elapsed = (time.time() - start) * 1000
        _latency_ms.append(elapsed)
        _request_count += 1


@app.post("/rank_hunks")
def rank_hunks(req: HunkRankRequest):
    """Split patch into individual hunks and score each independently."""
    global _request_count
    start = time.time()
    try:
        # Split on @@ hunk headers; drop the first empty segment before first @@
        raw_hunks = req.patch.split("@@")
        # Reassemble: each hunk = "@@ <header> @@" + body
        hunks = []
        i = 1  # index 0 is empty string before first @@
        while i + 1 < len(raw_hunks):
            header = raw_hunks[i].strip()
            body = raw_hunks[i + 1] if i + 1 < len(raw_hunks) else ""
            hunks.append(f"@@ {header} @@{body}")
            i += 2

        if not hunks:
            return {"filename": req.filename, "hunks": []}

        # Score each hunk
        scored_hunks = []
        if _reranker_model is not None:
            texts = [f"<file>{req.filename}\n{h[:512]}" for h in hunks]
            try:
                import torch
                enc = _reranker_tokenizer(
                    texts, padding=True, truncation=True,
                    max_length=128, return_tensors="pt"
                )
                with torch.no_grad():
                    out = _reranker_model(**enc)
                    logits = out.logits.squeeze(-1)
                lo, hi = logits.min().item(), logits.max().item()
                if hi - lo < 1e-6:
                    scores = [0.5] * len(hunks)
                else:
                    scores = [(l - lo) / (hi - lo) for l in logits.tolist()]
            except Exception as e:
                logger.warning("Reranker hunk scoring failed", error=str(e))
                scores = [0.5] * len(hunks)
        else:
            # Heuristic: score based on hunk size and security keywords
            scores = []
            for h in hunks:
                added = h.count("\n+")
                removed = h.count("\n-")
                size_factor = min((added + removed) / 20.0, 1.0)
                sec_factor = 0.3 if any(
                    kw in h.lower() for kw in
                    ["auth", "crypto", "secret", "token", "password", "security"]
                ) else 0.0
                scores.append(min(0.3 + 0.5 * size_factor + sec_factor, 1.0))

        for i, (hunk_text, score) in enumerate(zip(hunks, scores)):
            # Extract hunk header line count info
            lines_added = hunk_text.count("\n+")
            lines_removed = hunk_text.count("\n-")
            scored_hunks.append({
                "hunk_index": i,
                "score": round(score, 4),
                "label": _score_label(score),
                "lines_added": lines_added,
                "lines_removed": lines_removed,
                "preview": hunk_text[:200],
            })

        scored_hunks.sort(key=lambda x: x["score"], reverse=True)
        return {
            "filename": req.filename,
            "hunks": scored_hunks,
        }
    except Exception as e:
        logger.error("rank_hunks endpoint failed", error=str(e))
        return JSONResponse(status_code=500, content={"error": str(e), "code": "RANK_HUNKS_ERROR"})
    finally:
        elapsed = (time.time() - start) * 1000
        _latency_ms.append(elapsed)
        _request_count += 1
