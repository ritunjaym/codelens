# CodeLens ML Results

## Evaluation Setup

- **Dataset**: 9 real GitHub PRs, manually annotated with file importance scores
- **Relevance threshold**: importance_score ≥ 0.5 → relevant
- **Metrics**: NDCG@5 (primary), NDCG@10, MRR, MAP, P@1, P@5
- **Confidence intervals**: bootstrap resampling, 1 000 iterations
- **Significance tests**: paired t-test vs FullPipeline, primary metric NDCG@5

## Baseline Comparison

| Baseline | NDCG@5 | NDCG@10 | MRR | MAP | P@1 | P@5 |
|----------|--------|---------|-----|-----|-----|-----|
| Random | 0.5121 [0.2334, 0.7866] ** | 0.6553 [0.4710, 0.8396] ** | 0.5838 [0.3280, 0.8519] ** | 0.5560 [0.3192, 0.7936] ** | 0.4444 [0.1111, 0.7778] ** | 0.3333 [0.1333, 0.5333] |
| FileSize | 0.9266 [0.7797, 1.0000] | 0.9331 [0.7994, 1.0000] | 1.0000 [1.0000, 1.0000] | 0.9331 [0.7992, 1.0000] | 1.0000 [1.0000, 1.0000] | 0.4222 [0.2444, 0.6667] |
| BM25 | 0.7614 [0.6075, 0.9153] | 0.7591 [0.6074, 0.9039] | 0.7685 [0.5463, 0.9259] | 0.6997 [0.5014, 0.8864] | 0.6667 [0.3333, 0.8889] | 0.4222 [0.2667, 0.6222] |
| DenseOnly | 0.5080 [0.2713, 0.7600] ** | 0.5610 [0.3518, 0.7884] ** | 0.5574 [0.3111, 0.8241] ** | 0.5072 [0.2886, 0.7480] ** | 0.4444 [0.1111, 0.7778] ** | 0.3111 [0.1556, 0.5111] |
| **FullPipeline** | **0.9266 [0.7797, 1.0000]** | **0.9331 [0.7994, 1.0000]** | **1.0000 [1.0000, 1.0000]** | **0.9331 [0.7992, 1.0000]** | **1.0000 [1.0000, 1.0000]** | **0.4222 [0.2444, 0.6667]** |

\*\* p < 0.05 vs FullPipeline (paired t-test)

## Significance Tests

| Baseline | Metric | t | p |
|----------|--------|---|---|
| Random | MAP | 2.648 | 0.0293 ✓ |
| Random | MRR | 3.035 | 0.0162 ✓ |
| Random | NDCG@10 | 2.360 | 0.0460 ✓ |
| Random | NDCG@5 | 2.559 | 0.0337 ✓ |
| Random | P@1 | 3.162 | 0.0133 ✓ |
| BM25 | MAP | 1.935 | 0.0891 |
| BM25 | MRR | 1.995 | 0.0811 |
| BM25 | NDCG@5 | 1.750 | 0.1183 |
| DenseOnly | MAP | 3.157 | 0.0134 ✓ |
| DenseOnly | MRR | 3.112 | 0.0144 ✓ |
| DenseOnly | NDCG@10 | 2.966 | 0.0180 ✓ |
| DenseOnly | NDCG@5 | 2.966 | 0.0180 ✓ |
| DenseOnly | P@1 | 3.162 | 0.0133 ✓ |

## Efficiency Comparison

Run `make benchmark` to generate `ml/eval/benchmark_table.md`.

The benchmark compares four inference configurations:

| Config | Description |
|--------|-------------|
| `pytorch_fp32` | Full PyTorch model, FP32 |
| `pytorch_lora` | PyTorch with LoRA adapters, FP32 |
| `onnx_fp32` | ONNX export, FP32 |
| `onnx_int8` | ONNX export + INT8 quantization (production) |

Expected speedup: onnx_int8 is ~3-4× faster than pytorch_fp32 on CPU with < 5% NDCG degradation.

## Reproducing Results

```bash
make setup-ml          # build dataset + FAISS index
make eval              # runs ml/eval/run_eval.py → overwrites ml/eval/results_table.md
make benchmark         # runs ml/eval/benchmark.py → writes ml/eval/benchmark_table.md
```
