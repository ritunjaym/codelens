"""
ONNX export and INT8 quantization of the distilled student reranker.
Usage: python -m ml.models.export_onnx
"""
from __future__ import annotations

from pathlib import Path

import structlog

log = structlog.get_logger()

CHECKPOINT_DIR = Path(__file__).parent / "reranker"
ONNX_DIR = Path(__file__).parent / "reranker_onnx"


def export_reranker_to_onnx(
    checkpoint_path: str | None = None,
    output_path: str | None = None,
) -> None:
    """Export the distilled student reranker to ONNX format (opset 14).

    Load order: local checkpoint → ``ritunjaym/prism-reranker`` on HF Hub →
    ``microsoft/codebert-base`` (final fallback).  Verifies that the maximum
    absolute difference between PyTorch and ONNX outputs is < 1e-3.

    Args:
        checkpoint_path: Path to a local model directory.  Defaults to
            ``ml/models/reranker``.
        output_path: Destination ``.onnx`` file path.  Defaults to
            ``ml/models/reranker_onnx/model.onnx``.
    """
    import torch
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    cp = Path(checkpoint_path or CHECKPOINT_DIR)
    out = Path(output_path or ONNX_DIR / "model.onnx")
    out.parent.mkdir(parents=True, exist_ok=True)

    # Tokenizer: always load from codebert-base.
    # prism-reranker's tokenizer.json has a format incompatibility, but its
    # vocabulary is identical to codebert-base so codebert-base's tokenizer works.
    tokenizer = AutoTokenizer.from_pretrained("microsoft/codebert-base", cache_dir="/tmp/hf-cache")
    log.info("Tokenizer loaded from microsoft/codebert-base")

    # Model weights: local checkpoint → ritunjaym/prism-reranker → codebert-base fallback
    if cp.exists() and any(cp.iterdir()):
        model_name = str(cp)
        log.info(f"Loading model from local checkpoint: {cp}")
    else:
        model_name = "ritunjaym/prism-reranker"
        log.info(f"No local checkpoint. Loading model from HF Hub: {model_name}")

    try:
        model = AutoModelForSequenceClassification.from_pretrained(
            model_name, num_labels=1, cache_dir="/tmp/hf-cache",
            ignore_mismatched_sizes=True,
        )
        log.info(f"Model loaded from {model_name}")
    except Exception as e:
        log.warning(f"Failed to load {model_name} ({e}). Falling back to microsoft/codebert-base")
        model_name = "microsoft/codebert-base"
        model = AutoModelForSequenceClassification.from_pretrained(
            model_name, num_labels=1, cache_dir="/tmp/hf-cache"
        )

    model.eval()

    # Dummy input — use only what the tokenizer actually returns
    dummy = tokenizer(
        "def example(): pass",
        padding="max_length", max_length=128, truncation=True,
        return_tensors="pt",
    )
    input_names = list(dummy.keys())  # e.g. ["input_ids", "attention_mask"]
    log.info(f"Tokenizer returns inputs: {input_names}")

    with torch.no_grad():
        torch.onnx.export(
            model,
            tuple(dummy.values()),
            str(out),
            opset_version=14,
            input_names=input_names,
            output_names=["logits"],
            dynamic_axes={name: {0: "batch", 1: "sequence"} for name in input_names}
            | {"logits": {0: "batch"}},
        )
    log.info(f"ONNX model exported to {out}")

    # Verify
    import onnxruntime as ort
    sess = ort.InferenceSession(str(out))
    # Only pass inputs the ONNX model accepts
    onnx_input_names = {i.name for i in sess.get_inputs()}
    ort_feed = {k: v.numpy() for k, v in dummy.items() if k in onnx_input_names}
    ort_out = sess.run(None, ort_feed)
    torch_out = model(**dummy).logits.detach().numpy()
    import numpy as np
    diff = abs(ort_out[0] - torch_out).max()
    log.info(f"Max output diff PyTorch vs ONNX: {diff:.6f} ({'OK' if diff < 1e-3 else 'WARNING'})")

    log.info("exported ONNX model", path=str(out), size_mb=round(out.stat().st_size/1e6, 1), max_diff=round(float(diff), 6), status="ok" if diff < 1e-3 else "WARNING")


def quantize_onnx_model(
    onnx_path: str | None = None,
    output_path: str | None = None,
) -> None:
    """Dynamically quantize an ONNX model to INT8 using onnxruntime.

    Applies ``onnxruntime.quantization.quantize_dynamic`` with
    ``weight_type=QInt8``.  Prints the compression ratio and verifies that the
    quantized model can perform a forward pass.

    Args:
        onnx_path: Source FP32 ``.onnx`` file.  Defaults to
            ``ml/models/reranker_onnx/model.onnx``.
        output_path: Destination INT8 ``.onnx`` file.  Defaults to
            ``ml/models/reranker_onnx/model_int8.onnx``.

    Raises:
        FileNotFoundError: If ``onnx_path`` does not exist.
    """
    from onnxruntime.quantization import quantize_dynamic, QuantType

    src = Path(onnx_path or ONNX_DIR / "model.onnx")
    dst = Path(output_path or ONNX_DIR / "model_int8.onnx")

    if not src.exists():
        raise FileNotFoundError(f"ONNX model not found at {src}. Run export first.")

    quantize_dynamic(str(src), str(dst), weight_type=QuantType.QInt8)

    size_fp32 = src.stat().st_size / 1e6
    size_int8 = dst.stat().st_size / 1e6
    compression = (1 - size_int8 / size_fp32) * 100
    log.info("quantized ONNX to INT8", fp32_mb=round(size_fp32, 1), int8_mb=round(size_int8, 1), compression_pct=round(compression, 0))

    # Verify quantized model runs — only pass inputs the model accepts
    import onnxruntime as ort
    import numpy as np
    sess = ort.InferenceSession(str(dst))
    onnx_input_names = {i.name for i in sess.get_inputs()}
    all_possible = {
        "input_ids": np.ones((1, 128), dtype=np.int64),
        "attention_mask": np.ones((1, 128), dtype=np.int64),
        "token_type_ids": np.zeros((1, 128), dtype=np.int64),
    }
    dummy = {k: v for k, v in all_possible.items() if k in onnx_input_names}
    out = sess.run(None, dummy)
    log.info("INT8 inference verification ok", output_shape=str(out[0].shape))


if __name__ == "__main__":
    export_reranker_to_onnx()
    try:
        quantize_onnx_model()
    except FileNotFoundError as e:
        log.warning("skipping quantization", error=str(e))
