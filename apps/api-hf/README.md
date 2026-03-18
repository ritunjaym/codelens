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

| Environment | URL |
|---|---|
| **GCP Cloud Run (primary)** | `https://codelens-api-723322228871.us-central1.run.app` |
| **HuggingFace Spaces (fallback)** | `https://ritunjaym-codelens-api.hf.space` |

## Endpoints

- `POST /rank` — rank PR files by review importance
- `POST /cluster` — semantic grouping of PR changes
- `POST /retrieve` — retrieve similar historical hunks via FAISS
- `GET /health` — health check
- `GET /metrics` — latency and memory metrics

## GCP Infrastructure

- **Artifact Registry**: `us-central1-docker.pkg.dev/upbeat-airfoil-490617-j5/codelens-api`
- **Cloud Run**: min-instances=0, max-instances=1 (scales to zero when idle)
- **Cloud Build**: `cloudbuild.yaml` — builds `Dockerfile.cloudrun` and pushes to Artifact Registry

## Notes

- Cloud Run uses `TRANSFORMERS_OFFLINE=1` for fast cold starts; set `HF_TOKEN` env var to enable model downloads
- HuggingFace Spaces uses the original `Dockerfile` (port 7860)
