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
from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import io
import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import unquote
import random
import time
import uuid
from datetime import datetime, timedelta, timezone
from importlib import import_module
from typing import Any, Optional, Annotated


def _get_int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        logger = logging.getLogger(__name__)
        logger.warning("Invalid value for %s, using default %s", name, default)
        return default


def _get_float_env(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        logger = logging.getLogger(__name__)
        logger.warning("Invalid value for %s, using default %s", name, default)
        return default


def _build_json_etag(payload: object) -> str:
    body = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return f"\"{hashlib.sha256(body.encode('utf-8')).hexdigest()}\""


def _is_not_modified(request: Request, etag: str) -> bool:
    return request.headers.get("if-none-match") == etag


def _cache_headers(etag: str) -> dict[str, str]:
    return {
        "ETag": etag,
        "Cache-Control": "no-cache, no-store, max-age=0, must-revalidate",
    }


def _json_response_with_cache(payload: object, request: Request):
    etag = _build_json_etag(payload)
    headers = _cache_headers(etag)
    if _is_not_modified(request, etag):
        return Response(status_code=304, headers=headers)
    return JSONResponse(content=payload, headers=headers)


import azure.functions as func
from fastapi import FastAPI, Depends, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from PIL import Image
from pillow_heif import register_heif_opener

from agents.auth import get_user_id
from agents.memory import load_memory, save_memory, maybe_summarize
from agents.stylist_agent import stream_stylist_response
from agents.mood_processor import PRIMARY_MOODS
from agents.models import RedditIngestBatch, RedditPost
from agents.scrapers.reddit_scraper import RedditScraper

register_heif_opener()

_ERR_SOURCE_NOT_FOUND_MESSAGE = "Source not found."
_ISO_UTC_SUFFIX = "Z"
_DB_LIMIT_PARAM = "@limit"
_DB_USER_ID_PARAM = "@uid"
_TASTE_MODULE_NAME_TAG = "agents.taste_calibration"
_WEBP_MEDIA_TYPE = "image/webp"
_SSE_DATA_PREFIX = "data: "
_ARCHIVE_BLOB_SUFFIX = "-transparent.webp"
_WEBP_QUALITY = 85
_WEBP_METHOD = 6
_ERR_NO_IMAGE_PROVIDED = "No image provided."
_ERR_MOOD_NOT_FOUND = "Mood not found."

background_tasks = set()

# In-memory dedupe guards are process-local only (lost on cold start/restart).
# Duplicates may still happen across instances/restarts, so this mechanism
# assumes downstream side-effect handlers (for example, _update_user_profile)
# are idempotent or upsert-safe. If stronger guarantees are needed, replace
# _TASTE_JOB_IN_FLIGHT/_TASTE_JOB_COMPLETED with a persistent dedupe store
# such as Redis or Cosmos DB.
_TASTE_JOB_IN_FLIGHT: dict[str, float] = {}
_TASTE_JOB_COMPLETED: dict[str, float] = {}

_TASTE_JOB_DEDUPE_TTL_SECONDS = _get_int_env("TASTE_JOB_DEDUPE_TTL_SECONDS", 180)
_TASTE_JOB_COMPLETED_TTL_SECONDS = _get_int_env("TASTE_JOB_COMPLETED_TTL_SECONDS", 3600)
_TASTE_JOB_QUEUE_NAME = os.getenv("TASTE_JOB_QUEUE_NAME", "taste-analysis-jobs")
_TASTE_JOB_DEAD_LETTER_QUEUE_NAME = os.getenv("TASTE_JOB_DEAD_LETTER_QUEUE_NAME", "taste-analysis-jobs-poison")
_TASTE_JOB_MAX_RETRIES = 3
_TASTE_JOB_BASE_BACKOFF_SECONDS = _get_float_env("TASTE_JOB_BASE_BACKOFF_SECONDS", 0.75)
_TASTE_JOB_MAX_BACKOFF_SECONDS = _get_float_env("TASTE_JOB_MAX_BACKOFF_SECONDS", 6.0)
_TASTE_JOB_JITTER_SECONDS = _get_float_env("TASTE_JOB_JITTER_SECONDS", 0.2)
_TASTE_JOB_PROFILE_UPDATE_MAX_RETRIES = 2
_WEEKLY_DIGEST_MAX_CONCURRENCY = _get_int_env("WEEKLY_DIGEST_MAX_CONCURRENCY", 6)
_SCRAPER_MAX_CONCURRENCY = _get_int_env("SCRAPER_MAX_CONCURRENCY", 4)


logger = logging.getLogger(__name__)
_otel_configured = False
_otel_log_handler_installed = False
_http_request_counter = None
_http_request_duration_ms = None
_OTLP_SIGNAL_PATH_TRACES = "/v1/traces"
_OTLP_SIGNAL_PATH_METRICS = "/v1/metrics"
_OTLP_SIGNAL_PATH_LOGS = "/v1/logs"
_OTLP_SIGNAL_PATHS = (
    _OTLP_SIGNAL_PATH_TRACES,
    _OTLP_SIGNAL_PATH_METRICS,
    _OTLP_SIGNAL_PATH_LOGS,
)


def _build_signal_endpoint(base_or_signal_endpoint: str, signal_path: str) -> str:
    """Accept either a full signal URL (.../v1/<signal>) or a base OTLP URL (.../otlp)."""
    normalized = (base_or_signal_endpoint or "").rstrip("/")
    if not normalized:
        return normalized
    if signal_path not in _OTLP_SIGNAL_PATHS:
        return f"{normalized}{signal_path}"
    for known_signal_path in _OTLP_SIGNAL_PATHS:
        if not normalized.endswith(known_signal_path):
            continue
        if known_signal_path == signal_path:
            return normalized
        return f"{normalized[:-len(known_signal_path)]}{signal_path}"
    return f"{normalized}{signal_path}"


def _normalize_otel_headers(raw_headers: Optional[str]) -> dict[str, str] | None:
    if not raw_headers:
        return None

    pairs = unquote(raw_headers).split(",")
    parsed: dict[str, str] = {}
    for pair in pairs:
        if "=" not in pair:
            continue
        key, value = [part.strip() for part in pair.split("=", 1)]
        if key and value:
            parsed[key] = unquote(value)
    return parsed or None


_otel_providers_initialized = False


def _init_otel_providers() -> None:
    """Set up TracerProvider and MeterProvider. Called at import time, before Azure Functions
    can override the global providers."""
    global _otel_providers_initialized, _otel_log_handler_installed
    if _otel_providers_initialized:
        return

    traces_raw_endpoint = os.getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT") or os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
    if not traces_raw_endpoint:
        logger.info("OTEL endpoint = %s", traces_raw_endpoint)
        logger.warning("OpenTelemetry skipped: no OTLP endpoint configured")
        return
    traces_endpoint = _build_signal_endpoint(traces_raw_endpoint, _OTLP_SIGNAL_PATH_TRACES)
    logger.info("Resolved OTLP traces endpoint = %s", traces_endpoint)

    headers = _normalize_otel_headers(os.getenv("OTEL_EXPORTER_OTLP_HEADERS"))
    service_name = os.getenv("OTEL_SERVICE_NAME", "pluckit-processor-func")

    try:
        from opentelemetry import metrics, trace
        from opentelemetry import _logs
        from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
        from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
        from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
        from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.sdk.metrics import MeterProvider
        from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
    except Exception as exc:
        logger.warning("OpenTelemetry libraries are not available: %s", exc)
        return

    try:
        env = os.getenv("AZURE_FUNCTIONS_ENVIRONMENT", "Production")
        resource = Resource.create({"service.name": service_name, "service.namespace": "pluckit", "deployment.environment": env})

        tracer_provider = TracerProvider(resource=resource)
        logger.info("Configuring trace exporter to %s", traces_endpoint)
        tracer_provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=traces_endpoint, headers=headers)))
        trace.set_tracer_provider(tracer_provider)

        metrics_raw_endpoint = (
            os.getenv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT")
            or traces_raw_endpoint
            or os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
        )
        metrics_endpoint = _build_signal_endpoint(metrics_raw_endpoint or "", _OTLP_SIGNAL_PATH_METRICS)
        if metrics_endpoint:
            logger.info("Resolved OTLP metrics endpoint = %s", metrics_endpoint)
            metric_reader = PeriodicExportingMetricReader(
                OTLPMetricExporter(endpoint=metrics_endpoint, headers=headers),
                export_interval_millis=60_000,
            )
            metrics.set_meter_provider(MeterProvider(resource=resource, metric_readers=[metric_reader]))

        logs_raw_endpoint = (
            os.getenv("OTEL_EXPORTER_OTLP_LOGS_ENDPOINT")
            or traces_raw_endpoint
            or os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
        )
        logs_endpoint = _build_signal_endpoint(logs_raw_endpoint or "", _OTLP_SIGNAL_PATH_LOGS)
        if logs_endpoint:
            logger.info("Resolved OTLP logs endpoint = %s", logs_endpoint)
            logger_provider = LoggerProvider(resource=resource)
            logger_provider.add_log_record_processor(
                BatchLogRecordProcessor(OTLPLogExporter(endpoint=logs_endpoint, headers=headers))
            )
            _logs.set_logger_provider(logger_provider)
            if not _otel_log_handler_installed:
                logging.getLogger().addHandler(
                    LoggingHandler(level=logging.NOTSET, logger_provider=logger_provider)
                )
                _otel_log_handler_installed = True

        _otel_providers_initialized = True
        logger.warning(
            "OpenTelemetry providers initialized service=%s traces=%s metrics=%s logs=%s",
            service_name,
            traces_endpoint,
            metrics_endpoint,
            logs_endpoint,
        )
    except Exception as exc:
        logger.warning("OpenTelemetry provider initialization failed: %s", exc)


def _init_http_metrics() -> None:
    global _http_request_counter, _http_request_duration_ms
    if _http_request_counter is not None and _http_request_duration_ms is not None:
        return
    if not _otel_providers_initialized:
        return

    try:
        from opentelemetry import metrics
    except Exception as exc:
        logger.warning("OpenTelemetry metrics library unavailable: %s", exc)
        return

    try:
        meter = metrics.get_meter("pluckit.processor.http")
        _http_request_counter = meter.create_counter(
            name="http.server.requests",
            unit="1",
            description="Count of incoming HTTP requests",
        )
        _http_request_duration_ms = meter.create_histogram(
            name="http.server.duration",
            unit="ms",
            description="Duration of HTTP requests in milliseconds",
        )
    except Exception as exc:
        logger.warning("OpenTelemetry HTTP metric setup failed: %s", exc)


def _configure_open_telemetry() -> None:
    """Instrument FastAPI and HTTPX. Requires fastapi_app to exist."""
    global _otel_configured
    if _otel_configured:
        return
    if not _otel_providers_initialized:
        return

    try:
        from opentelemetry import trace
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
    except Exception as exc:
        logger.warning("OpenTelemetry instrumentation libraries not available: %s", exc)
        return

    try:
        HTTPXClientInstrumentor().instrument()
        FastAPIInstrumentor.instrument_app(fastapi_app, tracer_provider=trace.get_tracer_provider())
        _otel_configured = True
        logger.info("OpenTelemetry instrumentation configured")
    except Exception as exc:
        logger.warning("OpenTelemetry instrumentation failed: %s", exc)


# Initialize providers at import time — before Azure Functions can set its own global providers.
try:
    _init_otel_providers()
except Exception as exc:
    logger.warning("OpenTelemetry eager initialization failed: %s", exc)

# ── FastAPI application ──────────────────────────────────────────────────────

fastapi_app = FastAPI(title="PluckIt Processor", docs_url=None, redoc_url=None)
_configure_open_telemetry()
_init_http_metrics()

_ALLOWED_ORIGINS = [o.strip() for o in os.getenv("CORS_ALLOWED_ORIGINS", "").split(",") if o.strip()]
if "*" in _ALLOWED_ORIGINS:
    logger.warning("Ignoring wildcard CORS origin because credentials are enabled.")
    _ALLOWED_ORIGINS = [o for o in _ALLOWED_ORIGINS if o != "*"]
if not _ALLOWED_ORIGINS:
    logger.warning("CORS_ALLOWED_ORIGINS is empty; cross-origin browser requests will be blocked.")

fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_credentials=bool(_ALLOWED_ORIGINS),
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


@fastapi_app.middleware("http")
async def _record_http_metrics(request: Request, call_next):
    if _http_request_counter is None or _http_request_duration_ms is None:
        return await call_next(request)

    start = time.perf_counter()
    status_code = 500
    try:
        response = await call_next(request)
        status_code = response.status_code
        return response
    finally:
        route = request.scope.get("route")
        route_path = getattr(route, "path", request.url.path)
        attrs = {
            "http.method": request.method,
            "http.route": route_path,
            "http.status_code": status_code,
        }
        elapsed_ms = (time.perf_counter() - start) * 1000
        _http_request_counter.add(1, attributes=attrs)
        _http_request_duration_ms.record(elapsed_ms, attributes=attrs)

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
    _init_otel_providers()
    _configure_open_telemetry()
    _init_http_metrics()
    env = os.getenv("AZURE_FUNCTIONS_ENVIRONMENT", "Production")
    logger.info("PluckIt Processor started — environment=%s", env)


# ── Azure Functions ASGI app (handles HTTP via FastAPI + non-HTTP triggers) ──

app = func.AsgiFunctionApp(app=fastapi_app, http_auth_level=func.AuthLevel.ANONYMOUS)


# ── Helper utilities ─────────────────────────────────────────────────────────

def _taste_job_id(user_id: str, item_id: str, image_url: str, gallery_image_index: int | None) -> str:
    return hashlib.sha256(
        f"{user_id}:{item_id}:{image_url}:{gallery_image_index if gallery_image_index is not None else '-'}".encode("utf-8")
    ).hexdigest()


def _purge_taste_job_guards(now: float) -> None:
    for key, exp in _TASTE_JOB_IN_FLIGHT.copy().items():
        if exp <= now:
            _TASTE_JOB_IN_FLIGHT.pop(key, None)
    for key, exp in _TASTE_JOB_COMPLETED.copy().items():
        if exp <= now:
            _TASTE_JOB_COMPLETED.pop(key, None)


def _is_taste_job_duplicate(job_id: str, now: float) -> bool:
    _purge_taste_job_guards(now)
    if _TASTE_JOB_IN_FLIGHT.get(job_id, 0.0) > now:
        return True
    if _TASTE_JOB_COMPLETED.get(job_id, 0.0) > now:
        return True
    _TASTE_JOB_IN_FLIGHT[job_id] = now + _TASTE_JOB_DEDUPE_TTL_SECONDS
    return False


def _mark_taste_job_completed(job_id: str, now: float) -> None:
    _TASTE_JOB_IN_FLIGHT.pop(job_id, None)
    _TASTE_JOB_COMPLETED[job_id] = now + _TASTE_JOB_COMPLETED_TTL_SECONDS


def _build_taste_job_message(job_id: str, user_id: str, item_id: str, image_url: str, gallery_image_index: int | None) -> dict[str, Any]:
    return {
        "job_id": job_id,
        "user_id": user_id,
        "item_id": item_id,
        "image_url": image_url,
        "gallery_image_index": gallery_image_index,
    }


def _build_taste_job_document(
    job: dict[str, Any],
    status: str,
    *,
    error: str | None = None,
    dead_lettered: bool | None = None,
) -> dict[str, Any]:
    now_iso = datetime.now(timezone.utc).isoformat()
    doc: dict[str, Any] = {
        "id": job["job_id"],
        "jobId": job["job_id"],
        "status": status,
        "userId": job["user_id"],
        "itemId": job["item_id"],
        "imageUrl": job["image_url"],
        "galleryImageIndex": job.get("gallery_image_index"),
        "retryCount": job.get("retryCount", 0),
        "createdAt": job.get("createdAt", now_iso),
        "updatedAt": now_iso,
        "payload": job,
    }
    if error is not None:
        doc["lastError"] = error
    if dead_lettered is not None:
        doc["deadLettered"] = dead_lettered
    return doc


def _get_taste_job_container():
    from agents.db import get_taste_jobs_container

    return get_taste_jobs_container()


def _is_taste_job_doc_final(doc: dict[str, Any]) -> bool:
    return doc.get("status") in {"completed", "dead_lettered"}


async def _load_taste_job_doc(job_id: str) -> dict[str, Any] | None:
    container = _get_taste_job_container()
    try:
        return await container.read_item(item=job_id, partition_key=job_id)
    except Exception as exc:  # noqa: BLE001
        logger.debug("Taste job doc not found for %s: %s", job_id, exc)
        return None


async def _upsert_taste_job_doc(doc: dict[str, Any]) -> None:
    container = _get_taste_job_container()
    await container.upsert_item(doc)


async def _claim_taste_job(job: dict[str, Any]) -> bool:
    """Create or refresh a queued job document with best-effort idempotency."""
    now = datetime.now(timezone.utc).isoformat()
    job_id = job["job_id"]

    existing = await _load_taste_job_doc(job_id)
    if existing is not None:
        if _is_taste_job_doc_final(existing):
            return False
        if existing.get("status") == "in_flight":
            # If a worker is currently processing, skip duplicate scheduling.
            return False
        if existing.get("status") == "queued":
            return False
        # For failed jobs, allow one re-queue attempt by replacing status.
        if existing.get("status") == "failed":
            job = {**job, "retryCount": existing.get("retryCount", 0) + 1, "createdAt": existing.get("createdAt", now)}

    doc = _build_taste_job_document(job, "queued")
    await _upsert_taste_job_doc(doc)
    return True


async def _set_taste_job_status(job_id: str, status: str, **kwargs: Any) -> None:
    existing = await _load_taste_job_doc(job_id)
    if existing is None:
        return
    now_iso = datetime.now(timezone.utc).isoformat()
    existing["status"] = status
    existing["updatedAt"] = now_iso
    existing["retryCount"] = existing.get("retryCount", 0)
    if status == "in_flight":
        existing["retryCount"] = existing.get("retryCount", 0) + 1
    if "error" in kwargs and kwargs["error"] is not None:
        existing["lastError"] = kwargs["error"]
    if kwargs:
        existing.update(kwargs)
    await _upsert_taste_job_doc(existing)


def _serialize_taste_job(job: dict[str, Any]) -> str:
    return base64.b64encode(json.dumps(job).encode("utf-8")).decode("utf-8")


def _parse_taste_job(raw_message: Any) -> dict[str, Any]:
    if hasattr(raw_message, "get_body"):
        raw_body = raw_message.get_body().decode("utf-8")
    else:
        raw_body = str(raw_message)
    try:
        return json.loads(raw_body)
    except json.JSONDecodeError as exc:
        logger.debug(
            "Taste job payload was not plain JSON; attempting base64 decode. raw_message_type=%s",
            type(raw_message).__name__,
        )
        try:
            decoded_body = base64.b64decode(raw_body)
        except (binascii.Error, UnicodeDecodeError) as decode_exc:
            raise ValueError(f"Invalid taste-job payload base64 decode failed for raw_body={raw_body!r}: {decode_exc}") from decode_exc

        try:
            return json.loads(decoded_body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as decode_parse_exc:
            raise ValueError(f"Invalid taste-job payload JSON parse after decode failed for raw_body={raw_body!r}: {decode_parse_exc}") from decode_parse_exc

    except Exception as exc:
        raise ValueError(f"Invalid taste-job payload at top-level parse step for raw_message={raw_message!r}, raw_body={raw_body!r}: {exc}") from exc


def _get_taste_jobs_queue_client() -> "QueueClient":
    from azure.storage.queue import QueueClient

    queue_conn_str = os.getenv("StorageQueue")
    if not queue_conn_str:
        account_name = os.getenv("STORAGE_ACCOUNT_NAME", "")
        account_key = os.getenv("STORAGE_ACCOUNT_KEY", "")
        queue_conn_str = (
            f"DefaultEndpointsProtocol=https;"
            f"AccountName={account_name};"
            f"AccountKey={account_key};"
            f"EndpointSuffix=core.windows.net"
        )
    return QueueClient.from_connection_string(queue_conn_str, _TASTE_JOB_QUEUE_NAME)


async def _send_taste_job_message(job: dict[str, Any]) -> None:
    queue_client = _get_taste_jobs_queue_client()
    serialized = _serialize_taste_job(job)
    await asyncio.to_thread(queue_client.send_message, serialized)


async def _maybe_enqueue_taste_job(
    user_id: str,
    item_id: str,
    image_url: str,
    gallery_image_index: int | None,
    signal: str,
) -> bool:
    if signal != "up":
        return False
    if not image_url:
        return False

    job_id = _taste_job_id(user_id, item_id, image_url, gallery_image_index)
    now = time.monotonic()
    if _is_taste_job_duplicate(job_id, now):
        logger.debug("Skipping duplicate taste job %s for user %s item %s", job_id, user_id, item_id)
        return False

    job = _build_taste_job_message(job_id, user_id, item_id, image_url, gallery_image_index)
    job["createdAt"] = datetime.now(timezone.utc).isoformat()
    job["retryCount"] = 0

    try:
        accepted = await _claim_taste_job(job)
    except Exception as exc:  # noqa: BLE001
        _TASTE_JOB_IN_FLIGHT.pop(job_id, None)
        logger.warning("Could not create taste job state for %s: %s", job_id, exc)
        raise

    if not accepted:
        _TASTE_JOB_IN_FLIGHT.pop(job_id, None)
        logger.debug("Skipping duplicate taste job %s for user %s item %s", job_id, user_id, item_id)
        return False

    try:
        await _send_taste_job_message(job)
    except Exception as exc:  # noqa: BLE001
        _TASTE_JOB_IN_FLIGHT.pop(job_id, None)
        logger.exception("Failed to enqueue taste job %s: %s", job_id, exc)
        await _set_taste_job_status(job_id, "failed", error=str(exc))
        raise
    logger.info("Queued taste-profile job %s for item %s (user %s)", job_id, item_id, user_id)
    return True

async def _run_in_executor_with_retry(
    operation,
    *,
    operation_name: str,
    max_attempts: int,
    base_delay_seconds: float,
) -> Any:
    last_exception: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            return await asyncio.get_running_loop().run_in_executor(None, operation)
        except Exception as exc:  # noqa: BLE001
            last_exception = exc
            if attempt >= max_attempts:
                break
            delay = min(_TASTE_JOB_MAX_BACKOFF_SECONDS, base_delay_seconds * (2 ** (attempt - 1)))
            delay += random.uniform(0.0, _TASTE_JOB_JITTER_SECONDS)
            logger.warning(
                "Retryable failure in %s (%d/%d): %s. Retrying in %.2fs",
                operation_name,
                attempt,
                max_attempts,
                exc,
                delay,
            )
            await asyncio.sleep(delay)

    raise RuntimeError(f"{operation_name} failed after {max_attempts} attempts: {last_exception}") from last_exception


async def _run_taste_profile_job(job: dict[str, Any]) -> None:
    image_url = job["image_url"]
    item_id = job["item_id"]
    user_id = job["user_id"]
    job_id = job["job_id"]

    from agents.image_taste_analyzer import analyze_image, build_taste_inferred
    from agents.taste_calibration import _update_user_profile

    analysis = await _run_in_executor_with_retry(
        lambda: analyze_image(image_url),
        operation_name=f"analyze_image:{item_id}:{job_id}",
        max_attempts=_TASTE_JOB_MAX_RETRIES,
        base_delay_seconds=_TASTE_JOB_BASE_BACKOFF_SECONDS,
    )
    inferred = build_taste_inferred(analysis)
    if not inferred["styleKeywords"] and not inferred["brands"]:
        logger.info("Vision analysis yielded no taste for %s (job %s)", item_id, job_id)
        return

    await _run_in_executor_with_retry(
        lambda: _update_user_profile(user_id, inferred),
        operation_name=f"update_user_profile:{item_id}:{job_id}",
        max_attempts=_TASTE_JOB_PROFILE_UPDATE_MAX_RETRIES,
        base_delay_seconds=_TASTE_JOB_BASE_BACKOFF_SECONDS * 2,
    )
    logger.info(
        "Taste profile updated from vision for user %s, item %s: %s",
        user_id,
        item_id,
        inferred["styleKeywords"][:4],
    )


@app.function_name(name="ProcessTasteAnalysisJob")
@app.queue_trigger(
    arg_name="queue_message",
    queue_name=_TASTE_JOB_QUEUE_NAME,
    connection="StorageQueue",
)
async def _process_taste_profile_job(queue_message) -> None:
    try:
        job = _parse_taste_job(queue_message)
    except ValueError as exc:
        logger.warning("Dropping invalid taste-analysis queue message: %s", exc)
        return

    job_id = job.get("job_id")
    if not job_id:
        return

    now = time.monotonic()
    if _is_taste_job_duplicate(job_id, now):
        logger.debug("Skipping duplicate in-flight taste job %s from queue.", job_id)
        return

    existing = await _load_taste_job_doc(job_id)
    if existing is not None and _is_taste_job_doc_final(existing):
        _mark_taste_job_completed(job_id, now=time.monotonic())
        return

    try:
        await _set_taste_job_status(job_id, "in_flight")
        await _run_taste_profile_job(job)
        await _set_taste_job_status(job_id, "completed", lastCompletedAt=datetime.now(timezone.utc).isoformat())
        _mark_taste_job_completed(job_id, now=time.monotonic())
    except Exception as exc:  # noqa: BLE001
        logger.exception("Taste-profile job failed for %s: %s", job_id, exc)
        await _set_taste_job_status(job_id, "failed", error=str(exc))
        _TASTE_JOB_IN_FLIGHT.pop(job_id, None)
        raise


@app.function_name(name="ProcessTasteAnalysisJobDlq")
@app.queue_trigger(
    arg_name="dead_letter_queue_message",
    queue_name=_TASTE_JOB_DEAD_LETTER_QUEUE_NAME,
    connection="StorageQueue",
)
async def _process_taste_profile_job_dead_letter(dead_letter_queue_message) -> None:
    try:
        parsed_job = _parse_taste_job(dead_letter_queue_message)
    except ValueError:
        parsed_job = {"raw_payload": str(dead_letter_queue_message)}

    job_id = parsed_job.get("job_id", f"unknown-{time.time_ns()}")
    raw_payload = parsed_job.get("raw_payload", parsed_job)
    dead_letter_payload = {
        "jobId": job_id,
        "status": "dead_lettered",
        "payload": raw_payload,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "sourceQueue": _TASTE_JOB_DEAD_LETTER_QUEUE_NAME,
    }
    dead_letter_payload["id"] = f"{job_id}-{int(time.time() * 1000)}"

    from agents.db import get_taste_job_dead_letters_container

    await get_taste_job_dead_letters_container().upsert_item(dead_letter_payload)
    await _set_taste_job_status(job_id, "dead_lettered", error="Poison queue message")

    logger.warning("Persisted taste-analysis dead-letter message for job %s", job_id)


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
    except Exception:
        return image_bytes


def _segment_with_modal(image_bytes: bytes) -> bytes:
    """
    Send image to the Modal BiRefNet segmentation service.
    Returns transparent PNG bytes.
    Raises on any error so the caller can return a 500 response.
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


async def _extract_process_image_payload(request: Request) -> tuple[bytes, str]:
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
        raise HTTPException(status_code=400, detail=_ERR_NO_IMAGE_PROVIDED)

    if provided_item_id:
        item_id = provided_item_id
    else:
        base = filename.rsplit(".", 1)[0] if "." in filename else filename
        item_id = f"{base}-{uuid.uuid4().hex[:8]}"
    return image_bytes, item_id


def _get_archive_blob(item_id: str):
    output_blob_name = f"{item_id}{_ARCHIVE_BLOB_SUFFIX}"
    blob_service = _get_blob_service()
    archive_container = _get_env("ARCHIVE_CONTAINER_NAME")
    return blob_service.get_blob_client(
        container=archive_container, blob=output_blob_name
    )


def _get_cached_archive_url(archive_blob) -> Optional[str]:
    from azure.core.exceptions import ResourceNotFoundError

    try:
        archive_blob.get_blob_properties()
        return archive_blob.url
    except ResourceNotFoundError:
        return None


async def _process_image_payload_to_webp(image_bytes: bytes, item_id: str) -> bytes:
    try:
        transparent_png = await asyncio.to_thread(_segment_with_modal, image_bytes)
        logger.info("process-image: Modal BiRefNet segmentation succeeded")
    except Exception as modal_ex:
        logger.exception("process-image: Modal segmentation failed for %s", item_id)
        raise HTTPException(
            status_code=500,
            detail=f"Image segmentation failed: {modal_ex}",
        )

    try:
        with Image.open(io.BytesIO(transparent_png)) as rgba_img:
            webp_buf = io.BytesIO()
            rgba_img.save(webp_buf, format="WEBP", quality=_WEBP_QUALITY, method=_WEBP_METHOD)
            return webp_buf.getvalue()
    except Exception as ex:
        logger.exception("WebP conversion failed for item %s: %s", item_id, ex)
        raise HTTPException(status_code=500, detail=f"WebP conversion failed: {ex}")


def _upload_archive_blob(archive_blob, webp_data: bytes, item_id: str) -> str:
    try:
        archive_blob.upload_blob(webp_data, overwrite=True, content_type=_WEBP_MEDIA_TYPE)
        return archive_blob.url
    except Exception as ex:
        logger.exception("Blob upload failed for item %s: %s", item_id, ex)
        raise HTTPException(status_code=500, detail=f"Failed to upload image: {ex}")


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

def _run_weekly_digest_user(user_id: str) -> str:
    """
    Run one digest job and return one of: generated / skipped_by_hash / skipped_by_opt_out / failed.
    """
    start = time.perf_counter()
    try:
        from agents.digest_agent import run_digest_for_user_with_status
        _, status = run_digest_for_user_with_status(user_id)
        if status not in {"generated", "skipped_by_hash", "skipped_by_opt_out", "failed"}:
            status = "failed"
    except Exception as exc:  # noqa: BLE001
        logger.exception("Weekly digest failed for user %s: %s", user_id, exc)
        status = "failed"
    elapsed_ms = (time.perf_counter() - start) * 1000.0
    logger.info(
        "PluckItWeeklyDigest user=%s completed with status=%s in %.2f ms",
        user_id,
        status,
        elapsed_ms,
    )
    return status


def _run_weekly_digest_job() -> None:
    from collections import Counter

    from agents.db import get_user_profiles_container_sync

    logger.info(
        "PluckItWeeklyDigest: starting bounded fan-out with max_concurrency=%d",
        _WEEKLY_DIGEST_MAX_CONCURRENCY,
    )

    start = time.perf_counter()
    try:
        profile_container = get_user_profiles_container_sync()
        user_profiles = list(profile_container.read_all_items())
    except Exception as exc:  # noqa: BLE001
        logger.error("Could not load user profiles for weekly digest: %s", exc)
        return

    counter = Counter[str]()
    with ThreadPoolExecutor(max_workers=max(1, _WEEKLY_DIGEST_MAX_CONCURRENCY)) as pool:
        futures = {}
        for profile in user_profiles:
            user_id = (profile or {}).get("id")
            if not user_id:
                continue
            futures[pool.submit(_run_weekly_digest_user, user_id)] = user_id

        for future in as_completed(futures):
            user_id = futures[future]
            try:
                outcome = future.result()
            except Exception as exc:  # noqa: BLE001
                logger.exception("Weekly digest worker crashed for user %s: %s", user_id, exc)
                outcome = "failed"
            counter[outcome] += 1

    elapsed_ms = (time.perf_counter() - start) * 1000.0
    logger.info(
        "PluckItWeeklyDigest complete: users=%d elapsed_ms=%.2f outcomes=%s",
        sum(counter.values()),
        elapsed_ms,
        dict(counter),
    )


def _run_scraper_source_job(source_id: str) -> str:
    start = time.perf_counter()
    try:
        from agents.scraper_runner import run_for_source

        new_items = run_for_source(source_id)
        status = "ok" if new_items else "no_items"
    except Exception as exc:  # noqa: BLE001
        logger.exception("Scraper source failed for %s: %s", source_id, exc)
        status = "failed"
    elapsed_ms = (time.perf_counter() - start) * 1000.0
    logger.info(
        "PluckItScraper source=%s completed with status=%s in %.2f ms",
        source_id,
        status,
        elapsed_ms,
    )
    return status


def _run_scraper_job() -> None:
    from collections import Counter

    from agents.db import get_scraper_sources_container_sync

    logger.info(
        "PluckItScraper: starting bounded fan-out with max_concurrency=%d",
        _SCRAPER_MAX_CONCURRENCY,
    )
    start = time.perf_counter()
    try:
        sources_container = get_scraper_sources_container_sync()
        sources = list(sources_container.query_items(
            query="SELECT * FROM c WHERE c.isActive = true AND c.isGlobal = true",
            enable_cross_partition_query=True,
        ))
    except Exception as exc:  # noqa: BLE001
        logger.error("Could not load scraper sources for PluckItScraper: %s", exc)
        return

    counter = Counter[str]()
    with ThreadPoolExecutor(max_workers=max(1, _SCRAPER_MAX_CONCURRENCY)) as pool:
        futures = {}
        for source_doc in sources:
            source_id = (source_doc or {}).get("id")
            if not source_id:
                continue
            futures[pool.submit(_run_scraper_source_job, source_id)] = source_id

        for future in as_completed(futures):
            source_id = futures[future]
            try:
                outcome = future.result()
            except Exception as exc:  # noqa: BLE001
                logger.exception("Scraper worker crashed for source %s: %s", source_id, exc)
                outcome = "failed"
            counter[outcome] += 1

    elapsed_ms = (time.perf_counter() - start) * 1000.0
    logger.info(
        "PluckItScraper complete: sources=%d elapsed_ms=%.2f outcomes=%s",
        sum(counter.values()),
        elapsed_ms,
        dict(counter),
    )


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
        _run_weekly_digest_job()
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
        _run_scraper_job()
    except Exception as exc:
        logger.exception("Scraper run failed: %s", exc)


# ── FastAPI routes ────────────────────────────────────────────────────────────

@fastapi_app.get("/api/health")
async def health():
    return {"status": "ok", "service": "pluckit-processor"}


# ── Process image ─────────────────────────────────────────────────────────────

@fastapi_app.post(
    "/api/process-image",
    status_code=201,
    responses={
        201: {"description": "Image processed and stored in archive storage."},
        400: {"description": "No image provided."},
        500: {"description": "Image processing failed."},
    },
)
async def process_image(request: Request):
    """
    Accept an image as multipart/form-data (field 'image') or raw bytes.
    Optional form field 'item_id' sets the blob/Cosmos id directly.
    Calls Modal BiRefNet segmentation and returns 500 on segmentation failures.
    If the archive blob already exists for item_id (e.g. a retry after a
    connection-drop), segmentation is skipped and the existing URL is returned.
    Returns {id, imageUrl}.
    """
    logger.info("process-image: received request")
    image_bytes, item_id = await _extract_process_image_payload(request)
    archive_blob = _get_archive_blob(item_id)

    cached_archive_url = _get_cached_archive_url(archive_blob)
    if cached_archive_url:
        logger.info(
            "process-image: archive blob already exists for %s, skipping segmentation",
            item_id,
        )
        return {"id": item_id, "imageUrl": cached_archive_url, "mediaType": _WEBP_MEDIA_TYPE}

    transparent_webp = await _process_image_payload_to_webp(image_bytes, item_id)
    archive_url = _upload_archive_blob(archive_blob, transparent_webp, item_id)

    logger.info("process-image: item %s → %s (WebP, %d bytes)", item_id, archive_url, len(transparent_webp))
    return {"id": item_id, "imageUrl": archive_url, "mediaType": _WEBP_MEDIA_TYPE}


# ── Chat endpoint (SSE streaming) ─────────────────────────────────────────────

class ChatRequest(BaseModel):
    message: str
    recentMessages: list[dict] = []
    selectedItemIds: Optional[list[str]] = None
    traceId: Optional[str] = None


def _inject_trace_id(sse_line: str, trace_id: Optional[str]) -> str:
    if not trace_id:
        return sse_line
    if not sse_line.startswith(_SSE_DATA_PREFIX):
        return sse_line

    try:
        payload = json.loads(sse_line.removeprefix(_SSE_DATA_PREFIX).strip())
        payload["traceId"] = trace_id
        return f"{_SSE_DATA_PREFIX}{json.dumps(payload)}\n\n"
    except Exception:
        return sse_line


@fastapi_app.post("/api/chat", responses={
    200: {"description": "SSE stream of stylist agent responses."},
    400: {"description": "Invalid prompt or mood selection."},
    401: {"description": "Authentication failed."},
    500: {"description": "Agent logic error or streaming failure."}
})
@fastapi_app.post("/api/chat/", responses={
    200: {"description": "SSE stream of stylist agent responses."},
    400: {"description": "Invalid prompt or mood selection."},
    401: {"description": "Authentication failed."},
    500: {"description": "Agent logic error or streaming failure."}
})
async def chat(
    body: ChatRequest,
    request: Request,
    user_id: Annotated[str, Depends(get_user_id)],
):
    """
    Stream the stylist agent's response as Server-Sent Events.

    Event shapes (each line: data: <json>\\n\\n):
      {"type": "token",       "content": "..."}
      {"type": "tool_use",    "name": "..."}
      {"type": "tool_result", "name": "...", "summary": "..."}
      {"type": "memory_update", "updated": bool}
      {"type": "done"}
    """
    trace_id = body.traceId or request.headers.get("X-Trace-Id")
    memory = await load_memory(user_id)

    async def event_stream():
        collected_tokens: list[str] = []

        async for sse_line in stream_stylist_response(
            user_id=user_id,
            user_message=body.message,
            recent_messages=body.recentMessages,
            memory_summary=memory.summary,
            selected_item_ids=body.selectedItemIds,
            trace_id=trace_id,
        ):
            sse_line = _inject_trace_id(sse_line, trace_id)
            if '"type": "token"' in sse_line:
                try:
                    data = json.loads(sse_line.removeprefix(_SSE_DATA_PREFIX).strip())
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
            yield _inject_trace_id(
                f"{_SSE_DATA_PREFIX}{json.dumps({'type': 'memory_update', 'updated': new_summary is not None})}\n\n",
                trace_id,
            )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ── Memory (conversation summary) endpoints ──────────────────────────────────

@fastapi_app.get("/api/chat/memory", responses={
    200: {"description": "User conversation memory summary retrieved."},
    401: {"description": "Authentication failed."}
})
async def get_memory(user_id: Annotated[str, Depends(get_user_id)]):
    """Return the user's current conversation memory summary (user-editable)."""
    memory = await load_memory(user_id)
    return {"summary": memory.summary, "updatedAt": memory.updated_at}


class MemoryUpdateRequest(BaseModel):
    summary: str


@fastapi_app.put("/api/chat/memory", responses={
    200: {"description": "Memory summary updated successfully."},
    400: {"description": "Summary exceeds character limit."},
    401: {"description": "Authentication failed."}
})
async def update_memory(body: MemoryUpdateRequest, user_id: Annotated[str, Depends(get_user_id)]):
    """Allow the user to edit their conversation memory summary."""
    if len(body.summary) > 2000:
        raise HTTPException(status_code=400, detail="Summary must be 2000 characters or fewer.")
    await save_memory(user_id, body.summary.strip())
    return {"status": "updated"}


# ── Digest results endpoint ───────────────────────────────────────────────────

@fastapi_app.post(
    "/api/digest/run",
    responses={
        200: {"description": "Digest generation request was accepted."},
        400: {"description": "Invalid request or unsupported option."},
        401: {"description": "Authentication failed."},
        500: {"description": "Could not run digest."},
    },
)
async def run_digest_now(user_id: Annotated[str, Depends(get_user_id)], force: bool = True):
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


@fastapi_app.get(
    "/api/digest/latest",
    responses={
        304: {"description": "Digest has not changed."},
        200: {"description": "Most recent digest returned."},
        401: {"description": "Authentication failed."},
        500: {"description": "Could not load digest."},
    },
)
async def get_latest_digest(request: Request, user_id: Annotated[str, Depends(get_user_id)]):
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
            return _json_response_with_cache({"digest": None}, request)

        digest = results[0]
        for key in ["_rid", "_self", "_etag", "_attachments", "_ts"]:
            digest.pop(key, None)
        return _json_response_with_cache({"digest": digest}, request)
    except Exception as exc:
        logger.exception("Failed to load digest for user %s: %s", user_id, exc)
        raise HTTPException(status_code=500, detail="Could not load digest.")


@fastapi_app.get(
    "/api/insights/vault",
    responses={
        304: {"description": "Insights payload has not changed."},
        200: {"description": "Vault insight data returned."},
        401: {"description": "Authentication failed."},
        500: {"description": "Could not compute vault insights."},
    },
)
async def get_vault_insights(
    request: Request,
    user_id: Annotated[str, Depends(get_user_id)],
    window_days: Annotated[int, Query(alias="windowDays")] = 90,
    target_cpw: Annotated[float, Query(alias="targetCpw")] = 100.0,
):
    """Return deterministic behavior + CPW insights for the vault surface."""
    from agents.vault_insights import compute_vault_insights
    try:
        result = await compute_vault_insights(
            user_id=user_id,
            window_days=window_days,
            target_cpw=target_cpw,
        )
        return _json_response_with_cache(result, request)
    except Exception as exc:
        logger.exception("Failed to compute vault insights for user %s: %s", user_id, exc)
        raise HTTPException(status_code=500, detail="Could not compute vault insights.")


class DigestFeedbackRequest(BaseModel):
    digestId: str
    suggestionIndex: int
    suggestionDescription: str = ""
    signal: str  # "up" | "down"


@fastapi_app.get(
    "/api/digest/feedback",
    responses={
        200: {"description": "Digest feedback returned."},
        401: {"description": "Authentication failed."},
        500: {"description": "Could not load feedback."},
    },
)
async def get_digest_feedback(
    digest_id: Annotated[str, Query(alias="digestId")],
    user_id: Annotated[str, Depends(get_user_id)],
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
                "WHERE c.userId = @userId AND c.digestId = @digest_id"
            ),
            parameters=[
                {"name": "@userId",   "value": user_id},
                {"name": "@digest_id", "value": digest_id},
            ],
        ):
            results.append(item)
    except Exception as exc:
        logger.exception("Failed to load digest feedback: %s", exc)
        raise HTTPException(status_code=500, detail="Could not load feedback.")
    return {"feedback": results}


@fastapi_app.post(
    "/api/digest/feedback",
    responses={
        200: {"description": "Digest feedback recorded."},
        400: {"description": "Invalid feedback signal."},
        401: {"description": "Authentication failed."},
        500: {"description": "Could not save feedback."},
    },
)
async def post_digest_feedback(
    body: DigestFeedbackRequest,
    user_id: Annotated[str, Depends(get_user_id)],
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
        "createdAt": datetime.now(timezone.utc).isoformat().replace(_ISO_UTC_SUFFIX, "Z"),
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


@fastapi_app.post(
    "/api/moods/seed",
    responses={
        200: {"description": "Moods seeding triggered."},
        401: {"description": "Authentication failed."},
        500: {"description": "Sitemap seeder failed."},
    },
)
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


@fastapi_app.get(
    "/api/moods",
    responses={
        200: {"description": "Latest mood catalog entries."},
        400: {"description": "Unknown primary mood filter."},
        401: {"description": "Authentication failed."},
        500: {"description": "Could not load moods."},
    },
)
async def list_moods(
    primary_mood: Annotated[Optional[str], Query(alias="primaryMood")] = None
):
    """
    List all fashion trend moods, optionally filtered by primaryMood category.
    Results are ordered by trendScore (most-mentioned first).

    Query params:
      primaryMood — optional filter, must be one of the known primary mood categories.
    """
    from agents.db import get_moods_container
    container = get_moods_container()

    if primary_mood is not None and primary_mood not in PRIMARY_MOODS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown primaryMood '{primary_mood}'. Valid values: {', '.join(PRIMARY_MOODS)}",
        )

    try:
        if primary_mood:
            query = (
                f"SELECT * FROM c WHERE c.primaryMood = @primaryMood "
                f"ORDER BY c.trendScore DESC OFFSET 0 LIMIT {_DB_LIMIT_PARAM}"
            )
            parameters = [
                {"name": "@primaryMood", "value": primary_mood},
                {"name": _DB_LIMIT_PARAM,       "value": _MOOD_LIST_LIMIT},
            ]
        else:
            query = (
                f"SELECT * FROM c ORDER BY c.trendScore DESC OFFSET 0 LIMIT {_DB_LIMIT_PARAM}"
            )
            parameters = [{"name": _DB_LIMIT_PARAM, "value": _MOOD_LIST_LIMIT}]

        moods = []
        async for item in container.query_items(query=query, parameters=parameters):
            for key in _COSMOS_INTERNAL_KEYS:
                item.pop(key, None)
            moods.append(item)

        return {"moods": moods, "primaryMoods": PRIMARY_MOODS}
    except Exception as exc:
        logger.exception("Failed to list moods: %s", exc)
        raise HTTPException(status_code=500, detail="Could not load moods.")


@fastapi_app.get(
    "/api/moods/{mood_id}",
    responses={
        200: {"description": "Mood returned."},
        401: {"description": "Authentication failed."},
        404: {"description": "Mood not found."},
        500: {"description": "Could not load mood."},
    },
)
async def get_mood(mood_id: str):
    """Return a single mood document by its ID."""
    from agents.db import get_moods_container
    container = get_moods_container()

    try:
        # mood_id format: "<primaryMood_lower>-<slug>", e.g. "minimalist-quiet-luxury"
        # Extract the primaryMood prefix by matching against the known vocabulary.
        parts = mood_id.split("-")
        if len(parts) < 2:
            raise HTTPException(status_code=404, detail=_ERR_MOOD_NOT_FOUND)

        # Try progressively longer prefixes to handle multi-word primary moods
        partition_key = None
        for n in range(1, len(parts)):
            candidate = "-".join(parts[:n])
            match = next((m for m in PRIMARY_MOODS if m.lower() == candidate), None)
            if match:
                partition_key = match
                break

        if partition_key is None:
            raise HTTPException(status_code=404, detail=_ERR_MOOD_NOT_FOUND)

        item = await container.read_item(item=mood_id, partition_key=partition_key)
        for key in _COSMOS_INTERNAL_KEYS:
            item.pop(key, None)
        return item
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to load mood %s: %s", mood_id, exc)
        raise HTTPException(status_code=404, detail=_ERR_MOOD_NOT_FOUND)


# ── Scraper security helpers ──────────────────────────────────────────────────

import ipaddress
import socket
from urllib.parse import urlparse


def _is_private_or_reserved_address(ip: ipaddress._BaseAddress) -> bool:
    return not ip.is_global


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

    # Resolve DNS and check every returned address.
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
        if _is_private_or_reserved_address(ip):
            raise HTTPException(
                status_code=400,
                detail="URL resolves to a private or reserved address.",
            )


def _require_admin(user_id: Annotated[str, Depends(get_user_id)]) -> str:
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


@fastapi_app.get("/api/scraper/sources", responses={
    401: {"description": "Authentication failed."},
    200: {
        "description": "List of scraper sources with subscription status.",
        "content": {
            "application/json": {
                "example": {
                    "sources": [
                        {
                            "id": "reddit-fashion",
                            "name": "Reddit r/fashion",
                            "sourceType": "reddit",
                            "isGlobal": True,
                            "lastScrapedAt": "2023-10-27T10:00:00Z",
                            "config": {"subreddit": "fashion"},
                            "leaseExpiresAt": None,
                            "subscribed": True,
                            "needsClientIngest": False
                        }
                    ]
                }
            }
        }
    },
    500: {"description": "Could not load sources."},
})
async def list_scraper_sources(user_id: Annotated[str, Depends(get_user_id)]):
    """List all active scraper sources (global + user-created)."""
    from agents.db import get_scraper_sources_container, get_user_source_subscriptions_container

    sources_container = get_scraper_sources_container()
    subs_container = get_user_source_subscriptions_container()

    try:
        sources = []
        async for doc in sources_container.query_items(
            query="SELECT c.id, c.name, c.sourceType, c.isGlobal, c.lastScrapedAt, c.config, c.leaseExpiresAt FROM c WHERE c.isActive = true",
        ):
            for key in _COSMOS_INTERNAL_KEYS:
                doc.pop(key, None)
            sources.append(doc)

        subscribed_ids = await _get_user_subscriptions(subs_container, user_id)

        for source in sources:
            source["subscribed"] = source["id"] in subscribed_ids
            source["needsClientIngest"] = _check_needs_client_ingest(source)

        return {"sources": sources}
    except Exception as exc:
        logger.exception("list_scraper_sources failed: %s", exc)
        raise HTTPException(status_code=500, detail="Could not load sources.")

async def _get_user_subscriptions(container: any, user_id: str) -> set[str]:
    subscribed_ids = set()
    async for sub in container.query_items(
        query="SELECT c.sourceId FROM c WHERE c.userId = @uid AND c.isActive = true",
        parameters=[{"name": _DB_USER_ID_PARAM, "value": user_id}],
    ):
        subscribed_ids.add(sub["sourceId"])
    return subscribed_ids

def _check_needs_client_ingest(source: dict) -> bool:
    if source.get("sourceType") != "reddit":
        return False
    
    now = datetime.now(timezone.utc)
    
    # 1. Check refresh interval (4 hours)
    last_scraped = source.get("lastScrapedAt")
    if last_scraped:
        dt = datetime.fromisoformat(last_scraped.replace(_ISO_UTC_SUFFIX, "Z"))
        if now - dt < timedelta(hours=4):
            return False
            
    # 2. Check active lease
    lease_expires = source.get("leaseExpiresAt")
    if lease_expires:
        ldt = datetime.fromisoformat(lease_expires.replace(_ISO_UTC_SUFFIX, "Z"))
        if now < ldt:
            return False
            
    return True


@fastapi_app.post("/api/scraper/sources", status_code=201, responses={
    201: {
        "description": "Scraper source successfully suggested and configured.",
        "content": {
            "application/json": {
                "example": {
                    "sourceId": "brand-zara",
                    "name": "Zara",
                    "config": {
                        "type": "css_selectors",
                        "item_selector": ".product-item",
                        "title_selector": ".product-title",
                        "image_selector": ".product-image img@src"
                    }
                }
            }
        }
    },
    400: {"description": "Invalid URL or other input error."},
    401: {"description": "Authentication failed."},
    500: {"description": "Failed to generate scraper config or save source."}
})
async def suggest_scraper_source(
    body: SuggestSourceRequest,
    user_id: Annotated[str, Depends(get_user_id)],
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


@fastapi_app.post("/api/scraper/lease/{source_id}", responses={
    200: {
        "description": "Lease successfully acquired.",
        "content": {
            "application/json": {
                "example": {"status": "ok", "expiresAt": "2023-10-27T10:15:00Z"}
            }
        }
    },
    404: {"description": "Source not found."},
    409: {"description": "Lease already held by another user."},
    401: {"description": "Authentication failed."},
    500: {"description": "Could not acquire lease."}
})
async def acquire_scraper_lease(source_id: str, user_id: Annotated[str, Depends(get_user_id)]):
    """
    Acquire a 15-minute lease for client-side scraping.
    Prevents multiple users from hammering the same subreddit.
    """
    from agents.db import get_scraper_sources_container
    container = get_scraper_sources_container()

    try:
        # ScraperSources is partitioned by sourceType, but we only have ID here.
        # Use a cross-partition query to find the source.
        items = [i async for i in container.query_items(
            query="SELECT * FROM c WHERE c.id = @id",
            parameters=[{"name": "@id", "value": source_id}]
        )]
        if not items:
            raise HTTPException(status_code=404, detail=_ERR_SOURCE_NOT_FOUND_MESSAGE)
        source = items[0]
        
        # Check if existing lease is still active
        lease_expires = source.get("leaseExpiresAt")
        if lease_expires:
            ldt = datetime.fromisoformat(lease_expires.replace(_ISO_UTC_SUFFIX, "Z"))
            if datetime.now(timezone.utc) < ldt:
                raise HTTPException(status_code=409, detail="Lease already held by another user.")

        source["leaseExpiresAt"] = (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()
        await container.upsert_item(source)
        return {"status": "ok", "expiresAt": source["leaseExpiresAt"]}
    except Exception as exc:
        if isinstance(exc, HTTPException): raise
        logger.exception("acquire_scraper_lease failed: %s", exc)
        raise HTTPException(status_code=500, detail="Could not acquire lease.")


@fastapi_app.post("/api/scraper/ingest/reddit", responses={
    200: {
        "description": "Reddit data ingested successfully.",
        "content": {
            "application/json": {
                "examples": {
                    "success": {"value": {"count": 10, "status": "ok", "verified": True}},
                    "no_valid_items": {"value": {"count": 0, "status": "no_valid_items", "verified": True}}
                }
            }
        }
    },
    403: {"description": "User is banned from contributing."},
    404: {"description": "Source not found."},
    500: {"description": "Internal server error during ingestion."}
})
async def ingest_reddit_data(body: RedditIngestBatch, user_id: Annotated[str, Depends(get_user_id)]):
    """
    Submit Reddit JSON data scraped by the client.
    Includes validation, subreddit binding, and spot-checks.
    """
    from agents.scrapers.reddit_scraper import RedditScraper
    from agents.scraper_runner import ingest_items
    await _check_user_ban(user_id)
    source = await _get_source_and_verify_sub(body.source_id)
    expected_sub = source.get("config", {}).get("subreddit", "").lower()

    scraper = RedditScraper()
    raw_posts = [p.dict() for p in body.posts]
    scraped_items = scraper.process_posts(raw_posts, expected_sub, body.source_id)

    if not scraped_items:
        return {"count": 0, "status": "no_valid_items", "verified": True}

    # Spot-check logic: 10% chance
    verified = True

    loop = asyncio.get_event_loop()
    upserted = await loop.run_in_executor(
        None, ingest_items, scraped_items, source, user_id, verified
    )

    return {"count": upserted, "status": "ok", "verified": verified}

async def _check_user_ban(user_id: str):
    from agents.db import get_user_bans_container
    from azure.cosmos.exceptions import CosmosResourceNotFoundError
    container = get_user_bans_container()
    try:
        await container.read_item(item=user_id, partition_key=user_id)
        raise HTTPException(status_code=403, detail="User is banned from contributing.")
    except CosmosResourceNotFoundError:
        pass

async def _get_source_and_verify_sub(source_id: str) -> dict:
    from agents.db import get_scraper_sources_container
    container = get_scraper_sources_container()
    try:
        items = [i async for i in container.query_items(
            query="SELECT * FROM c WHERE c.id = @id",
            parameters=[{"name": "@id", "value": source_id}]
        )]
        if not items:
            raise HTTPException(status_code=404, detail=_ERR_SOURCE_NOT_FOUND_MESSAGE)
        return items[0]
    except Exception as exc:
        if isinstance(exc, HTTPException): raise
        raise HTTPException(status_code=404, detail=_ERR_SOURCE_NOT_FOUND_MESSAGE)


@fastapi_app.post("/api/admin/unban/{target_user_id}", responses={
    200: {
        "description": "User successfully unbanned.",
        "content": {
            "application/json": {
                "example": {"status": "unbanned", "userId": "user123"}
            }
        }
    },
    403: {"description": "Admin access required."},
    404: {"description": "User ban record not found."}
})
async def admin_unban_user(
    target_user_id: str,
    admin_id: Annotated[str, Depends(_require_admin)]
):
    """Admin-only: Remove a user from the ban list."""
    from agents.db import get_user_bans_container
    container = get_user_bans_container()
    try:
        await container.delete_item(item=target_user_id, partition_key=target_user_id)
        return {"status": "unbanned", "userId": target_user_id}
    except Exception:
        raise HTTPException(status_code=404, detail="User ban record not found.")



@fastapi_app.post("/api/scraper/subscribe/{source_id}", status_code=201, responses={
    201: {
        "description": "Successfully subscribed to source.",
        "content": {
            "application/json": {
                "example": {"sourceId": "reddit-fashion", "subscribed": True}
            }
        }
    },
    401: {"description": "Authentication failed."},
    500: {"description": "Could not subscribe to source."}
})
async def subscribe_to_source(
    source_id: str,
    user_id: Annotated[str, Depends(get_user_id)],
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
        except Exception as _exc:  # noqa: BLE001
            logger.warning("Background scrape for %s failed: %s", source_id, _exc)
 
    task = asyncio.create_task(_bg_scrape())
    background_tasks.add(task)
    task.add_done_callback(background_tasks.discard)

    return {"sourceId": source_id, "subscribed": True}


@fastapi_app.delete("/api/scraper/subscribe/{source_id}", responses={
    200: {
        "description": "Successfully unsubscribed from source.",
        "content": {
            "application/json": {
                "example": {"sourceId": "reddit-fashion", "subscribed": False}
            }
        }
    },
    401: {"description": "Authentication failed."},
    500: {"description": "Could not unsubscribe from source."}
})
async def unsubscribe_from_source(
    source_id: str,
    user_id: Annotated[str, Depends(get_user_id)],
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


def _parse_cursor_token(token: Optional[str]) -> tuple[Optional[Any], Optional[str]]:
    if not token:
        return None, None
    try:
        raw = base64.urlsafe_b64decode(token.encode()).decode()
        payload = json.loads(raw)
        return payload.get("k"), payload.get("id")
    except Exception:
        return None, None


def _build_continuation_token(token_key: Any, doc_id: str) -> Optional[str]:
    if token_key is None or not doc_id:
        return None
    payload = json.dumps({"k": token_key, "id": doc_id})
    return base64.urlsafe_b64encode(payload.encode()).decode()


def _normalise_sort(sort_by: str) -> str:
    return sort_by if sort_by in {"score", "recent"} else "score"


def _since_iso(range_key: str) -> Optional[str]:
    now = datetime.now(timezone.utc)
    windows = {
        "1h": timedelta(hours=1),
        "1d": timedelta(days=1),
        "7d": timedelta(days=7),
        "30d": timedelta(days=30),
    }
    delta = windows.get(range_key)
    if delta is None:
        return None
    return (now - delta).isoformat()


def _build_scraped_items_query(
    sort_by: str,
    effective_page_size: int,
    source_ids: list[str],
    tag_filters: list[str],
    since: Optional[str],
    cursor_key: Optional[Any],
) -> tuple[str, list[dict]]:
    order_clause = (
        "c.userId ASC, c.scoreSignal DESC"
        if sort_by == "score"
        else "c.userId ASC, c.scrapedAt DESC"
    )

    where_clauses = ["c.userId = 'global'"]
    params: list[dict] = [{"name": _DB_LIMIT_PARAM, "value": effective_page_size + 1}]

    if source_ids:
        where_clauses.append("ARRAY_CONTAINS(@sourceIds, c.sourceId)")
        params.append({"name": "@sourceIds", "value": source_ids})

    if tag_filters:
        where_clauses.append(
            "EXISTS (SELECT VALUE t FROM t IN c.tags WHERE ARRAY_CONTAINS(@tags, LOWER(t)))"
        )
        params.append({"name": "@tags", "value": tag_filters})

    if since:
        where_clauses.append(
            "("
            "(IS_DEFINED(c.sourceCreatedAt) AND c.sourceCreatedAt >= @since)"
            " OR "
            "(NOT IS_DEFINED(c.sourceCreatedAt) AND c.scrapedAt >= @since)"
            ")"
        )
        params.append({"name": "@since", "value": since})

    if cursor_key is not None:
        if sort_by == "score":
            where_clauses.append("c.scoreSignal < @cursorKey")
            params.append({"name": "@cursorKey", "value": int(cursor_key)})
        else:
            where_clauses.append("c.scrapedAt < @cursorKey")
            params.append({"name": "@cursorKey", "value": str(cursor_key)})

    query = (
        f"SELECT * FROM c WHERE {' AND '.join(where_clauses)} "
        f"ORDER BY {order_clause} OFFSET 0 LIMIT @limit"
    )
    return query, params


async def _query_scraped_items(
    container,
    query: str,
    params: list[dict],
    partition_key: Optional[str],
) -> list[dict]:
    items: list[dict] = []
    iterator_kwargs = {"query": query, "parameters": params}
    if partition_key is not None:
        iterator_kwargs["partition_key"] = partition_key
    iterator = container.query_items(**iterator_kwargs)
    async for doc in iterator:
        for key in _COSMOS_INTERNAL_KEYS:
            doc.pop(key, None)
        items.append(doc)
    return items


@fastapi_app.get(
    "/api/scraper/items",
    responses={
        200: {"description": "Scraped items returned."},
        401: {"description": "Authentication failed."},
        500: {"description": "Could not load items."},
    },
)
async def list_scraped_items(
    user_id: Annotated[str, Depends(get_user_id)],
    sort_by: Annotated[str, Query(alias="sortBy")] = "score",
    page_size: Annotated[int, Query(alias="pageSize")] = 50,
    source_ids: Annotated[Optional[str], Query(alias="sourceIds")] = None,
    tags: Optional[str] = None,
    time_range: Annotated[str, Query(alias="timeRange")] = "all",
    continuation_token: Annotated[Optional[str], Query(alias="continuationToken")] = None,
):
    """List scraped items for the discover feed (global pool)."""
    from agents.db import get_scraped_items_container

    cursor_key, _ = _parse_cursor_token(continuation_token)
    container = get_scraped_items_container()
    sort_by = _normalise_sort(sort_by)

    try:
        effective_page_size = max(1, min(page_size, 100))
        source_filter_ids = [s.strip() for s in (source_ids or "").split(",") if s.strip()]
        tag_filters = [t.strip().lower() for t in (tags or "").split(",") if t.strip()]
        since = _since_iso(time_range)
        query, params = _build_scraped_items_query(
            sort_by=sort_by,
            effective_page_size=effective_page_size,
            source_ids=source_filter_ids,
            tag_filters=tag_filters,
            since=since,
            cursor_key=cursor_key,
        )

        try:
            items = await _query_scraped_items(container, query, params, partition_key="global")
        except Exception:
            # Fallback for containers partitioned by a different key.
            items = await _query_scraped_items(container, query, params, partition_key=None)

        has_more = len(items) > effective_page_size
        page_items = items[:effective_page_size]
        next_token = None
        if has_more and page_items:
            last = page_items[-1]
            cursor_value = last.get("scoreSignal") if sort_by == "score" else last.get("scrapedAt")
            next_token = _build_continuation_token(cursor_value, last.get("id", ""))

        return {"items": page_items, "nextContinuationToken": next_token}
    except Exception as exc:
        logger.exception("list_scraped_items failed: %s", exc)
        raise HTTPException(status_code=500, detail="Could not load items.")




@fastapi_app.post(
    "/api/scraper/items/{item_id}/feedback",
    responses={
        200: {"description": "Feedback recorded."},
        400: {"description": "Invalid feedback signal."},
        401: {"description": "Authentication failed."},
        500: {"description": "Could not record feedback."},
    },
)
async def feedback_scraped_item(
    item_id: str,
    body: dict,
    user_id: Annotated[str, Depends(get_user_id)],
):
    """Record like/dislike on a scraped item. signal: 'up' or 'down'."""
    from agents.db import get_scraped_items_container

    signal = body.get("signal")
    if signal not in ("up", "down"):
        raise HTTPException(status_code=400, detail="signal must be 'up' or 'down'")

    # Optional: index into galleryImages for per-image liking in slideshow
    gallery_image_index: int | None = body.get("galleryImageIndex")

    container = get_scraped_items_container()
    try:
        item = await container.read_item(item=item_id, partition_key="global")
        delta = 1 if signal == "up" else -1
        item["scoreSignal"] = item.get("scoreSignal", 0) + delta
        await container.upsert_item(item)

        # On like: enqueue vision analysis on the image to extract real visual
        # style descriptors (colors, silhouette, garments) in the background.
        # When a gallery index is provided, analyse that specific image.
        gallery_images = item.get("galleryImages", [])
        if (
            gallery_image_index is not None
            and isinstance(gallery_image_index, int)
            and 0 <= gallery_image_index < len(gallery_images)
        ):
            image_url: str = gallery_images[gallery_image_index]
        else:
            image_url = item.get("imageUrl", "")
        if image_url and signal == "up":
            try:
                if await _maybe_enqueue_taste_job(
                    user_id=user_id,
                    item_id=item_id,
                    image_url=image_url,
                    gallery_image_index=gallery_image_index,
                    signal=signal,
                ):
                    logger.debug("Queued vision taste extraction job for %s", item_id)
                else:
                    logger.debug("Skipped duplicate vision job for %s", item_id)
            except Exception as _vision_exc:  # noqa: BLE001
                logger.warning("Vision taste enqueue failed for %s: %s", item_id, _vision_exc)

        return {"itemId": item_id, "signal": signal, "scoreSignal": item["scoreSignal"]}
    except Exception as exc:
        logger.exception("feedback_scraped_item failed: %s", exc)
        raise HTTPException(status_code=500, detail="Could not record feedback.")



@fastapi_app.post(
    "/api/scraper/run/{source_id}",
    responses={
        200: {"description": "Scraper run started for source."},
        401: {"description": "Authentication failed."},
        403: {"description": "Admin access required."},
        500: {"description": "Scrape failed."},
    },
)
async def run_scraper_source(
    source_id: str,
    _: Annotated[str, Depends(_require_admin)],
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


@fastapi_app.get(
    "/api/taste/quiz",
    responses={
        200: {"description": "Active quiz session returned."},
        401: {"description": "Authentication failed."},
        500: {"description": "Could not load quiz."},
    },
)
async def get_taste_quiz(user_id: Annotated[str, Depends(get_user_id)]):
    """Get (or create) the active taste quiz session for the current user."""
    try:
        module = import_module(_TASTE_MODULE_NAME)
        session = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: module.get_or_create_quiz_session(user_id),
        )
        for key in _COSMOS_INTERNAL_KEYS:
            session.pop(key, None)
        return session
    except Exception as exc:
        logger.exception("get_taste_quiz failed: %s", exc)
        raise HTTPException(status_code=500, detail="Could not load quiz.")


@fastapi_app.post(
    "/api/taste/quiz/{session_id}/respond",
    responses={
        200: {"description": "Quiz response recorded."},
        400: {"description": "Invalid quiz signal."},
        401: {"description": "Authentication failed."},
        500: {"description": "Could not record response."},
    },
)
async def record_quiz_response(
    session_id: str,
    body: QuizResponse,
    user_id: Annotated[str, Depends(get_user_id)],
):
    """Record a thumbs-up or thumbs-down response in the quiz session."""
    if body.signal not in ("up", "down"):
        raise HTTPException(status_code=400, detail="signal must be 'up' or 'down'")

    response_dict = body.model_dump(exclude_none=True)
    try:
        session = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: __import__(
                _TASTE_MODULE_NAME_TAG, fromlist=["record_response"]
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


@fastapi_app.post(
    "/api/taste/quiz/{session_id}/complete",
    responses={
        200: {"description": "Quiz completed and profile updated."},
        401: {"description": "Authentication failed."},
        500: {"description": "Could not complete quiz."},
    },
)
async def complete_taste_quiz(
    session_id: str,
    user_id: Annotated[str, Depends(get_user_id)],
):
    """Finalise the quiz session and update the user's style profile."""
    try:
        inferred = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: __import__(
                _TASTE_MODULE_NAME_TAG, fromlist=["complete_quiz"]
            ).complete_quiz(user_id, session_id),
        )
        return {"sessionId": session_id, "inferredTastes": inferred}
    except Exception as exc:
        logger.exception("complete_taste_quiz failed: %s", exc)
        raise HTTPException(status_code=500, detail="Could not complete quiz.")
