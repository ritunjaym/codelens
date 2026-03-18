"""
Vertex AI Custom Prediction Container — CodeLens ONNX Reranker.

Implements the Vertex AI custom container protocol:
  GET  $AIP_HEALTH_ROUTE  (default /ping)    → 200
  POST $AIP_PREDICT_ROUTE (default /predict) → {"predictions": [...]}

Input instances:
  {"instances": [{"filename": "auth.py", "patch": "@@ -1,3 ..."}, ...]}

Output:
  {"predictions": [0.85, 0.23, ...]}  (one float score per instance, 0–1)
"""
from __future__ import annotations

import os
import logging
from pathlib import Path

import numpy as np
import onnxruntime as ort
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

# ── Env vars injected by Vertex AI ────────────────────────────────────────────
PORT = int(os.environ.get("AIP_HTTP_PORT", "8080"))
HEALTH_ROUTE = os.environ.get("AIP_HEALTH_ROUTE", "/ping")
PREDICT_ROUTE = os.environ.get("AIP_PREDICT_ROUTE", "/predict")
# GCS URI of model artifacts (set by Vertex AI when model is registered with artifactUri)
STORAGE_URI = os.environ.get("AIP_STORAGE_URI", "")

app = FastAPI(title="CodeLens Reranker — Vertex AI Endpoint")

# ── Model loading ──────────────────────────────────────────────────────────────
_session: ort.InferenceSession | None = None
_tokenizer = None


def _resolve_model_path() -> str:
    """Find model_int8.onnx or model.onnx under the mounted/downloaded artifact dir."""
    candidates = []
    if STORAGE_URI and STORAGE_URI.startswith("gs://"):
        # Download from GCS to local /tmp/model
        local_dir = Path("/tmp/model")
        local_dir.mkdir(parents=True, exist_ok=True)
        try:
            from google.cloud import storage as gcs
            client = gcs.Client()
            bucket_name, prefix = STORAGE_URI[5:].split("/", 1)
            bucket = client.bucket(bucket_name)
            for blob in bucket.list_blobs(prefix=prefix):
                fname = blob.name.split("/")[-1]
                if fname.endswith(".onnx"):
                    dest = local_dir / fname
                    if not dest.exists():
                        log.info(f"Downloading {blob.name} → {dest}")
                        blob.download_to_filename(str(dest))
                    candidates.append(str(dest))
        except Exception as e:
            log.warning(f"GCS download failed: {e}")

    # Also check local /tmp/model in case Vertex AI pre-downloaded
    local_dir = Path("/tmp/model")
    for name in ("model_int8.onnx", "model.onnx"):
        p = local_dir / name
        if p.exists():
            candidates.append(str(p))

    # Prefer INT8 over FP32
    for path in candidates:
        if "int8" in path:
            return path
    if candidates:
        return candidates[0]
    raise FileNotFoundError("No ONNX model found. Set AIP_STORAGE_URI or place model in /tmp/model/")


@app.on_event("startup")
async def startup():
    global _session, _tokenizer
    try:
        model_path = _resolve_model_path()
        log.info(f"Loading ONNX model from {model_path}")
        _session = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
        log.info(f"ONNX model loaded. Inputs: {[i.name for i in _session.get_inputs()]}")
    except Exception as e:
        log.error(f"Failed to load ONNX model: {e}")

    try:
        from transformers import AutoTokenizer
        _tokenizer = AutoTokenizer.from_pretrained("microsoft/codebert-base", cache_dir="/tmp/hf-cache")
        log.info("Tokenizer loaded")
    except Exception as e:
        log.warning(f"Tokenizer not available: {e}")


# ── Pydantic schemas ───────────────────────────────────────────────────────────
class Instance(BaseModel):
    filename: str = ""
    patch: str = ""


class PredictRequest(BaseModel):
    instances: list[Instance]


# ── Routes ─────────────────────────────────────────────────────────────────────
@app.get(HEALTH_ROUTE)
async def health():
    return {"status": "ok", "model_loaded": _session is not None}


@app.post(PREDICT_ROUTE)
async def predict(req: PredictRequest):
    if _session is None:
        return JSONResponse(status_code=503, content={"error": "Model not loaded"})
    if _tokenizer is None:
        return JSONResponse(status_code=503, content={"error": "Tokenizer not loaded"})

    texts = [f"<file>{inst.filename}</file><diff>{inst.patch[:512]}</diff>" for inst in req.instances]

    # Tokenize
    enc = _tokenizer(
        texts,
        padding=True,
        truncation=True,
        max_length=128,
        return_tensors="np",
    )

    # Build inputs — use only what the model expects
    model_input_names = {i.name for i in _session.get_inputs()}
    feed = {k: v.astype(np.int64) for k, v in enc.items() if k in model_input_names}

    logits = _session.run(None, feed)[0].squeeze(-1)  # (batch,)

    # Normalize to [0, 1]
    lo, hi = float(logits.min()), float(logits.max())
    if hi - lo < 1e-6:
        scores = [0.5] * len(texts)
    else:
        scores = [float((l - lo) / (hi - lo)) for l in logits.tolist()]

    return {"predictions": scores}
