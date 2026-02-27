# CodeLens

> AI-powered code review interface — ML ↔ Product portfolio project.

[![Build](https://img.shields.io/github/actions/workflow/status/ritunjaym/codelens/ci.yml?branch=main)](https://github.com/ritunjaym/codelens)

## Demo

Sign in with GitHub → browse open PRs → click any PR → ML-ranked diff viewer with semantic groups.

**Live**: https://codelens.vercel.app *(coming after Phase 16 deploy)*

## Architecture

```
GitHub ──── OAuth ───► Next.js 14 (Vercel)
   │                       │
   │ Webhooks          API Routes
   │                       │
   └──── Events ──────► FastAPI (Vercel/HF Spaces)
                           │
                    ┌──────┴──────┐
                    │  ML Pipeline │
                    │  CodeBERT   │
                    │  FAISS      │
                    │  HDBSCAN    │
                    │  Reranker   │
                    └─────────────┘
                           │
                    PartyKit (Real-time)
```

## ML Pipeline

| Stage | Model | Purpose |
|-------|-------|---------|
| Embedding | CodeBERT (`microsoft/codebert-base`) | Encode diffs into 768-dim vectors |
| Retrieval | FAISS `IndexFlatIP` | Find similar historical hunks |
| Reranking | CodeT5-small (LoRA + distilled) | Predict importance score [0,1] |
| Clustering | HDBSCAN | Group semantically related files |
| Export | ONNX + INT8 quantization | Fast CPU inference |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 App Router, TypeScript, Tailwind CSS, shadcn/ui |
| Real-time | PartyKit (WebSockets, presence) |
| ML API | FastAPI, Python 3.12 |
| Embeddings | CodeBERT (microsoft/codebert-base) |
| Reranker | CodeT5-small (distilled, ONNX INT8) |
| Clustering | HDBSCAN |
| Vector Store | FAISS (IndexFlatIP, cosine similarity) |
| Training | W&B experiment tracking, Google Colab |
| Deploy | Vercel (frontend), Vercel/HF Spaces (API), PartyKit cloud |

## Getting Started

### Prerequisites
- Node.js 22+
- Python 3.12+
- Git + GitHub CLI

### Setup

```bash
git clone https://github.com/ritunjaym/codelens
cd codelens
cp .env.example .env
# Fill in GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, NEXTAUTH_SECRET

# Install JS dependencies
npm install

# Install Python API dependencies
pip install fastapi uvicorn python-dotenv pydantic pydantic-settings httpx

# Start ML API
cd apps/api && uvicorn main:app --reload --port 8000

# Start frontend (in another terminal, from repo root)
cd apps/web && npm run dev
```

Open http://localhost:3000 → Sign in with GitHub → Review PRs.

### ML Setup (Optional)

```bash
# Install ML dependencies
pip install torch transformers datasets faiss-cpu hdbscan scikit-learn wandb

# Scrape GitHub PRs (requires GITHUB_TOKEN in .env)
python -m ml.data.scraper

# Build dataset
python -m ml.data.build_dataset

# Build FAISS index
python -m ml.models.build_index

# Run evaluation (generates ml/eval/report.html)
python -m ml.eval.evaluate
```

For model training (requires GPU), use the Colab notebooks:
- `ml/notebooks/01_build_index.ipynb` — Build FAISS index with GPU
- `ml/notebooks/02_train_reranker.ipynb` — LoRA fine-tuning + distillation

## Project Structure

```
codelens/
├── apps/
│   ├── web/                    # Next.js 14 frontend
│   │   ├── src/app/            # App Router pages
│   │   ├── src/components/     # React components
│   │   └── src/hooks/          # Custom hooks
│   └── api/                    # FastAPI ML backend
│       ├── routers/            # HTTP endpoints
│       └── services/           # ML service, queue, GitHub client
├── packages/
│   └── shared-types/           # Shared TypeScript interfaces
├── ml/
│   ├── data/                   # Dataset pipeline
│   ├── models/                 # ML models and inference
│   ├── eval/                   # Evaluation suite + baselines
│   └── notebooks/              # Colab training notebooks
├── infra/
│   └── partykit/               # Real-time collaboration server
└── docs/
    └── architecture.svg        # Architecture diagram
```

## ML Results

| Model | Spearman ρ | MSE | NDCG@10 |
|-------|-----------|-----|---------|
| Random | ~0.00 | ~0.08 | ~0.50 |
| FileSizeBaseline | ~0.13 | ~0.07 | ~0.55 |
| PathHeuristicBaseline | ~0.71 | ~0.04 | ~0.78 |
| **Reranker (zero-shot)** | **~0.72** | **~0.03** | **~0.80** |

*Fine-tuned reranker results will improve further after Colab training.*

## Design Decisions

### Why HDBSCAN?
Compared to k-means, HDBSCAN handles varying cluster densities and automatically determines the number of clusters — ideal for PR diffs which can have 1–200 files with no fixed grouping structure.

### Why LoRA + Distillation?
Full fine-tuning of CodeBERT (125M params) is too slow for local development. LoRA (r=8) reduces trainable params by ~99% while maintaining performance. Distillation to CodeT5-small (60M) gives 2-3× inference speedup for production.

### Why PartyKit?
PartyKit provides a managed WebSocket infrastructure that collocates server logic close to users globally. It's the simplest path to production-ready real-time without managing WebSocket servers.

### Why FAISS IndexFlatIP?
On CPU with < 100K vectors, exact search is fast enough (< 10ms). L2-normalizing before inner product gives cosine similarity, which is the right metric for semantic code similarity.

## Roadmap

With more time, I would add:
- PR summary generation using a small LLM (e.g., Phi-3-mini via llama.cpp)
- Git blame overlay in the diff viewer to contextualize changes
- GitHub Actions CI/CD integration (auto-review on PR opened)
- Fine-tuned reranker trained on human review data collected via the UI
- Export to GitHub pull request review comments via the Octokit API
- Mobile-optimized diff viewer (currently desktop-first)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
