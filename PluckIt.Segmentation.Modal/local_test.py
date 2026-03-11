from __future__ import annotations

import sys

if __name__ != "__main__":
    import pytest

    pytest.skip("local utility script, not a unit test module", allow_module_level=True)

import argparse
from pathlib import Path
from time import perf_counter

from inference import BiRefNetSegmenter
from postprocess import cutout_png_bytes
from preprocess import load_rgb_image

__test__ = False


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run BiRefNet segmentation fully locally (no Modal)."
    )
    parser.add_argument("--input", required=True, help="Path to input image")
    parser.add_argument("--output", required=True, help="Path to output PNG")
    parser.add_argument(
        "--model-id",
        default="ZhengPeng7/BiRefNet",
        help="Hugging Face model id (default: ZhengPeng7/BiRefNet)",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=0.5,
        help="Mask threshold in [0,1], default 0.5",
    )
    parser.add_argument(
        "--blur-radius",
        type=float,
        default=1.0,
        help="Alpha edge blur radius, default 1.0",
    )
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    image_bytes = input_path.read_bytes()
    image = load_rgb_image(image_bytes)

    t0 = perf_counter()
    segmenter = BiRefNetSegmenter(args.model_id)
    t1 = perf_counter()
    mask = segmenter.predict_mask(image)
    t2 = perf_counter()

    out_png = cutout_png_bytes(
        image=image,
        mask=mask,
        threshold=args.threshold,
        blur_radius=args.blur_radius,
    )
    output_path.write_bytes(out_png)
    t3 = perf_counter()

    print(f"input={input_path}")
    print(f"output={output_path}")
    print(f"model={args.model_id}")
    print(f"load_ms={(t1 - t0) * 1000:.1f}")
    print(f"infer_ms={(t2 - t1) * 1000:.1f}")
    print(f"encode_ms={(t3 - t2) * 1000:.1f}")
    print(f"total_ms={(t3 - t0) * 1000:.1f}")


if __name__ == "__main__":
    main()
