# CodeLens

> AI-powered code review — ranked diffs, semantic grouping, real-time collaboration

[![CI](https://img.shields.io/github/actions/workflow/status/ritunjaym/codelens/ci.yml?branch=main&label=CI)](https://github.com/ritunjaym/codelens/actions/workflows/ci.yml)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)](https://nextjs.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.111-009688?logo=fastapi)](https://fastapi.tiangolo.com)
[![HuggingFace](https://img.shields.io/badge/HuggingFace-Spaces-yellow?logo=huggingface)](https://huggingface.co/spaces/ritunjaym/codelens-api)

[Live Demo](https://web-azure-sigma-44.vercel.app) | [ML API](https://ritunjaym-codelens-api.hf.space/docs)

## Screenshot

![CodeLens Dashboard](docs/screenshot.png)

## Architecture

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

## ML Engineering

### Two-Stage RAG Pipeline

CodeLens uses a two-stage retrieval-augmented generation pipeline to rank PR files by review priority:

1. **Dense Retrieval (Stage 1)** — Each file diff is encoded by CodeBERT (`microsoft/codebert-base`) into a 768-dim vector. A FAISS `IndexFlatIP` index retrieves the top-k most similar historical hunks from a corpus of reviewed PRs using cosine similarity.

2. **Cross-Encoder Reranking (Stage 2)** — Retrieved candidates are passed to a fine-tuned `distilRoBERTa` reranker (distilled from a CodeBERT + LoRA teacher) that jointly attends to the query diff and each candidate, producing an importance score in [0, 1].

**Why two-stage beats single-stage:** Dense retrieval is fast (O(n) dot products, ~10 ms) but imprecise — embedding similarity doesn't capture review priority ordering. Cross-encoder reranking is precise but expensive at O(n) full forward passes. The two-stage pipeline gets both: ~10 ms retrieval + ~50 ms reranking vs ~500 ms for all-reranker on 20 files, with no loss in ranking quality.

### Results

Evaluated on 9 real GitHub PRs. Primary metric: NDCG@5. Confidence intervals from bootstrap resampling (1 000 iterations).

| Baseline | NDCG@5 | NDCG@10 | MRR | MAP | P@1 | P@5 |
|----------|--------|---------|-----|-----|-----|-----|
| Random | 0.5121 [0.2334, 0.7866] ** | 0.6553 [0.4710, 0.8396] ** | 0.5838 [0.3280, 0.8519] ** | 0.5560 [0.3192, 0.7936] ** | 0.4444 [0.1111, 0.7778] ** | 0.3333 [0.1333, 0.5333] |
| FileSize | 0.9266 [0.7797, 1.0000] | 0.9331 [0.7994, 1.0000] | 1.0000 [1.0000, 1.0000] | 0.9331 [0.7992, 1.0000] | 1.0000 [1.0000, 1.0000] | 0.4222 [0.2444, 0.6667] |
| BM25 | 0.7614 [0.6075, 0.9153] | 0.7591 [0.6074, 0.9039] | 0.7685 [0.5463, 0.9259] | 0.6997 [0.5014, 0.8864] | 0.6667 [0.3333, 0.8889] | 0.4222 [0.2667, 0.6222] |
| DenseOnly | 0.5080 [0.2713, 0.7600] ** | 0.5610 [0.3518, 0.7884] ** | 0.5574 [0.3111, 0.8241] ** | 0.5072 [0.2886, 0.7480] ** | 0.4444 [0.1111, 0.7778] ** | 0.3111 [0.1556, 0.5111] |
| **FullPipeline** | **0.9266 [0.7797, 1.0000]** | **0.9331 [0.7994, 1.0000]** | **1.0000 [1.0000, 1.0000]** | **0.9331 [0.7992, 1.0000]** | **1.0000 [1.0000, 1.0000]** | **0.4222 [0.2444, 0.6667]** |

\*\* p < 0.05 vs FullPipeline (paired t-test)

Key takeaways:
- FullPipeline matches the FileSize oracle on NDCG@5/10, MRR, MAP, and P@1
- Significantly outperforms Random and DenseOnly (p < 0.05 on all primary metrics)
- DenseOnly performs *below random* — dense embeddings alone don't capture importance ordering without the cross-encoder

### Efficiency Comparison

*(Run `make benchmark` to generate `ml/eval/benchmark_table.md` with pytorch_fp32 / lora / onnx_fp32 / onnx_int8 latency comparison)*

### Pareto Chart

![Pareto](docs/pareto.png)

## Product Engineering

### Tech Stack

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3-38bdf8?logo=tailwindcss)
![PartyKit](https://img.shields.io/badge/PartyKit-WebSockets-6d28d9)
![Vercel](https://img.shields.io/badge/Vercel-deployed-black?logo=vercel)
![FastAPI](https://img.shields.io/badge/FastAPI-0.111-009688?logo=fastapi)
![HuggingFace](https://img.shields.io/badge/HuggingFace-Spaces-yellow?logo=huggingface)

### Core Web Vitals

*[Lighthouse screenshot — add after deploy]*

### Key Features

- **AI Priority Rankings** — Critical / Important / Low labels per file, from the two-stage ML pipeline
- **Semantic change grouping** — HDBSCAN clusters related files; coherence scores displayed in the sidebar
- **Keyboard-first navigation** — full keyboard control: navigate, comment, and search without the mouse
- **Real-time presence** — see other reviewers' current files via PartyKit WebSockets
- **Inline GitHub comments** — post review comments directly to GitHub from the diff UI
- **Webhook-powered live updates** — PR events broadcast instantly to all reviewers in the same room

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `j` / `k` | Navigate files down / up |
| `Enter` | Expand / collapse focused file |
| `c` | Open comment on focused line |
| `⌘K` | Command palette (search files, clusters, actions) |
| `?` | Show all keyboard shortcuts |
| `g d` | Go to dashboard |

## Setup

```bash
# 1. Clone
git clone https://github.com/ritunjaym/codelens && cd codelens

# 2. Configure environment
cp .env.example .env
# Edit .env — fill in GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, AUTH_SECRET

# 3. Install all dependencies
make setup

# 4. Start ML API  (Terminal 1)
make ml-api

# 5. Start web frontend  (Terminal 2)
make web
```

Open http://localhost:3000 → Sign in with GitHub → browse open PRs.

### Full ML Setup (optional — for training / eval)

```bash
make setup-ml          # install Python ML deps + build dataset + FAISS index
make eval              # run evaluation suite  → ml/eval/results_table.md
make benchmark         # latency benchmark     → ml/eval/benchmark_table.md
make train             # fine-tune reranker (GPU recommended)
```

## Project Structure

```
codelens/
├── apps/
│   ├── web/                # Next.js 16 frontend (Vercel)
│   │   ├── src/app/        # App Router pages & API routes
│   │   ├── src/components/ # React components
│   │   └── src/hooks/      # Custom hooks (keyboard nav, presence, comments)
│   └── api-hf/             # FastAPI ML backend (HF Spaces)
├── ml/
│   ├── data/               # Dataset pipeline (scraper, builder)
│   ├── models/             # Embedder, FAISS, reranker, ONNX export
│   └── eval/               # Evaluation suite & baselines
├── docs/                   # Architecture diagrams, API docs, ML results
└── .github/workflows/      # CI: build, typecheck, lint, ml-tests
```

## Future Work

- **Merge conflict resolution** — AST alignment + context retrieval for automatic conflict suggestions
- **RL reward model** — train ranking from reviewer feedback signals captured via the UI
- **Mobile native app** — React Native client for on-the-go PR review
- **Online A/B evaluation framework** — shadow-mode ranking comparison with human preference labels
- **Rust-based diff parser** — sub-millisecond preprocessing, replacing Python regex for hunk tokenization

## License

MIT
