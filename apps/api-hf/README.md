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

FastAPI ML backend for CodeLens. Provides:
- `POST /rank` — rank PR files by review importance
- `POST /cluster` — semantic grouping of PR changes
- `POST /retrieve` — retrieve similar historical hunks
- `GET /health` — health check
