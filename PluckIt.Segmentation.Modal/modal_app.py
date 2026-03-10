from __future__ import annotations

import os
import logging
from time import perf_counter

import modal
from fastapi import HTTPException, Request, Response
from starlette.requests import ClientDisconnect

from auth import is_valid_bearer
from inference import BiRefNetSegmenter
from postprocess import cutout_png_bytes
from preprocess import load_rgb_image, resize_max_side

APP_NAME = "pluckit-birefnet-segmentation"
logger = logging.getLogger(__name__)

DEFAULT_SCALEDOWN_WINDOW_SECONDS = int(os.getenv("SCALEDOWN_WINDOW_SECONDS", "60"))
DEFAULT_MAX_IMAGE_MB = int(os.getenv("MAX_IMAGE_MB", "10"))
DEFAULT_MAX_DIM = int(os.getenv("MAX_IMAGE_DIM", "1536"))
DEFAULT_MASK_THRESHOLD = float(os.getenv("MASK_THRESHOLD", "0.5"))
DEFAULT_MODEL_ID = os.getenv("BIREFNET_MODEL_ID", os.getenv("BIRENET_MODEL_ID", "ZhengPeng7/BiRefNet"))
DEFAULT_MODEL_REVISION = os.getenv("BIREFNET_MODEL_REVISION")
MODEL_CACHE_VOLUME_NAME = os.getenv("MODEL_CACHE_VOLUME_NAME", "pluckit-birefnet-cache")
MODEL_CACHE_DIR = os.getenv("MODEL_CACHE_DIR", "/cache")
SEGMENTATION_SECRET_NAME = os.getenv("SEGMENTATION_SECRET_NAME", "pluckit-segmentation")

image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install_from_requirements("requirements.txt")
    .add_local_file("auth.py", "/root/auth.py")
    .add_local_file("inference.py", "/root/inference.py")
    .add_local_file("preprocess.py", "/root/preprocess.py")
    .add_local_file("postprocess.py", "/root/postprocess.py")
)

app = modal.App(APP_NAME)
model_cache_volume = modal.Volume.from_name(MODEL_CACHE_VOLUME_NAME, create_if_missing=True)
segmentation_secret = modal.Secret.from_name(SEGMENTATION_SECRET_NAME, required_keys=["SEGMENTATION_SHARED_TOKEN"])

_segmenter: BiRefNetSegmenter | None = None


def _expected_token() -> str:
    token = os.getenv("SEGMENTATION_SHARED_TOKEN", "")
    if not token:
        raise RuntimeError("SEGMENTATION_SHARED_TOKEN is required.")
    return token


def _configure_model_cache() -> None:
    hf_home = f"{MODEL_CACHE_DIR}/huggingface"
    os.makedirs(hf_home, exist_ok=True)
    os.environ.setdefault("HF_HOME", hf_home)
    os.environ.setdefault("HF_HUB_CACHE", f"{hf_home}/hub")
    os.environ.setdefault("TRANSFORMERS_CACHE", f"{hf_home}/transformers")


async def _get_segmenter() -> BiRefNetSegmenter:
    global _segmenter
    if _segmenter is None:
        _configure_model_cache()
        try:
            await model_cache_volume.reload.aio()
        except Exception:
            pass
        _segmenter = BiRefNetSegmenter(DEFAULT_MODEL_ID, revision=DEFAULT_MODEL_REVISION)
        logger.info(
            "Loaded segmenter model=%s revision=%s device=%s",
            DEFAULT_MODEL_ID,
            DEFAULT_MODEL_REVISION or "latest",
            _segmenter.device,
        )
        try:
            await model_cache_volume.commit.aio()
        except Exception:
            pass
    return _segmenter


async def _read_image_bytes(request: Request) -> bytes:
    content_type = request.headers.get("content-type", "")

    try:
        if "multipart/form-data" in content_type:
            form = await request.form()
            upload = form.get("image")
            if upload is None or not hasattr(upload, "read"):
                raise HTTPException(status_code=400, detail="No image provided.")
            return await upload.read()

        if content_type.startswith("image/") or not content_type:
            return await request.body()
    except ClientDisconnect as exc:
        raise HTTPException(status_code=400, detail="Client disconnected during upload.") from exc

    raise HTTPException(status_code=415, detail="Unsupported media type.")


@app.function(
    image=image,
    gpu="T4",
    timeout=300,
    scaledown_window=DEFAULT_SCALEDOWN_WINDOW_SECONDS,
    volumes={MODEL_CACHE_DIR: model_cache_volume},
    secrets=[segmentation_secret],
)
@modal.concurrent(max_inputs=1)
@modal.fastapi_endpoint(method="POST")
async def segment(request: Request) -> Response:
    auth_header = request.headers.get("authorization")
    if not is_valid_bearer(auth_header, _expected_token()):
        raise HTTPException(status_code=401, detail="Unauthorized")

    image_bytes = await _read_image_bytes(request)
    if not image_bytes:
        raise HTTPException(status_code=400, detail="No image provided.")

    max_bytes = DEFAULT_MAX_IMAGE_MB * 1024 * 1024
    if len(image_bytes) > max_bytes:
        raise HTTPException(status_code=413, detail=f"Image exceeds {DEFAULT_MAX_IMAGE_MB}MB limit.")

    start = perf_counter()

    try:
        img = load_rgb_image(image_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        segmenter = await _get_segmenter()
        mask = segmenter.predict_mask(img)
        out_png = cutout_png_bytes(
            image=img,
            mask=mask,
            threshold=DEFAULT_MASK_THRESHOLD,
            blur_radius=1.0,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Segmentation failed: {type(exc).__name__}") from exc

    elapsed_ms = int((perf_counter() - start) * 1000)
    return Response(
        content=out_png,
        media_type="image/png",
        headers={
            "X-Model": DEFAULT_MODEL_ID,
            "X-Model-Revision": DEFAULT_MODEL_REVISION or "latest",
            "X-Device": segmenter.device,
            "X-Output-Width": str(img.width),
            "X-Output-Height": str(img.height),
            "X-Process-Ms": str(elapsed_ms),
        },
    )
