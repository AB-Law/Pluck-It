"""
PluckIt Python Processor — Azure Functions v2 with FastAPI ASGI.

HTTP routes are handled by FastAPI (enabling true SSE streaming).
Non-HTTP triggers (blob, timer) remain as AsgiFunctionApp decorators.

Endpoints:
    POST /api/process-image               — background removal (existing, now FastAPI)
    POST /api/chat                        — SSE streaming stylist agent chat
    GET  /api/chat/memory                 — retrieve user's conversation memory summary
    PUT  /api/chat/memory                 — update user's conversation memory summary
    GET  /api/digest/latest               — most recent wardrobe digest suggestions
    GET  /api/insights/vault              — deterministic vault insights + CPW intelligence
    POST /api/digest/run                  — manually trigger digest generation (dev/testing)
    GET  /api/digest/feedback             — fetch feedback already given for a digest
    POST /api/digest/feedback             — record thumbs-up/down on a digest suggestion
    GET  /api/moods                       — list all fashion trend moods (filter: ?primaryMood=)
    GET  /api/moods/{mood_id}             — get a single mood by ID
    POST /api/moods/seed                  — one-time sitemap seeder (admin)
    GET  /api/health                      — processor health check

  Scraper endpoints:
  GET  /api/scraper/sources             — list available scraper sources
  POST /api/scraper/sources             — suggest a new brand site (triggers LLM config gen)
  POST /api/scraper/subscribe/{source_id}   — subscribe current user to a source
  DELETE /api/scraper/subscribe/{source_id} — unsubscribe current user from a source
  POST /api/scraper/run/{source_id}     — on-demand scrape for a single source (dev/admin)

  Taste calibration endpoints:
  GET  /api/taste/quiz                  — get or create quiz session for current user
  POST /api/taste/quiz/{session_id}/respond — record a thumbs-up/down response
  POST /api/taste/quiz/{session_id}/complete — finalise quiz and update style profile
"""

import asyncio
import io
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

# Point rembg at the bundled model directory so it never downloads at runtime.
os.environ.setdefault(
    "U2NET_HOME",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "models"),
)

import azure.functions as func
from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from PIL import Image, UnidentifiedImageError
from pillow_heif import register_heif_opener

from agents.auth import get_user_id
from agents.memory import load_memory, save_memory, maybe_summarize
from agents.stylist_agent import stream_stylist_response
from agents.mood_processor import PRIMARY_MOODS

register_heif_opener()

logger = logging.getLogger(__name__)

# ── FastAPI application ──────────────────────────────────────────────────────

fastapi_app = FastAPI(title="PluckIt Processor", docs_url=None, redoc_url=None)

_ALLOWED_ORIGINS = [o.strip() for o in os.getenv("CORS_ALLOWED_ORIGINS", "").split(",") if o.strip()]
if not _ALLOWED_ORIGINS:
    _ALLOWED_ORIGINS = ["*"]

fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# ── Global exception handler — ensures all unhandled errors are logged via
# Python's logging module, which the Azure Functions worker forwards to
# App Insights. Without this, ASGI-boundary exceptions produce blank 500s
# with no telemetry.

@fastapi_app.exception_handler(Exception)
async def _global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception(
        "Unhandled exception on %s %s: %s",
        request.method,
        request.url.path,
        exc,
    )
    return JSONResponse(
        status_code=500,
        content={"detail": f"{type(exc).__name__}: {exc}"},
    )


@fastapi_app.on_event("startup")
async def _startup_log() -> None:
    env = os.getenv("AZURE_FUNCTIONS_ENVIRONMENT", "Production")
    logger.info("PluckIt Processor started — environment=%s", env)


# ── Azure Functions ASGI app (handles HTTP via FastAPI + non-HTTP triggers) ──

app = func.AsgiFunctionApp(app=fastapi_app, http_auth_level=func.AuthLevel.ANONYMOUS)


# ── Helper utilities ─────────────────────────────────────────────────────────

def _get_env(name: str, default: Optional[str] = None) -> str:
    value = os.getenv(name, default)
    if value is None:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def _normalize_image(image_bytes: bytes) -> bytes:
    try:
        with Image.open(io.BytesIO(image_bytes)) as img:
            if img.mode not in ("RGB",):
                img = img.convert("RGB")
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=95)
            return buf.getvalue()
    except (UnidentifiedImageError, Exception):
        return image_bytes


def _remove_background(image_bytes: bytes) -> bytes:
    from rembg import remove as rembg_remove
    normalised = _normalize_image(image_bytes)
    return rembg_remove(normalised)


def _segment_with_modal(image_bytes: bytes) -> bytes:
    """
    Send image to the Modal BiRefNet segmentation service.
    Returns transparent PNG bytes.
    Raises on any error so the caller can fall back to rembg.
    """
    import httpx
    endpoint_url = os.getenv("SEGMENTATION_ENDPOINT_URL", "").rstrip("/")
    token = os.getenv("SEGMENTATION_SHARED_TOKEN", "")
    if not endpoint_url:
        raise RuntimeError("SEGMENTATION_ENDPOINT_URL is not configured.")
    # Normalise to JPEG before sending (BiRefNet endpoint expects JPEG or PNG)
    normalised = _normalize_image(image_bytes)
    with httpx.Client(timeout=85.0) as client:
        resp = client.post(
            endpoint_url,
            content=normalised,
            headers={
                "Content-Type": "image/jpeg",
                "Authorization": f"Bearer {token}",
            },
        )
        resp.raise_for_status()
        return resp.content


def _get_blob_service():
    from azure.storage.blob import BlobServiceClient
    account_name = _get_env("STORAGE_ACCOUNT_NAME")
    account_key = _get_env("STORAGE_ACCOUNT_KEY")
    conn_str = (
        f"DefaultEndpointsProtocol=https;"
        f"AccountName={account_name};"
        f"AccountKey={account_key};"
        f"EndpointSuffix=core.windows.net"
    )
    return BlobServiceClient.from_connection_string(conn_str)


def _infer_basic_tags(image: Image.Image) -> dict[str, Any]:
    small = image.resize((32, 32))
    result = small.convert("P", palette=Image.ADAPTIVE, colors=4)
    palette = result.getpalette()
    color_counts = sorted(result.getcolors(), reverse=True)
    if not color_counts or not palette:
        return {"color": "unknown", "category": "unknown"}
    dominant_color_index = color_counts[0][1]
    pi = dominant_color_index * 3
    r, g, b = palette[pi], palette[pi + 1], palette[pi + 2]
    return {"color": f"#{r:02x}{g:02x}{b:02x}", "category": "unknown"}


# ── Timer trigger: weekly wardrobe digest ────────────────────────────────────

@app.function_name(name="PluckItWeeklyDigest")
@app.timer_trigger(
    arg_name="digest_timer",
    schedule="0 0 9 * * 1",  # Every Monday at 09:00 UTC
    run_on_startup=False,
    is_carryover=False,
)
def pluck_it_weekly_digest(digest_timer: func.TimerRequest) -> None:
    logger.info("PluckItWeeklyDigest: triggered (past_due=%s)", digest_timer.past_due)
    try:
        from agents.digest_agent import run_weekly_digest
        run_weekly_digest()
    except Exception as exc:
        logger.exception("Weekly digest failed: %s", exc)


# ── Timer trigger: daily mood processing from fashion RSS feeds ───────────────

@app.function_name(name="PluckItMoodProcessor")
@app.timer_trigger(
    arg_name="mood_timer",
    schedule="0 0 6 * * *",  # Every day at 06:00 UTC
    run_on_startup=False,
    is_carryover=False,
)
def pluck_it_mood_processor(mood_timer: func.TimerRequest) -> None:
    logger.info("PluckItMoodProcessor: triggered (past_due=%s)", mood_timer.past_due)
    try:
        from agents.mood_processor import run_mood_processor
        run_mood_processor()
    except Exception as exc:
        logger.exception("Mood processing failed: %s", exc)


# ── Timer trigger: daily fashion content scraper ──────────────────────────────

@app.function_name(name="PluckItScraper")
@app.timer_trigger(
    arg_name="scraper_timer",
    schedule="0 0 7 * * *",  # Every day at 07:00 UTC
    run_on_startup=False,
    is_carryover=False,
)
def pluck_it_scraper(scraper_timer: func.TimerRequest) -> None:
    logger.info("PluckItScraper: triggered (past_due=%s)", scraper_timer.past_due)
    try:
        from agents.scraper_runner import run_global_scrapers
        run_global_scrapers()
    except Exception as exc:
        logger.exception("Scraper run failed: %s", exc)


# ── FastAPI routes ────────────────────────────────────────────────────────────

@fastapi_app.get("/api/health")
async def health():
    return {"status": "ok", "service": "pluckit-processor"}


# ── Process image ─────────────────────────────────────────────────────────────

@fastapi_app.post("/api/process-image", status_code=201)
async def process_image(request: Request):
    """
    Accept an image as multipart/form-data (field 'image') or raw bytes.
    Optional form field 'item_id' sets the blob/Cosmos id directly.
    Attempts Modal BiRefNet segmentation; falls back to rembg on failure.
    If the archive blob already exists for item_id (e.g. a retry after a
    connection-drop), segmentation is skipped and the existing URL is returned.
    Returns {id, imageUrl}.
    """
    logger.info("process-image: received request")

    image_bytes: Optional[bytes] = None
    filename = f"{uuid.uuid4()}.png"
    provided_item_id: Optional[str] = None

    content_type = request.headers.get("content-type", "")
    if "multipart/form-data" in content_type:
        form = await request.form()
        file = form.get("image")
        if file and hasattr(file, "read"):
            image_bytes = await file.read()
            filename = getattr(file, "filename", filename) or filename
        item_id_field = form.get("item_id")
        if item_id_field and isinstance(item_id_field, str):
            provided_item_id = item_id_field.strip() or None
    else:
        image_bytes = await request.body()

    if not image_bytes:
        raise HTTPException(status_code=400, detail="No image provided.")

    # Determine item id upfront so we can check for an existing archive blob.
    if provided_item_id:
        item_id = provided_item_id
    else:
        base = filename.rsplit(".", 1)[0] if "." in filename else filename
        item_id = f"{base}-{uuid.uuid4().hex[:8]}"
    output_blob_name = f"{item_id}-transparent.webp"

    # ── Check if the archive blob already exists (previous run completed but
    # .NET was disconnected before it could read the response).  Skip
    # segmentation entirely and return the existing URL so we don't waste a
    # Modal cold-start on a retry.
    from azure.storage.blob import BlobClient
    from azure.core.exceptions import ResourceNotFoundError
    blob_service = _get_blob_service()
    archive_container = _get_env("ARCHIVE_CONTAINER_NAME")
    archive_blob: BlobClient = blob_service.get_blob_client(
        container=archive_container, blob=output_blob_name
    )
    try:
        archive_blob.get_blob_properties()
        logger.info("process-image: archive blob already exists for %s, skipping segmentation", item_id)
        return {"id": item_id, "imageUrl": archive_blob.url, "mediaType": "image/webp"}
    except ResourceNotFoundError:
        pass  # blob doesn't exist yet — proceed with segmentation

    # Attempt Modal BiRefNet first; fall back to rembg on any error.
    # Both functions are CPU/network-bound — run in a thread pool so the asyncio
    # event loop is never blocked (blocking loop causes gRPC heartbeat misses and
    # the Functions host kills the Python worker mid-request).
    try:
        transparent_png = await asyncio.to_thread(_segment_with_modal, image_bytes)
        logger.info("process-image: Modal BiRefNet segmentation succeeded")
    except Exception as modal_ex:
        logger.warning(
            "process-image: Modal segmentation failed (%s); falling back to rembg",
            modal_ex,
        )
        try:
            transparent_png = await asyncio.to_thread(_remove_background, image_bytes)
        except Exception as ex:
            logger.exception("Background removal failed: %s", ex)
            raise HTTPException(status_code=500, detail=f"Failed to process image: {ex}")

    # Convert transparent RGBA image to lossy WebP with alpha (q=85, method=6).
    # Pillow 10+ encodes WebP with alpha when the source is RGBA.
    # method=6 gives maximum compression ratio with acceptable CPU overhead.
    try:
        with Image.open(io.BytesIO(transparent_png)) as rgba_img:
            webp_buf = io.BytesIO()
            rgba_img.save(webp_buf, format="WEBP", quality=85, method=6)
            transparent_webp = webp_buf.getvalue()
    except Exception as ex:
        logger.exception("WebP conversion failed for item %s: %s", item_id, ex)
        raise HTTPException(status_code=500, detail=f"WebP conversion failed: {ex}")

    try:
        archive_blob.upload_blob(transparent_webp, overwrite=True, content_type="image/webp")
        archive_url = archive_blob.url
    except Exception as ex:
        logger.exception("Blob upload failed: %s", ex)
        raise HTTPException(status_code=500, detail=f"Failed to upload image: {ex}")

    logger.info("process-image: item %s → %s (WebP, %d bytes)", item_id, archive_url, len(transparent_webp))
    return {"id": item_id, "imageUrl": archive_url, "mediaType": "image/webp"}


# ── Chat endpoint (SSE streaming) ─────────────────────────────────────────────

class ChatRequest(BaseModel):
    message: str
    recentMessages: list[dict] = []
    selectedItemIds: Optional[list[str]] = None


@fastapi_app.post("/api/chat")
async def chat(body: ChatRequest, user_id: str = Depends(get_user_id)):
    """
    Stream the stylist agent's response as Server-Sent Events.

    Event shapes (each line: data: <json>\\n\\n):
      {"type": "token",       "content": "..."}
      {"type": "tool_use",    "name": "..."}
      {"type": "tool_result", "name": "...", "summary": "..."}
      {"type": "memory_update", "updated": bool}
      {"type": "done"}
    """
    memory = await load_memory(user_id)

    async def event_stream():
        collected_tokens: list[str] = []

        async for sse_line in stream_stylist_response(
            user_id=user_id,
            user_message=body.message,
            recent_messages=body.recentMessages,
            memory_summary=memory.summary,
            selected_item_ids=body.selectedItemIds,
        ):
            if '"type": "token"' in sse_line:
                try:
                    data = json.loads(sse_line.removeprefix("data: ").strip())
                    collected_tokens.append(data.get("content", ""))
                except Exception:
                    pass
            yield sse_line

        # After stream ends: maybe update memory summary
        if collected_tokens:
            assistant_reply = "".join(collected_tokens)
            updated_messages = [
                *body.recentMessages,
                {"role": "user", "content": body.message},
                {"role": "assistant", "content": assistant_reply},
            ]
            new_summary = await maybe_summarize(user_id, updated_messages, memory.summary)
            yield f"data: {json.dumps({'type': 'memory_update', 'updated': new_summary is not None})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ── Memory (conversation summary) endpoints ──────────────────────────────────

@fastapi_app.get("/api/chat/memory")
async def get_memory(user_id: str = Depends(get_user_id)):
    """Return the user's current conversation memory summary (user-editable)."""
    memory = await load_memory(user_id)
    return {"summary": memory.summary, "updatedAt": memory.updated_at}


class MemoryUpdateRequest(BaseModel):
    summary: str


@fastapi_app.put("/api/chat/memory")
async def update_memory(body: MemoryUpdateRequest, user_id: str = Depends(get_user_id)):
    """Allow the user to edit their conversation memory summary."""
    if len(body.summary) > 2000:
        raise HTTPException(status_code=400, detail="Summary must be 2000 characters or fewer.")
    await save_memory(user_id, body.summary.strip())
    return {"status": "updated"}


# ── Digest results endpoint ───────────────────────────────────────────────────

@fastapi_app.post("/api/digest/run")
async def run_digest_now(user_id: str = Depends(get_user_id), force: bool = True):
    """Manually trigger digest generation for the authenticated user.
    Useful for local dev/testing — production relies on the Monday timer trigger.
    Defaults to force=True to bypass the wardrobe-unchanged hash guard.
    Pass ?force=false to respect the hash guard.
    """
    import asyncio
    from agents.digest_agent import run_digest_for_user
    try:
        result = await asyncio.get_event_loop().run_in_executor(
            None, run_digest_for_user, user_id, force
        )
        if result is None:
            return {"status": "skipped", "reason": "opted out of recommendations or no wardrobe items"}
        for key in ["_rid", "_self", "_etag", "_attachments", "_ts"]:
            result.pop(key, None)
        return {"status": "ok", "digest": result}
    except Exception as exc:
        logger.exception("Manual digest run failed for user %s: %s", user_id, exc)
        raise HTTPException(status_code=500, detail="Could not run digest.")


@fastapi_app.get("/api/digest/latest")
async def get_latest_digest(user_id: str = Depends(get_user_id)):
    """Return the most recently generated wardrobe digest for the user."""
    from agents.db import get_digests_container
    try:
        container = get_digests_container()
        results = []
        async for item in container.query_items(
            query=(
                "SELECT * FROM c WHERE c.userId = @userId "
                "ORDER BY c.generatedAt DESC OFFSET 0 LIMIT 1"
            ),
            parameters=[{"name": "@userId", "value": user_id}],
        ):
            results.append(item)

        if not results:
            return {"digest": None}

        digest = results[0]
        for key in ["_rid", "_self", "_etag", "_attachments", "_ts"]:
            digest.pop(key, None)
        return {"digest": digest}
    except Exception as exc:
        logger.exception("Failed to load digest for user %s: %s", user_id, exc)
        raise HTTPException(status_code=500, detail="Could not load digest.")


@fastapi_app.get("/api/insights/vault")
async def get_vault_insights(
    user_id: str = Depends(get_user_id),
    windowDays: int = 90,
    targetCpw: float = 100.0,
):
    """Return deterministic behavior + CPW insights for the vault surface."""
    from agents.vault_insights import compute_vault_insights
    try:
        result = await compute_vault_insights(
            user_id=user_id,
            window_days=windowDays,
            target_cpw=targetCpw,
        )
        return result
    except Exception as exc:
        logger.exception("Failed to compute vault insights for user %s: %s", user_id, exc)
        raise HTTPException(status_code=500, detail="Could not compute vault insights.")


class DigestFeedbackRequest(BaseModel):
    digestId: str
    suggestionIndex: int
    suggestionDescription: str = ""
    signal: str  # "up" | "down"


@fastapi_app.get("/api/digest/feedback")
async def get_digest_feedback(
    digestId: str,
    user_id: str = Depends(get_user_id),
):
    """Return all feedback the user has already given for a specific digest.
    Used by the UI to restore thumbs state when the panel is reopened.
    """
    from agents.db import get_digest_feedback_container
    container = get_digest_feedback_container()
    results = []
    try:
        async for item in container.query_items(
            query=(
                "SELECT c.suggestionIndex, c.signal FROM c "
                "WHERE c.userId = @userId AND c.digestId = @digestId"
            ),
            parameters=[
                {"name": "@userId",   "value": user_id},
                {"name": "@digestId", "value": digestId},
            ],
        ):
            results.append(item)
    except Exception as exc:
        logger.exception("Failed to load digest feedback: %s", exc)
        raise HTTPException(status_code=500, detail="Could not load feedback.")
    return {"feedback": results}


@fastapi_app.post("/api/digest/feedback")
async def post_digest_feedback(
    body: DigestFeedbackRequest,
    user_id: str = Depends(get_user_id),
):
    """
    Record thumbs-up or thumbs-down feedback on a single digest suggestion.
    Feedback is stored in the DigestFeedback container (90-day TTL) and is
    injected into the next digest run to personalise suggestions.
    """
    if body.signal not in ("up", "down"):
        raise HTTPException(status_code=400, detail="signal must be 'up' or 'down'.")

    from agents.db import get_digest_feedback_container
    container = get_digest_feedback_container()

    doc_id = f"{user_id}-{body.digestId}-{body.suggestionIndex}"
    doc = {
        "id": doc_id,
        "userId": user_id,
        "digestId": body.digestId,
        "suggestionIndex": body.suggestionIndex,
        "suggestionDescription": body.suggestionDescription,
        "signal": body.signal,
        "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    try:
        await container.upsert_item(doc)
    except Exception as exc:
        logger.exception("Failed to save digest feedback: %s", exc)
        raise HTTPException(status_code=500, detail="Could not save feedback.")

    return {"status": "ok"}


# ── Moods endpoints ───────────────────────────────────────────────────────────

_MOOD_LIST_LIMIT = 50
_COSMOS_INTERNAL_KEYS = ["_rid", "_self", "_etag", "_attachments", "_ts"]


class SeedMoodsRequest(BaseModel):
    months_back: int = 3


@fastapi_app.post("/api/moods/seed")
async def seed_moods(body: SeedMoodsRequest = SeedMoodsRequest()):
    """
    One-time sitemap seeder — populates the Moods container from publication
    sitemaps. Invoke manually; safe to call repeatedly (upserts by mood ID).

    Body (optional): {"months_back": 3}  — clamped 1–12
    """
    months_back = max(1, min(body.months_back, 12))
    logger.info("seed_moods: starting (months_back=%d).", months_back)
    try:
        from agents.sitemap_seeder import run_sitemap_seeder
        import asyncio
        result = await asyncio.get_event_loop().run_in_executor(
            None, lambda: run_sitemap_seeder(months_back=months_back)
        )
        return result
    except Exception as exc:
        logger.exception("Sitemap seeder failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@fastapi_app.get("/api/moods")
async def list_moods(primaryMood: Optional[str] = None):
    """
    List all fashion trend moods, optionally filtered by primaryMood category.
    Results are ordered by trendScore (most-mentioned first).

    Query params:
      primaryMood — optional filter, must be one of the known primary mood categories.
    """
    from agents.db import get_moods_container
    container = get_moods_container()

    if primaryMood is not None and primaryMood not in PRIMARY_MOODS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown primaryMood '{primaryMood}'. Valid values: {', '.join(PRIMARY_MOODS)}",
        )

    try:
        if primaryMood:
            query = (
                "SELECT * FROM c WHERE c.primaryMood = @primaryMood "
                "ORDER BY c.trendScore DESC OFFSET 0 LIMIT @limit"
            )
            parameters = [
                {"name": "@primaryMood", "value": primaryMood},
                {"name": "@limit",       "value": _MOOD_LIST_LIMIT},
            ]
        else:
            query = (
                "SELECT * FROM c ORDER BY c.trendScore DESC OFFSET 0 LIMIT @limit"
            )
            parameters = [{"name": "@limit", "value": _MOOD_LIST_LIMIT}]

        moods = []
        async for item in container.query_items(query=query, parameters=parameters):
            for key in _COSMOS_INTERNAL_KEYS:
                item.pop(key, None)
            moods.append(item)

        return {"moods": moods, "primaryMoods": PRIMARY_MOODS}
    except Exception as exc:
        logger.exception("Failed to list moods: %s", exc)
        raise HTTPException(status_code=500, detail="Could not load moods.")


@fastapi_app.get("/api/moods/{mood_id}")
async def get_mood(mood_id: str):
    """Return a single mood document by its ID."""
    from agents.db import get_moods_container
    container = get_moods_container()

    try:
        # mood_id format: "<primaryMood_lower>-<slug>", e.g. "minimalist-quiet-luxury"
        # Extract the primaryMood prefix by matching against the known vocabulary.
        parts = mood_id.split("-")
        if len(parts) < 2:
            raise HTTPException(status_code=404, detail="Mood not found.")

        # Try progressively longer prefixes to handle multi-word primary moods
        partition_key = None
        for n in range(1, len(parts)):
            candidate = "-".join(parts[:n])
            match = next((m for m in PRIMARY_MOODS if m.lower() == candidate), None)
            if match:
                partition_key = match
                break

        if partition_key is None:
            raise HTTPException(status_code=404, detail="Mood not found.")

        item = await container.read_item(item=mood_id, partition_key=partition_key)
        for key in _COSMOS_INTERNAL_KEYS:
            item.pop(key, None)
        return item
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to load mood %s: %s", mood_id, exc)
        raise HTTPException(status_code=404, detail="Mood not found.")


# ── Scraper security helpers ──────────────────────────────────────────────────

import ipaddress
import socket
from urllib.parse import urlparse

# Private / reserved ranges that must never be fetched (SSRF prevention).
_BLOCKED_NETWORKS = [
    ipaddress.ip_network(r) for r in [
        "0.0.0.0/8",          # "This" network
        "10.0.0.0/8",         # Private
        "100.64.0.0/10",      # Shared address space
        "127.0.0.0/8",        # Loopback
        "169.254.0.0/16",     # Link-local / Azure IMDS
        "172.16.0.0/12",      # Private
        "192.168.0.0/16",     # Private
        "198.18.0.0/15",      # Benchmarking
        "198.51.100.0/24",    # Documentation
        "203.0.113.0/24",     # Documentation
        "224.0.0.0/4",        # Multicast
        "240.0.0.0/4",        # Reserved
        "::1/128",            # IPv6 loopback
        "fc00::/7",           # IPv6 unique local
        "fe80::/10",          # IPv6 link-local
    ]
]


def _validate_scraper_url(url: str) -> None:
    """
    Raise HTTPException(400) if *url* is not a safe public HTTPS URL.

    Checks:
      1. Must use the https scheme.
      2. Must have a non-empty public hostname (no bare IPs).
      3. DNS resolution must not point to any private/reserved IP range.
         This also defeats DNS-rebinding: we resolve before connecting.

    Raises HTTPException(400) on any violation so the caller never reaches
    the HTTP fetch stage with an unsafe URL.
    """
    try:
        parsed = urlparse(url)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid URL.")

    if parsed.scheme != "https":
        raise HTTPException(status_code=400, detail="URL must use HTTPS.")

    hostname = parsed.hostname
    if not hostname:
        raise HTTPException(status_code=400, detail="URL must have a hostname.")

    # Reject bare IP literals — hostnames only
    try:
        ipaddress.ip_address(hostname)
        raise HTTPException(status_code=400, detail="IP-literal URLs are not permitted.")
    except ValueError:
        pass

    # Resolve DNS and check every returned address against blocked ranges
    try:
        resolved = socket.getaddrinfo(hostname, None)
    except socket.gaierror:
        raise HTTPException(status_code=400, detail="Could not resolve hostname.")

    for *_, sockaddr in resolved:
        addr_str = sockaddr[0]
        try:
            ip = ipaddress.ip_address(addr_str)
        except ValueError:
            continue
        for net in _BLOCKED_NETWORKS:
            if ip in net:
                raise HTTPException(
                    status_code=400,
                    detail="URL resolves to a private or reserved address.",
                )


def _require_admin(user_id: str = Depends(get_user_id)) -> str:
    """
    FastAPI dependency that restricts an endpoint to admin users only.

    Admin user IDs are configured via the ADMIN_USER_IDS environment variable
    as a comma-separated list.  Returns the user_id if authorised.
    """
    raw = os.getenv("ADMIN_USER_IDS", "")
    admin_ids = {uid.strip() for uid in raw.split(",") if uid.strip()}
    if not admin_ids or user_id not in admin_ids:
        raise HTTPException(status_code=403, detail="Admin access required.")
    return user_id


# ── Scraper endpoints ─────────────────────────────────────────────────────────

class SuggestSourceRequest(BaseModel):
    name: str           # Human-readable name, e.g. "Zara"
    url: str
    source_type: str = "brand_site"


class SubscribeRequest(BaseModel):
    pass  # source_id comes from path param


@fastapi_app.get("/api/scraper/sources")
async def list_scraper_sources(user_id: str = Depends(get_user_id)):
    """List all active scraper sources (global + user-created)."""
    from agents.db import get_scraper_sources_container, get_user_source_subscriptions_container

    sources_container = get_scraper_sources_container()
    subs_container = get_user_source_subscriptions_container()

    try:
        sources = []
        async for doc in sources_container.query_items(
            query="SELECT c.id, c.name, c.sourceType, c.isGlobal, c.lastScrapedAt FROM c WHERE c.isActive = true",
            enable_cross_partition_query=True,
        ):
            for key in _COSMOS_INTERNAL_KEYS:
                doc.pop(key, None)
            sources.append(doc)

        # Load user's subscriptions to annotate each source
        subscribed_ids: set[str] = set()
        async for sub in subs_container.query_items(
            query="SELECT c.sourceId FROM c WHERE c.userId = @uid AND c.isActive = true",
            parameters=[{"name": "@uid", "value": user_id}],
        ):
            subscribed_ids.add(sub["sourceId"])

        for source in sources:
            source["subscribed"] = source["id"] in subscribed_ids

        return {"sources": sources}
    except Exception as exc:
        logger.exception("list_scraper_sources failed: %s", exc)
        raise HTTPException(status_code=500, detail="Could not load sources.")


@fastapi_app.post("/api/scraper/sources", status_code=201)
async def suggest_scraper_source(
    body: SuggestSourceRequest,
    user_id: str = Depends(get_user_id),
):
    """
    Suggest a new brand site as a scraper source.
    Triggers one-time LLM CSS selector config generation, then stores the source.
    Only public HTTPS URLs are accepted — private/internal addresses are rejected.
    """
    from agents.db import get_scraper_sources_container
    from agents.scrapers.config_generator import generate_selector_config
    import re

    _validate_scraper_url(body.url)  # raises 400 for unsafe URLs

    source_id = "brand-" + re.sub(r"[^a-z0-9]+", "-", body.name.lower()).strip("-")

    try:
        config = await asyncio.get_event_loop().run_in_executor(
            None, lambda: generate_selector_config(body.url, body.name)
        )
    except Exception as exc:
        logger.exception("Config generation failed for %s: %s", body.url, exc)
        raise HTTPException(status_code=500, detail="Could not generate scraper config.")

    now = datetime.now(timezone.utc).isoformat()
    source_doc = {
        "id": source_id,
        "sourceType": body.source_type,
        "name": body.name,
        "config": config,
        "isGlobal": False,
        "isActive": True,
        "createdAt": now,
        "lastScrapedAt": None,
        "createdBy": user_id,
    }

    container = get_scraper_sources_container()
    try:
        await container.upsert_item(source_doc)
    except Exception as exc:
        logger.exception("Could not save source %s: %s", source_id, exc)
        raise HTTPException(status_code=500, detail="Could not save source.")

    return {"sourceId": source_id, "name": body.name, "config": config}


@fastapi_app.post("/api/scraper/subscribe/{source_id}", status_code=201)
async def subscribe_to_source(
    source_id: str,
    user_id: str = Depends(get_user_id),
):
    """Subscribe the current user to a scraper source."""
    from agents.db import get_user_source_subscriptions_container

    now = datetime.now(timezone.utc).isoformat()
    sub_doc = {
        "id": f"{user_id}-{source_id}",
        "userId": user_id,
        "sourceId": source_id,
        "subscribedAt": now,
        "isActive": True,
    }

    container = get_user_source_subscriptions_container()
    try:
        await container.upsert_item(sub_doc)
    except Exception as exc:
        logger.exception("subscribe_to_source failed: %s", exc)
        raise HTTPException(status_code=500, detail="Could not subscribe.")

    # Kick off an on-demand scrape in the background
    async def _bg_scrape():
        try:
            await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: __import__(
                    "agents.scraper_runner", fromlist=["run_for_source"]
                ).run_for_source(source_id),
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Background scrape for %s failed: %s", source_id, exc)

    asyncio.create_task(_bg_scrape())

    return {"sourceId": source_id, "subscribed": True}


@fastapi_app.delete("/api/scraper/subscribe/{source_id}")
async def unsubscribe_from_source(
    source_id: str,
    user_id: str = Depends(get_user_id),
):
    """Unsubscribe the current user from a scraper source."""
    from agents.db import get_user_source_subscriptions_container

    container = get_user_source_subscriptions_container()
    sub_id = f"{user_id}-{source_id}"
    try:
        sub = await container.read_item(item=sub_id, partition_key=user_id)
        sub["isActive"] = False
        await container.upsert_item(sub)
    except Exception as exc:
        logger.exception("unsubscribe_from_source failed: %s", exc)
        raise HTTPException(status_code=500, detail="Could not unsubscribe.")

    return {"sourceId": source_id, "subscribed": False}


@fastapi_app.post("/api/scraper/run/{source_id}")
async def run_scraper_source(
    source_id: str,
    _: str = Depends(_require_admin),
):
    """Manually trigger a scrape for a single source. Requires admin access."""
    try:
        count = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: __import__(
                "agents.scraper_runner", fromlist=["run_for_source"]
            ).run_for_source(source_id),
        )
        return {"sourceId": source_id, "newItems": count}
    except Exception as exc:
        logger.exception("Manual scrape for %s failed: %s", source_id, exc)
        raise HTTPException(status_code=500, detail="Scrape failed.")


# ── Taste calibration endpoints ───────────────────────────────────────────────

class QuizResponse(BaseModel):
    signal: str                         # "up" | "down"
    cardPrimaryMood: Optional[str] = None   # Phase 1
    scrapedItemId: Optional[str] = None     # Phase 2


@fastapi_app.get("/api/taste/quiz")
async def get_taste_quiz(user_id: str = Depends(get_user_id)):
    """Get (or create) the active taste quiz session for the current user."""
    try:
        session = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: __import__(
                "agents.taste_calibration", fromlist=["get_or_create_quiz_session"]
            ).get_or_create_quiz_session(user_id),
        )
        for key in _COSMOS_INTERNAL_KEYS:
            session.pop(key, None)
        return session
    except Exception as exc:
        logger.exception("get_taste_quiz failed: %s", exc)
        raise HTTPException(status_code=500, detail="Could not load quiz.")


@fastapi_app.post("/api/taste/quiz/{session_id}/respond")
async def record_quiz_response(
    session_id: str,
    body: QuizResponse,
    user_id: str = Depends(get_user_id),
):
    """Record a thumbs-up or thumbs-down response in the quiz session."""
    if body.signal not in ("up", "down"):
        raise HTTPException(status_code=400, detail="signal must be 'up' or 'down'")

    response_dict = body.model_dump(exclude_none=True)
    try:
        session = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: __import__(
                "agents.taste_calibration", fromlist=["record_response"]
            ).record_response(user_id, session_id, response_dict),
        )
        return {
            "sessionId": session_id,
            "responsesRecorded": len(session.get("responses", [])),
            "targetResponses": session.get("targetResponses", 0),
        }
    except Exception as exc:
        logger.exception("record_quiz_response failed: %s", exc)
        raise HTTPException(status_code=500, detail="Could not record response.")


@fastapi_app.post("/api/taste/quiz/{session_id}/complete")
async def complete_taste_quiz(
    session_id: str,
    user_id: str = Depends(get_user_id),
):
    """Finalise the quiz session and update the user's style profile."""
    try:
        inferred = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: __import__(
                "agents.taste_calibration", fromlist=["complete_quiz"]
            ).complete_quiz(user_id, session_id),
        )
        return {"sessionId": session_id, "inferredTastes": inferred}
    except Exception as exc:
        logger.exception("complete_taste_quiz failed: %s", exc)
        raise HTTPException(status_code=500, detail="Could not complete quiz.")
