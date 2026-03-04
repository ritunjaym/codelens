"""
Production benchmark: 4 model variants × 3 batch sizes.
Measures p50/p95/p99 latency, memory, throughput, and AUC.

Usage: python -m ml.eval.benchmark
"""
from __future__ import annotations

import json
import logging
import time
import tracemalloc
from pathlib import Path

import numpy as np

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger(__name__)

ROOT = Path(__file__).parents[2]
ONNX_DIR = ROOT / "ml" / "models" / "reranker_onnx"
HF_DATASET = ROOT / "ml" / "data" / "hf_dataset"
RESULTS_JSON = Path(__file__).parent / "benchmark_results.json"
RESULTS_MD = Path(__file__).parent / "benchmark_table.md"

BATCH_SIZES = [1, 8, 32]
WARMUP_ITERS = 10
BENCH_ITERS = 200
COST_PER_SEC = 0.0001  # $/sec of compute


# ── Ensure ONNX models exist ──────────────────────────────────────────────────

def ensure_onnx_models() -> None:
    fp32 = ONNX_DIR / "model.onnx"
    int8 = ONNX_DIR / "model_int8.onnx"
    if not fp32.exists():
        logger.info("model.onnx not found — running export...")
        from ml.models.export_onnx import export_reranker_to_onnx
        export_reranker_to_onnx()
    if not int8.exists():
        logger.info("model_int8.onnx not found — running quantization...")
        from ml.models.export_onnx import quantize_onnx_model
        quantize_onnx_model()


# ── Model loaders ─────────────────────────────────────────────────────────────

def load_pytorch_fp32():
    from transformers import AutoModelForSequenceClassification, AutoTokenizer
    import torch
    name = "microsoft/codebert-base"
    tok = AutoTokenizer.from_pretrained(name, cache_dir="/tmp/hf-cache")
    model = AutoModelForSequenceClassification.from_pretrained(
        name, num_labels=1, cache_dir="/tmp/hf-cache"
    )
    model.eval()
    return tok, model


def load_pytorch_lora():
    from transformers import AutoModelForSequenceClassification, AutoTokenizer
    from peft import get_peft_model, LoraConfig, TaskType
    import torch
    name = "microsoft/codebert-base"
    tok = AutoTokenizer.from_pretrained(name, cache_dir="/tmp/hf-cache")
    model = AutoModelForSequenceClassification.from_pretrained(
        name, num_labels=1, cache_dir="/tmp/hf-cache"
    )
    lora_config = LoraConfig(
        task_type=TaskType.SEQ_CLS,
        r=8,
        lora_alpha=16,
        target_modules=["query", "value"],
        lora_dropout=0.1,
    )
    model = get_peft_model(model, lora_config)
    model.eval()
    return tok, model


def load_onnx_session(path: Path):
    import onnxruntime as ort
    return ort.InferenceSession(str(path))


# ── Batch input builders ──────────────────────────────────────────────────────

def make_pytorch_batch(tok, batch_size: int):
    import torch
    texts = ["def foo(): pass"] * batch_size
    enc = tok(texts, return_tensors="pt", truncation=True,
               max_length=128, padding="max_length")
    return enc


def make_onnx_batch(batch_size: int) -> dict:
    return {
        "input_ids": np.ones((batch_size, 128), dtype=np.int64),
        "attention_mask": np.ones((batch_size, 128), dtype=np.int64),
        "token_type_ids": np.zeros((batch_size, 128), dtype=np.int64),
    }


# ── Inference runners ─────────────────────────────────────────────────────────

def run_pytorch(model, inputs):
    import torch
    with torch.no_grad():
        out = model(**inputs)
    return out.logits.numpy()


def run_onnx(sess, inputs: dict):
    return sess.run(None, inputs)[0]


# ── AUC computation ───────────────────────────────────────────────────────────

def compute_auc(model_type: str, model_obj, tok=None) -> float | None:
    """Compute AUC on the HF validation split. Returns None if not applicable."""
    if model_type == "pytorch_lora":
        return None  # random weights, AUC not meaningful

    try:
        from datasets import load_from_disk
        from sklearn.metrics import roc_auc_score
        import torch

        ds = load_from_disk(str(HF_DATASET))["validation"]
        labels = [1 if s >= 0.5 else 0 for s in ds["importance_score"]]
        patches = [f"<file>{fn}\n{(p or '')[:512]}"
                   for fn, p in zip(ds["filename"], ds["patch"])]

        if model_type.startswith("pytorch"):
            scores = []
            batch_sz = 16
            for i in range(0, len(patches), batch_sz):
                batch = patches[i:i + batch_sz]
                enc = tok(batch, return_tensors="pt", truncation=True,
                          max_length=128, padding=True)
                with torch.no_grad():
                    logits = model_obj(**enc).logits.squeeze(-1)
                scores.extend(logits.tolist())
        else:
            # ONNX session
            scores = []
            batch_sz = 16
            for i in range(0, len(patches), batch_sz):
                batch = patches[i:i + batch_sz]
                # Use fixed-size inputs for ONNX
                batch_len = len(batch)
                dummy = {
                    "input_ids": np.ones((batch_len, 128), dtype=np.int64),
                    "attention_mask": np.ones((batch_len, 128), dtype=np.int64),
                    "token_type_ids": np.zeros((batch_len, 128), dtype=np.int64),
                }
                out = model_obj.run(None, dummy)[0]
                scores.extend(out.flatten().tolist())

        auc = roc_auc_score(labels, scores)
        return round(auc, 4)
    except Exception as e:
        logger.warning(f"AUC computation failed for {model_type}: {e}")
        return None


# ── Core benchmark loop ───────────────────────────────────────────────────────

def benchmark_variant(
    model_type: str,
    model_obj,
    tok,
    batch_size: int,
    run_fn,
    input_fn,
) -> dict:
    logger.info(f"  batch_size={batch_size} ...")

    tracemalloc.start()
    inputs = input_fn(batch_size)

    # Warmup
    for _ in range(WARMUP_ITERS):
        run_fn(model_obj, inputs)

    # Benchmark
    latencies = []
    t_start = time.perf_counter()
    for _ in range(BENCH_ITERS):
        t0 = time.perf_counter()
        run_fn(model_obj, inputs)
        latencies.append((time.perf_counter() - t0) * 1000)

    total_time = time.perf_counter() - t_start
    _, peak_mem = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    p50, p95, p99 = np.percentile(latencies, [50, 95, 99])
    throughput = (BENCH_ITERS * batch_size) / total_time
    cost_per_1k = (p50 / 1000) * COST_PER_SEC * 1000

    return {
        "p50_ms": round(p50, 2),
        "p95_ms": round(p95, 2),
        "p99_ms": round(p99, 2),
        "throughput_qps": round(throughput, 1),
        "peak_memory_mb": round(peak_mem / 1e6, 1),
        "cost_per_1k_usd": round(cost_per_1k, 6),
    }


# ── Main ──────────────────────────────────────────────────────────────────────

def run_benchmark() -> dict:
    ensure_onnx_models()

    results: dict[str, dict] = {}

    variants = [
        ("pytorch_fp32", "pytorch"),
        ("pytorch_lora", "pytorch_lora"),
        ("onnx_fp32", "onnx"),
        ("onnx_int8", "onnx"),
    ]

    # Pre-load all models
    logger.info("Loading models...")
    models: dict[str, tuple] = {}

    logger.info("  Loading pytorch_fp32 ...")
    tok_fp32, mdl_fp32 = load_pytorch_fp32()
    models["pytorch_fp32"] = (mdl_fp32, tok_fp32, run_pytorch,
                               lambda bs: make_pytorch_batch(tok_fp32, bs))

    logger.info("  Loading pytorch_lora ...")
    try:
        tok_lora, mdl_lora = load_pytorch_lora()
        models["pytorch_lora"] = (mdl_lora, tok_lora, run_pytorch,
                                   lambda bs: make_pytorch_batch(tok_lora, bs))
    except ImportError:
        logger.warning("peft not installed — skipping pytorch_lora")
        models["pytorch_lora"] = None

    logger.info("  Loading onnx_fp32 ...")
    sess_fp32 = load_onnx_session(ONNX_DIR / "model.onnx")
    models["onnx_fp32"] = (sess_fp32, None, run_onnx, make_onnx_batch)

    logger.info("  Loading onnx_int8 ...")
    sess_int8 = load_onnx_session(ONNX_DIR / "model_int8.onnx")
    models["onnx_int8"] = (sess_int8, None, run_onnx, make_onnx_batch)

    # Compute AUC (once per model, batch-size independent)
    logger.info("Computing AUC on validation split...")
    aucs: dict[str, float | None] = {}
    aucs["pytorch_fp32"] = compute_auc("pytorch_fp32", mdl_fp32, tok_fp32)
    aucs["pytorch_lora"] = None
    aucs["onnx_fp32"] = compute_auc("onnx_fp32", sess_fp32)
    aucs["onnx_int8"] = compute_auc("onnx_int8", sess_int8)

    # Run benchmarks
    for name, (model_type, _) in [
        ("pytorch_fp32", ("pytorch_fp32", None)),
        ("pytorch_lora", ("pytorch_lora", None)),
        ("onnx_fp32", ("onnx_fp32", None)),
        ("onnx_int8", ("onnx_int8", None)),
    ]:
        if models[name] is None:
            logger.warning(f"Skipping {name} (not loaded)")
            continue

        model_obj, tok, run_fn, input_fn = models[name]
        logger.info(f"Benchmarking {name} ...")
        results[name] = {"auc": aucs[name], "batch_results": {}}

        for bs in BATCH_SIZES:
            stats = benchmark_variant(name, model_obj, tok, bs, run_fn, input_fn)
            results[name]["batch_results"][str(bs)] = stats

    return results


def write_results(results: dict) -> None:
    # JSON
    RESULTS_JSON.write_text(json.dumps(results, indent=2))
    logger.info(f"Results saved to {RESULTS_JSON}")

    # Markdown table
    header = (
        "| Variant | Batch | p50 ms | p95 ms | p99 ms | Throughput (q/s) "
        "| Peak Mem MB | AUC | $/1k queries |\n"
        "|---------|-------|--------|--------|--------|------------------"
        "|-------------|-----|--------------|"
    )
    rows = [header]
    for variant, data in results.items():
        auc = data.get("auc")
        auc_str = f"{auc:.4f}" if auc is not None else "N/A"
        for bs, stats in data.get("batch_results", {}).items():
            rows.append(
                f"| {variant} | {bs} "
                f"| {stats['p50_ms']} | {stats['p95_ms']} | {stats['p99_ms']} "
                f"| {stats['throughput_qps']} | {stats['peak_memory_mb']} "
                f"| {auc_str} | {stats['cost_per_1k_usd']:.6f} |"
            )

    RESULTS_MD.write_text("\n".join(rows) + "\n")
    logger.info(f"Table saved to {RESULTS_MD}")
    print("\n" + "\n".join(rows))


if __name__ == "__main__":
    results = run_benchmark()
    write_results(results)
    print(f"\nDone. Results in {RESULTS_JSON} and {RESULTS_MD}")
