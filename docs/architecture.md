# CodeLens Architecture

## System Diagram

```mermaid
graph LR
  GitHub -->|OAuth + REST| Web[Next.js App]
  GitHub -->|Webhooks| Webhooks[/api/webhooks]
  Web --> PartyKit[PartyKit WebSocket]
  Web --> MLAPI[FastAPI on HF Spaces]
  MLAPI --> FAISS[FAISS Index]
  MLAPI --> Reranker[distilRoBERTa Reranker]
  Reranker -->|distilled from| Teacher[CodeBERT+LoRA]
```

## Components

### Next.js App (Vercel)

- **Auth**: Manual GitHub OAuth flow — exchanges code for access token, stores as `gh_session` base64 cookie
- **PR Page** (`/pr/[owner]/[repo]/[number]`): Server component that fetches PR files via Octokit, calls ML API for ranking + clustering, renders `PRReviewView`
- **API Routes**:
  - `POST /api/github/comment` — proxies inline review comments to GitHub REST API
  - `GET /api/github/ratelimit` — surfaces GitHub API rate limit to the UI
  - `POST /api/webhooks/github` — validates HMAC, forwards to ML API, broadcasts to PartyKit
- **Real-time**: `usePRRoom` hook connects to PartyKit WebSocket room per PR for presence awareness

### FastAPI ML Backend (HF Spaces)

Deployed at `https://ritunjaym-codelens-api.hf.space`. Runs on CPU with ONNX INT8 quantization.

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Component status (CodeBERT, reranker, FAISS) |
| `GET /metrics` | Latency percentiles (p50/p95/p99), memory usage |
| `POST /rank` | Score + rank files by review priority |
| `POST /cluster` | Group files by directory / semantic similarity |
| `POST /retrieve` | FAISS k-NN retrieval of similar historical hunks |
| `POST /rank_hunks` | Per-hunk scoring within a single file |

### ML Pipeline

```
File diff (patch text)
       │
       ▼
CodeBERT encoder ──► 768-dim embedding
       │
       ▼
FAISS IndexFlatIP ──► top-k similar historical hunks
       │
       ▼
distilRoBERTa reranker ──► importance score [0, 1]
       │
       ▼
Label assignment: Critical (≥0.7) / Important (≥0.4) / Low (<0.4)
```

### PartyKit (WebSockets)

Each PR gets a room `pr-{repo}-{number}`. The server handles:
- `join` — register presence with avatar, color, current file
- `presence_update` — broadcast current file being viewed
- `presence_leave` — clean up on disconnect
- `github_event` — forwarded from webhook route on PR events

## Data Flow: PR Review Session

1. User signs in via GitHub OAuth → `gh_session` cookie set
2. User opens `/pr/owner/repo/123`
3. Server fetches PR files + metadata from GitHub REST API
4. Server calls `POST /rank` + `POST /cluster` on ML API (5 s timeout, graceful fallback)
5. `PRReviewView` renders ranked file list + diff viewer
6. `usePRRoom` opens WebSocket to PartyKit room
7. User navigates files → presence updates broadcast to other reviewers
8. User adds inline comment → optimistic local write + `POST /api/github/comment` → GitHub
9. GitHub fires webhook → `/api/webhooks/github` → PartyKit broadcast → all clients refresh
