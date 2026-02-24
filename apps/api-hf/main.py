import os
import time
import math
import numpy as np
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

app = FastAPI(title="Assert Review API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Optional: load CodeBERT at startup ──────────────────────────
# Falls back to heuristic scorer if unavailable (cold start / OOM).
_embedder = None
try:
    from transformers import AutoTokenizer, AutoModel
    import torch
    _tokenizer = AutoTokenizer.from_pretrained(
        "microsoft/codebert-base",
        cache_dir="/tmp/hf-cache",
    )
    _model = AutoModel.from_pretrained(
        "microsoft/codebert-base",
        cache_dir="/tmp/hf-cache",
    )
    _model.eval()
    _embedder = (_tokenizer, _model)
    print("CodeBERT loaded successfully")
except Exception as e:
    print(f"CodeBERT not loaded (using heuristics): {e}")


# ── Pydantic models ──────────────────────────────────────────────
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


# ── Heuristic importance scoring (mirrors ml/data/labeler.py) ──
def _path_score(filename: str) -> float:
    high = ["src/", "lib/", "core/", "app/", "api/", "auth", "crypto",
            "secret", "token", "password", "security"]
    low  = ["docs/", ".md", ".txt", ".github/", "LICENSE", "CHANGELOG"]
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
    """Use CodeBERT embedding similarity if available, else return -1."""
    if _embedder is None:
        return -1.0
    try:
        tokenizer, model = _embedder
        import torch
        text = f"<file>{filename}</file><diff>{(patch or '')[:512]}</diff>"
        inputs = tokenizer(text, return_tensors="pt", truncation=True, max_length=128)
        with torch.no_grad():
            out = model(**inputs)
        # Mean-pool last hidden state, L2-normalise, dot with ones → scalar
        emb = out.last_hidden_state.mean(dim=1).squeeze()
        norm = emb / (emb.norm() + 1e-8)
        # Map to [0, 1] via sigmoid of mean activation
        return float(torch.sigmoid(norm.mean()).item())
    except Exception:
        return -1.0

def score_file(f: FileInput, total_changes: int) -> dict:
    path = _path_score(f.filename)
    size = _size_score(f.additions, f.deletions, total_changes)
    sec  = _security_score(f.filename)
    raw  = 0.3 * path + 0.3 * size + 0.4 * sec
    raw *= _test_penalty(f.filename)
    raw *= _config_penalty(f.filename, f.additions, f.deletions)

    # Blend with CodeBERT embedding score when available
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
    explanation = ", ".join(reasons).capitalize()

    return {
        "filename": f.filename,
        "reranker_score": round(score, 4),
        "retrieval_score": round(score * 0.9, 4),
        "final_score": round(score, 4),
        "explanation": explanation,
    }


# ── Endpoints ─────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {
        "status": "ok",
        "version": "1.0.0",
        "codebert": _embedder is not None,
    }

@app.post("/rank")
def rank(req: RankRequest):
    start = time.time()
    total = sum(f.additions + f.deletions for f in req.files)
    scored = [score_file(f, total) for f in req.files]
    scored.sort(key=lambda x: x["final_score"], reverse=True)
    ranked = [{"rank": i + 1, **s} for i, s in enumerate(scored)]
    return {
        "pr_id": req.pr_id,
        "ranked_files": ranked,
        "processing_ms": int((time.time() - start) * 1000),
    }

@app.post("/cluster")
def cluster(req: ClusterRequest):
    files = req.files
    if len(files) < 4:
        groups = [
            {
                "cluster_id": i,
                "label": f.filename.split("/")[-1],
                "files": [f.filename],
                "coherence": 1.0,
            }
            for i, f in enumerate(files)
        ]
        return {"pr_id": req.pr_id, "groups": groups}

    # Directory-based heuristic grouping
    dir_map: dict[str, list[str]] = {}
    for f in files:
        parts = f.filename.split("/")
        key = parts[0] if len(parts) > 1 else "root"
        dir_map.setdefault(key, []).append(f.filename)

    groups = [
        {
            "cluster_id": i,
            "label": dir_name,
            "files": fnames,
            "coherence": round(0.7 + 0.3 * min(len(fnames) / 5, 1.0), 2),
        }
        for i, (dir_name, fnames) in enumerate(dir_map.items())
    ]
    return {"pr_id": req.pr_id, "groups": groups}

@app.post("/retrieve")
def retrieve(req: RetrieveRequest):
    # Stub — returns empty until FAISS index is built via ml/models/build_index.py
    return {
        "results": [],
        "message": "FAISS index not yet built. Run ml/models/build_index.py first.",
    }
