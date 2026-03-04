# CodeLens ML API Reference

Base URL: `https://ritunjaym-codelens-api.hf.space`
Interactive docs: `https://ritunjaym-codelens-api.hf.space/docs`

---

## GET /health

Returns component status.

**Response**
```json
{
  "status": "ok",
  "version": "2.0.0",
  "codebert": true,
  "reranker": true,
  "faiss_loaded": true
}
```

---

## GET /metrics

Returns latency percentiles and memory usage.

**Response**
```json
{
  "request_count": 142,
  "latency_p50_ms": 48.3,
  "latency_p95_ms": 210.7,
  "latency_p99_ms": 380.1,
  "memory_current_mb": 512.4,
  "memory_peak_mb": 640.2,
  "faiss_loaded": true,
  "faiss_size": 4821,
  "reranker_loaded": true,
  "codebert_loaded": true
}
```

---

## POST /rank

Rank PR files by review priority.

**Request**
```json
{
  "pr_id": "owner/repo/123",
  "repo": "my-repo",
  "files": [
    {
      "filename": "src/auth.ts",
      "patch": "@@ -1,3 +1,10 @@\n+import jwt from 'jsonwebtoken'",
      "additions": 42,
      "deletions": 3,
      "status": "modified"
    }
  ]
}
```

**Response**
```json
{
  "pr_id": "owner/repo/123",
  "ranked_files": [
    {
      "rank": 1,
      "filename": "src/auth.ts",
      "final_score": 0.91,
      "reranker_score": 0.88,
      "retrieval_score": 0.73,
      "label": "Critical",
      "explanation": "Security-sensitive authentication changes"
    }
  ],
  "processing_ms": 63
}
```

Labels: `Critical` (score ≥ 0.7), `Important` (score ≥ 0.4), `Low` (score < 0.4)

---

## POST /cluster

Group files by semantic similarity and directory structure.

**Request**
```json
{
  "pr_id": "owner/repo/123",
  "files": [
    { "filename": "src/auth.ts", "additions": 10, "deletions": 2 },
    { "filename": "src/session.ts", "additions": 5, "deletions": 0 }
  ]
}
```

**Response**
```json
{
  "pr_id": "owner/repo/123",
  "groups": [
    {
      "cluster_id": 0,
      "label": "src",
      "files": ["src/auth.ts", "src/session.ts"],
      "coherence": 0.85
    }
  ]
}
```

---

## POST /retrieve

Find similar historical hunks via FAISS k-NN search.

**Request**
```json
{
  "query_diff": "@@ -1,3 +1,10 @@\n-const token = req.cookies.token\n+const token = jwt.verify(req.cookies.token, SECRET)",
  "k": 5
}
```

**Response**
```json
{
  "results": [
    {
      "filename": "api/auth.py",
      "patch": "@@ -20,3 +20,8 @@\n+jwt.decode(token, settings.SECRET_KEY)",
      "importance_score": 0.87,
      "similarity": 0.94
    }
  ]
}
```

---

## POST /rank_hunks

Score individual hunks within a single file patch.

**Request**
```json
{
  "filename": "src/auth.ts",
  "patch": "@@ -1,3 +1,10 @@\n+import jwt\n@@ -50,2 +57,8 @@\n+function verifyToken"
}
```

**Response**
```json
{
  "filename": "src/auth.ts",
  "hunks": [
    { "hunk_index": 0, "score": 0.62, "header": "@@ -1,3 +1,10 @@" },
    { "hunk_index": 1, "score": 0.91, "header": "@@ -50,2 +57,8 @@" }
  ],
  "processing_ms": 31
}
```
