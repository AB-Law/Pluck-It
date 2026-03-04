import io
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.append(str(Path(__file__).resolve().parents[1]))

from postprocess import cutout_png_bytes


def test_cutout_png_bytes_adds_alpha():
    img = Image.new("RGB", (8, 8), color=(255, 0, 0))
    mask = np.zeros((8, 8), dtype=np.float32)
    mask[2:6, 2:6] = 1.0

    out = cutout_png_bytes(img, mask, threshold=0.5, blur_radius=0.0)
    decoded = Image.open(io.BytesIO(out))

    assert decoded.mode == "RGBA"
    alpha = np.array(decoded.getchannel("A"))
    assert alpha[0, 0] == 0
    assert alpha[3, 3] == 255
