# Changelog

All notable changes to CodeLens are documented here.

## [1.0.0] — 2026-02-20

### v0.16.0 — Phase 15: Tests + Docs + README
- Comprehensive README with architecture, ML results, design decisions
- Architecture SVG diagram (dark-themed)
- Playwright E2E test framework (chromium)
- OpenAPI spec export (5 endpoints)
- Model card for distilled reranker
- CONTRIBUTING.md guide

### v0.15.0 — Phase 14: Performance + ONNX Export
- ONNX export of reranker (opset 14, dynamic axes)
- INT8 quantization via onnxruntime
- ResizeObserver polyfill for test environment
- Responsive layout foundations

### v0.14.0 — Phase 13: Accessibility
- WCAG 2.1 AA structural compliance
- axe-core test helper
- role=alert on ML unavailable banner
- role=dialog on modals
- Proper alt text and ARIA labels throughout

### v0.13.0 — Phase 12: Keyboard Navigation + Command Palette
- useHotkeys hook (skips input-focused elements)
- cmdk-based command palette (Files/Clusters/Actions groups)
- KeyboardShortcutsModal (? key)
- Full keyboard shortcut registry

### v0.12.0 — Phase 11: Real-time Collaboration
- PartyKit WebSocket presence (usePRRoom hook)
- PresenceBar with avatar stack + active dot
- Graceful no-op when PARTYKIT_HOST not set

### v0.11.0 — Phase 10: Inline Commenting
- Per-line inline comments with localStorage persistence
- CommentThread component with resolve/delete
- LineComment shared TypeScript interface
- date-fns relative timestamps

### v0.10.0 — Phase 9: ML Prioritization UI
- RankBadge with 5-tier color system and score breakdown tooltip
- ClusterPanel filterable sidebar
- MLUnavailableBanner graceful degradation
- PRReviewView orchestrating all ML components

### v0.9.0 — Phase 8: Diff Viewer + Virtualization
- Unified and split diff viewer with line numbers
- Shiki-ready language detection (25 extensions)
- @tanstack/react-virtual file list virtualization
- Color-coded add/remove/context lines

### v0.8.0 — Phase 7: GitHub OAuth + PR Dashboard
- NextAuth v5 GitHub provider with accessToken in session
- Dashboard fetching open PRs across user's repos via Octokit
- PRCard + PRCardSkeleton components
- Webhook HMAC validation + ML API forwarding

### v0.7.0 — Phase 6: FastAPI ML API Server
- POST /rank, /cluster, /retrieve, /webhooks/github
- MLService singleton with lazy loading + zero-shot fallback
- asyncio.Queue background PR processing
- HMAC-SHA256 webhook signature validation

### v0.6.0 — Phase 5: ML Evaluation Suite
- Ranking metrics: MSE, MAE, Spearman ρ, Kendall τ, NDCG@5/10
- Retrieval metrics: Recall@k, MRR
- Clustering metrics: Silhouette, Davies-Bouldin
- 3 baselines: Random, FileSize, PathHeuristic
- HTML eval report with inline SVG charts

### v0.5.0 — Phase 4: Semantic Clustering (HDBSCAN)
- SemanticClusterer with noise-as-singleton handling
- Singleton fallback for PRs with < 4 files
- n-gram label generation from filenames + diffs
- PRGrouper high-level pipeline
- Coherence score (mean pairwise cosine similarity)

### v0.4.0 — Phase 3: Reranker LoRA + Distillation
- Reranker inference wrapper with fine-tuned model loading
- Zero-shot keyword heuristic fallback
- Colab notebook: LoRA teacher + CodeT5-small student distillation
- rank() returns descending-scored items

### v0.3.0 — Phase 2: Dense Retrieval (CodeBERT + FAISS)
- CodeEmbedder: mean pooling + L2 normalization
- PRIndex: FAISS IndexFlatIP with save/load
- build_index.py: batch embedding + index construction
- Colab notebook for GPU-accelerated indexing

### v0.2.0 — Phase 1: Dataset Pipeline
- GitHub PR scraper (rate-limit aware, async)
- Unified diff parser (hunks, line types)
- Importance labeler (path/size/security heuristics)
- HuggingFace DatasetDict export + W&B logging

### v0.1.0 — Phase 0: Monorepo Scaffold
- Turborepo + npm workspaces
- Next.js 14 App Router + TypeScript + Tailwind + shadcn/ui
- FastAPI health endpoint
- Shared TypeScript types package
- PartyKit server stub
- pyproject.toml with hatch + dep groups
