import io
import numpy as np
from PIL import Image, ImageFilter


def cutout_png_bytes(
    image: Image.Image,
    mask: np.ndarray,
    threshold: float = 0.5,
    blur_radius: float = 1.0,
) -> bytes:
    if mask.ndim != 2:
        raise ValueError("Mask must be a 2D array.")

    h, w = image.height, image.width
    if mask.shape != (h, w):
        raise ValueError(f"Mask shape {mask.shape} does not match image {(h, w)}")

    threshold = float(max(0.0, min(1.0, threshold)))
    scaled = (mask.astype(np.float32) - threshold) / max(1e-6, 1.0 - threshold)
    alpha = np.clip(scaled, 0.0, 1.0)
    alpha_u8 = (alpha * 255.0).astype(np.uint8)

    alpha_img = Image.fromarray(alpha_u8, mode="L")
    if blur_radius > 0:
        alpha_img = alpha_img.filter(ImageFilter.GaussianBlur(radius=blur_radius))

    out = image.convert("RGBA")
    out.putalpha(alpha_img)

    buf = io.BytesIO()
    out.save(buf, format="PNG", optimize=True)
    return buf.getvalue()
