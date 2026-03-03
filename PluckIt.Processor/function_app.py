"""
PluckIt Python Processor — Azure Functions v2 with FastAPI ASGI.

HTTP routes are handled by FastAPI (enabling true SSE streaming).
Non-HTTP triggers (blob, timer) remain as AsgiFunctionApp decorators.

Endpoints:
  POST /api/process-image       — background removal (existing, now FastAPI)
  POST /api/chat                — SSE streaming stylist agent chat
  GET  /api/chat/memory         — retrieve user's conversation memory summary
  PUT  /api/chat/memory         — update user's conversation memory summary
  GET  /api/digest/latest       — most recent wardrobe digest suggestions
  POST /api/digest/run          — manually trigger digest generation (dev/testing)
  GET  /api/digest/feedback     — fetch feedback already given for a digest
  POST /api/digest/feedback     — record thumbs-up/down on a digest suggestion
  GET  /api/moods               — list all fashion trend moods (filter: ?primaryMood=)
  GET  /api/moods/{mood_id}     — get a single mood by ID
  POST /api/moods/seed          — one-time sitemap seeder (admin)
  GET  /api/health              — processor health check
"""

import io
import json
import logging
import os
import uuid
from datetime import datetime
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


# ── Blob trigger: background removal on upload ───────────────────────────────

@app.function_name(name="PluckItBlobProcessor")
@app.blob_trigger(
    arg_name="input_blob",
    path="%UPLOADS_CONTAINER_NAME%/{name}",
    connection="AzureWebJobsStorage",
)
def pluck_it_blob_processor(input_blob: func.InputStream) -> None:
    logger.info("PluckItBlobProcessor: %s (%d bytes)", input_blob.name, input_blob.length)
    blob_bytes = input_blob.read()

    try:
        transparent_png = _remove_background(blob_bytes)
    except Exception as ex:
        logger.exception("Background removal failed: %s", ex)
        return

    archive_container_name = _get_env("ARCHIVE_CONTAINER_NAME")
    blob_service = _get_blob_service()
    original_name = input_blob.name.split("/")[-1]
    base = original_name.rsplit(".", 1)[0] if "." in original_name else original_name
    output_blob_name = f"{base}-transparent.png"

    from azure.storage.blob import BlobClient
    archive_blob: BlobClient = blob_service.get_blob_client(
        container=archive_container_name, blob=output_blob_name
    )
    archive_blob.upload_blob(transparent_png, overwrite=True, content_type="image/png")
    archive_url = archive_blob.url

    try:
        img = Image.open(io.BytesIO(transparent_png))
        tags = _infer_basic_tags(img)
    except Exception:
        tags = {"color": "unknown", "category": "unknown"}

    from azure.cosmos import CosmosClient, PartitionKey
    cosmos = CosmosClient(
        url=_get_env("COSMOS_DB_ENDPOINT"),
        credential=_get_env("COSMOS_DB_KEY"),
    )
    db = cosmos.get_database_client(_get_env("COSMOS_DB_DATABASE", "PluckIt"))
    container = db.create_container_if_not_exists(
        id=_get_env("COSMOS_DB_CONTAINER", "Wardrobe"),
        partition_key=PartitionKey(path="/userId"),
    )
    container.upsert_item({
        "id": base,
        "imageUrl": archive_url,
        "tags": [tags.get("color"), tags.get("category")],
        "brand": None,
        "category": tags.get("category"),
        "dateAdded": (
            input_blob.properties.get("last_modified").isoformat()
            if hasattr(input_blob, "properties") and input_blob.properties.get("last_modified")
            else None
        ),
    })
    logger.info("PluckItBlobProcessor: wrote %s → %s", base, archive_url)


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


# ── FastAPI routes ────────────────────────────────────────────────────────────

@fastapi_app.get("/api/health")
async def health():
    return {"status": "ok", "service": "pluckit-processor"}


# ── Process image ─────────────────────────────────────────────────────────────

@fastapi_app.post("/api/process-image", status_code=201)
async def process_image(request: Request):
    """
    Accept an image as multipart/form-data (field 'image') or raw bytes.
    Remove background, archive to blob storage, return {id, imageUrl}.
    """
    logger.info("process-image: received request")

    image_bytes: Optional[bytes] = None
    filename = f"{uuid.uuid4()}.png"

    content_type = request.headers.get("content-type", "")
    if "multipart/form-data" in content_type:
        form = await request.form()
        file = form.get("image")
        if file and hasattr(file, "read"):
            image_bytes = await file.read()
            filename = getattr(file, "filename", filename) or filename
    else:
        image_bytes = await request.body()

    if not image_bytes:
        raise HTTPException(status_code=400, detail="No image provided.")

    try:
        transparent_png = _remove_background(image_bytes)
    except Exception as ex:
        logger.exception("Background removal failed: %s", ex)
        raise HTTPException(status_code=500, detail=f"Failed to process image: {ex}")

    base = filename.rsplit(".", 1)[0] if "." in filename else filename
    item_id = f"{base}-{uuid.uuid4().hex[:8]}"
    output_blob_name = f"{item_id}-transparent.png"

    try:
        from azure.storage.blob import BlobClient
        blob_service = _get_blob_service()
        archive_container = _get_env("ARCHIVE_CONTAINER_NAME")
        archive_blob: BlobClient = blob_service.get_blob_client(
            container=archive_container, blob=output_blob_name
        )
        archive_blob.upload_blob(transparent_png, overwrite=True, content_type="image/png")
        archive_url = archive_blob.url
    except Exception as ex:
        logger.exception("Blob upload failed: %s", ex)
        raise HTTPException(status_code=500, detail=f"Failed to upload image: {ex}")

    logger.info("process-image: item %s → %s", item_id, archive_url)
    return {"id": item_id, "imageUrl": archive_url}


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
        raise HTTPException(status_code=500, detail=str(exc))


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
        "createdAt": datetime.utcnow().isoformat() + "Z",
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


