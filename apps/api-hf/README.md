---
title: CodeLens API
emoji: 🔍
colorFrom: blue
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
---

# CodeLens API

FastAPI ML backend for CodeLens. Primary deployment is **GCP Cloud Run** (`us-central1`); this HuggingFace Space acts as a fallback.

## Deployments

| Environment | URL / ID |
|---|---|
| **GCP Cloud Run (primary API)** | `https://codelens-api-723322228871.us-central1.run.app` |
| **Vertex AI Endpoint (reranker)** | endpoint `3480614558643519488`, model `4559928707573088256` (us-central1) |
| **HuggingFace Spaces (fallback)** | `https://ritunjaym-codelens-api.hf.space` |

## Cloud Run Endpoints

- `POST /rank` — rank PR files by review importance
- `POST /cluster` — semantic grouping of PR changes
- `POST /retrieve` — retrieve similar historical hunks via FAISS
- `GET /health` — health check
- `GET /metrics` — latency and memory metrics

## Vertex AI Prediction Endpoint

Serves the INT8-quantized ONNX reranker directly.

```
POST https://us-central1-aiplatform.googleapis.com/v1/projects/upbeat-airfoil-490617-j5/locations/us-central1/endpoints/3480614558643519488:predict

{
  "instances": [
    {"filename": "src/auth.py", "patch": "@@ -1,3 +1,5 @@\n ..."},
    {"filename": "README.md",   "patch": ""}
  ]
}

→ {"predictions": [0.91, 0.12]}
```

## GCP Infrastructure

- **Artifact Registry**: `us-central1-docker.pkg.dev/upbeat-airfoil-490617-j5/codelens-api`
  - `codelens-api:latest` — Cloud Run image (heuristic + FAISS, `TRANSFORMERS_OFFLINE=1`)
  - `codelens-vertex:latest` — Vertex AI custom prediction container (ONNXRuntime)
- **Cloud Run**: min-instances=0, max-instances=1 (scales to zero when idle)
- **GCS bucket**: `gs://codelens-models-upbeat/reranker/`
  - `model.onnx` — FP32 (499 MB)
  - `model_int8.onnx` — INT8 (126 MB, 75% smaller, deployed to Vertex AI)
- **Vertex AI Model Registry**: `codelens-reranker-int8` (model `4559928707573088256`)
- **Vertex AI Endpoint**: `codelens-reranker-endpoint` (`3480614558643519488`), n1-standard-2

## Notes

- Cloud Run uses `TRANSFORMERS_OFFLINE=1` for fast cold starts (heuristic scoring). Set `HF_TOKEN` env var to enable CodeBERT/reranker model downloads.
- Vertex AI endpoint runs the INT8 ONNX model (CodeBERT backbone) for neural reranking. Requires GCP IAM auth to call.
- HuggingFace Spaces uses the original `Dockerfile` (port 7860) and is kept as a no-auth fallback.
