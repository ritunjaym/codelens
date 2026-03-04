"""
Standalone INT8 quantization script for the ONNX reranker model.
Usage: python -m ml.models.quantize
Input:  ml/models/reranker_onnx/model.onnx
Output: ml/models/reranker_onnx/model_int8.onnx
"""
from __future__ import annotations

from pathlib import Path
import logging

logger = logging.getLogger(__name__)

ONNX_DIR = Path(__file__).parent / "reranker_onnx"


def quantize(
    onnx_path: str | None = None,
    output_path: str | None = None,
) -> Path:
    """
    INT8 quantize an ONNX model using onnxruntime quantize_dynamic.
    Returns the path to the quantized model.
    """
    from onnxruntime.quantization import quantize_dynamic, QuantType
    import onnxruntime as ort
    import numpy as np

    src = Path(onnx_path or ONNX_DIR / "model.onnx")
    dst = Path(output_path or ONNX_DIR / "model_int8.onnx")

    if not src.exists():
        raise FileNotFoundError(
            f"ONNX model not found at {src}. "
            "Run `python -m ml.models.export_onnx` first."
        )

    dst.parent.mkdir(parents=True, exist_ok=True)

    logger.info(f"Quantizing {src} → {dst}")
    quantize_dynamic(str(src), str(dst), weight_type=QuantType.QInt8)

    size_fp32 = src.stat().st_size / 1e6
    size_int8 = dst.stat().st_size / 1e6
    compression = (1 - size_int8 / size_fp32) * 100

    print(f"FP32: {size_fp32:.1f} MB")
    print(f"INT8: {size_int8:.1f} MB")
    print(f"Compression: {compression:.0f}% reduction ({size_fp32/size_int8:.2f}x smaller)")

    # Verify inference works
    sess = ort.InferenceSession(str(dst))
    dummy = {
        "input_ids": np.ones((1, 128), dtype=np.int64),
        "attention_mask": np.ones((1, 128), dtype=np.int64),
        "token_type_ids": np.zeros((1, 128), dtype=np.int64),
    }
    out = sess.run(None, dummy)
    print(f"Inference verification OK — output shape: {out[0].shape}, value: {out[0][0][0]:.4f}")

    return dst


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    quantize()
