"""
ONNX export and INT8 quantization of the distilled student reranker.
Usage: python -m ml.models.export_onnx
"""
from __future__ import annotations

from pathlib import Path
import logging

logger = logging.getLogger(__name__)

CHECKPOINT_DIR = Path(__file__).parent / "reranker"
ONNX_DIR = Path(__file__).parent / "reranker_onnx"


def export_reranker_to_onnx(
    checkpoint_path: str | None = None,
    output_path: str | None = None,
) -> None:
    """Export distilled student reranker to ONNX format."""
    import torch
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    cp = Path(checkpoint_path or CHECKPOINT_DIR)
    out = Path(output_path or ONNX_DIR / "model.onnx")
    out.parent.mkdir(parents=True, exist_ok=True)

    # Load order: local checkpoint → HF Hub → codebert-base
    if cp.exists() and any(cp.iterdir()):
        model_name = str(cp)
        logger.info(f"Loading local checkpoint from {cp}")
    else:
        try:
            model_name = "ritunjaym/prism-reranker"
            logger.info(f"No local checkpoint found. Trying HF Hub: {model_name}")
            # Quick check: try loading tokenizer to detect format issues
            AutoTokenizer.from_pretrained(model_name, cache_dir="/tmp/hf-cache")
        except Exception as e:
            logger.warning(f"HF Hub load failed ({e}). Falling back to microsoft/codebert-base")
            model_name = "microsoft/codebert-base"

    try:
        tokenizer = AutoTokenizer.from_pretrained(model_name, cache_dir="/tmp/hf-cache")
        model = AutoModelForSequenceClassification.from_pretrained(
            model_name, num_labels=1, cache_dir="/tmp/hf-cache"
        )
    except Exception as e:
        logger.warning(f"Failed to load {model_name} ({e}). Falling back to microsoft/codebert-base")
        model_name = "microsoft/codebert-base"
        tokenizer = AutoTokenizer.from_pretrained(model_name, cache_dir="/tmp/hf-cache")
        model = AutoModelForSequenceClassification.from_pretrained(
            model_name, num_labels=1, cache_dir="/tmp/hf-cache"
        )

    model.eval()

    # Dummy input
    dummy = tokenizer(
        "def example(): pass",
        padding="max_length", max_length=128, truncation=True,
        return_tensors="pt",
    )

    with torch.no_grad():
        torch.onnx.export(
            model,
            tuple(dummy.values()),
            str(out),
            opset_version=14,
            input_names=["input_ids", "attention_mask", "token_type_ids"],
            output_names=["logits"],
            dynamic_axes={
                "input_ids": {0: "batch", 1: "sequence"},
                "attention_mask": {0: "batch", 1: "sequence"},
                "token_type_ids": {0: "batch", 1: "sequence"},
                "logits": {0: "batch"},
            },
        )
    logger.info(f"ONNX model exported to {out}")

    # Verify
    import onnxruntime as ort
    sess = ort.InferenceSession(str(out))
    ort_out = sess.run(None, {k: v.numpy() for k, v in dummy.items()})
    torch_out = model(**dummy).logits.detach().numpy()
    import numpy as np
    diff = abs(ort_out[0] - torch_out).max()
    logger.info(f"Max output diff PyTorch vs ONNX: {diff:.6f} ({'OK' if diff < 1e-3 else 'WARNING'})")

    print(f"Exported to {out} ({out.stat().st_size/1e6:.1f} MB)")
    print(f"Max output diff PyTorch vs ONNX: {diff:.6f} ({'OK' if diff < 1e-3 else 'WARNING'})")


def quantize_onnx_model(
    onnx_path: str | None = None,
    output_path: str | None = None,
) -> None:
    """INT8 quantize an ONNX model using onnxruntime."""
    from onnxruntime.quantization import quantize_dynamic, QuantType

    src = Path(onnx_path or ONNX_DIR / "model.onnx")
    dst = Path(output_path or ONNX_DIR / "model_int8.onnx")

    if not src.exists():
        raise FileNotFoundError(f"ONNX model not found at {src}. Run export first.")

    quantize_dynamic(str(src), str(dst), weight_type=QuantType.QInt8)

    size_fp32 = src.stat().st_size / 1e6
    size_int8 = dst.stat().st_size / 1e6
    compression = (1 - size_int8 / size_fp32) * 100
    print(f"Quantized: {size_fp32:.1f} MB → {size_int8:.1f} MB ({compression:.0f}% reduction)")

    # Verify quantized model runs
    import onnxruntime as ort
    import numpy as np
    sess = ort.InferenceSession(str(dst))
    dummy = {
        "input_ids": np.ones((1, 128), dtype=np.int64),
        "attention_mask": np.ones((1, 128), dtype=np.int64),
        "token_type_ids": np.zeros((1, 128), dtype=np.int64),
    }
    out = sess.run(None, dummy)
    print(f"INT8 model inference OK, output shape: {out[0].shape}")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    export_reranker_to_onnx()
    try:
        quantize_onnx_model()
    except FileNotFoundError as e:
        print(f"Skipping quantization: {e}")
