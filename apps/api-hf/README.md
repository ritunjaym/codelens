---
title: Assert Review API
emoji: 🔍
colorFrom: blue
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
---

# Assert Review API

FastAPI ML backend for Assert Review. Provides:
- `POST /rank` — rank PR files by review importance
- `POST /cluster` — semantic grouping of PR changes
- `POST /retrieve` — retrieve similar historical hunks
- `GET /health` — health check
