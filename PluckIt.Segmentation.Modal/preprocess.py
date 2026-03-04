import io
from PIL import Image, ImageOps, UnidentifiedImageError


def load_rgb_image(image_bytes: bytes) -> Image.Image:
    try:
        with Image.open(io.BytesIO(image_bytes)) as img:
            img = ImageOps.exif_transpose(img)
            if img.mode != "RGB":
                img = img.convert("RGB")
            return img.copy()
    except UnidentifiedImageError as exc:
        raise ValueError("Invalid image payload.") from exc


def resize_max_side(image: Image.Image, max_side: int) -> Image.Image:
    if max_side <= 0:
        return image

    w, h = image.size
    longest = max(w, h)
    if longest <= max_side:
        return image

    scale = max_side / float(longest)
    nw = max(1, int(round(w * scale)))
    nh = max(1, int(round(h * scale)))
    return image.resize((nw, nh), Image.Resampling.LANCZOS)
