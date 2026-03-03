"""
Lazy singleton Cosmos DB client and container accessors for the AI agents.

The CosmosClient is expensive to create, so it is initialised once and cached.
Container helpers return the container client directly — container creation is
handled by Terraform, not the application code.
"""

import os
import functools
from typing import Optional

from azure.cosmos import CosmosClient as _CosmosClient
from azure.cosmos.aio import CosmosClient as AsyncCosmosClient


def _get_env(name: str, default: Optional[str] = None) -> str:
    value = os.getenv(name, default)
    if value is None:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


# ── Sync client (used in timer/blob triggers) ────────────────────────────────

@functools.lru_cache(maxsize=1)
def _sync_cosmos_client() -> _CosmosClient:
    return _CosmosClient(
        url=_get_env("COSMOS_DB_ENDPOINT"),
        credential=_get_env("COSMOS_DB_KEY"),
    )


def _sync_container(container_env_var: str, default_name: str):
    client = _sync_cosmos_client()
    db = client.get_database_client(_get_env("COSMOS_DB_DATABASE", "PluckIt"))
    return db.get_container_client(_get_env(container_env_var, default_name))


def get_wardrobe_container_sync():
    return _sync_container("COSMOS_DB_CONTAINER", "Wardrobe")


def get_user_profiles_container_sync():
    return _sync_container("COSMOS_DB_USER_PROFILES_CONTAINER", "UserProfiles")


def get_conversations_container_sync():
    return _sync_container("COSMOS_DB_CONVERSATIONS_CONTAINER", "Conversations")


def get_digests_container_sync():
    return _sync_container("COSMOS_DB_DIGESTS_CONTAINER", "Digests")


def get_moods_container_sync():
    return _sync_container("COSMOS_DB_MOODS_CONTAINER", "Moods")


# ── Async client (used in FastAPI/LangGraph routes) ──────────────────────────
# We keep a module-level instance; Azure Functions reuses the worker process
# so this is effectively a singleton within a worker.

_async_client: Optional[AsyncCosmosClient] = None


def get_async_client() -> AsyncCosmosClient:
    global _async_client
    if _async_client is None:
        _async_client = AsyncCosmosClient(
            url=_get_env("COSMOS_DB_ENDPOINT"),
            credential=_get_env("COSMOS_DB_KEY"),
        )
    return _async_client


def _async_container(container_env_var: str, default_name: str):
    client = get_async_client()
    db = client.get_database_client(_get_env("COSMOS_DB_DATABASE", "PluckIt"))
    return db.get_container_client(_get_env(container_env_var, default_name))


def get_wardrobe_container():
    return _async_container("COSMOS_DB_CONTAINER", "Wardrobe")


def get_user_profiles_container():
    return _async_container("COSMOS_DB_USER_PROFILES_CONTAINER", "UserProfiles")


def get_conversations_container():
    return _async_container("COSMOS_DB_CONVERSATIONS_CONTAINER", "Conversations")


def get_digests_container():
    return _async_container("COSMOS_DB_DIGESTS_CONTAINER", "Digests")


def get_moods_container():
    return _async_container("COSMOS_DB_MOODS_CONTAINER", "Moods")


def get_digest_feedback_container():
    return _async_container("COSMOS_DB_DIGEST_FEEDBACK_CONTAINER", "DigestFeedback")


def get_digest_feedback_container_sync():
    return _sync_container("COSMOS_DB_DIGEST_FEEDBACK_CONTAINER", "DigestFeedback")
