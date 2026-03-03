"""
Conversation memory manager.

Implements a hybrid rolling-window + summary strategy:
  - The client keeps the last N messages verbatim and sends them with each request.
  - Older context is compressed into a ~200-token summary stored in Cosmos
    (container: Conversations, partition key: /userId).
  - The summary is user-visible and editable via the memory API endpoints.
  - Summarisation uses the cheaper nano model to keep costs low.

Cosmos document schema:
  {
    "id": "<userId>",          -- document id = userId (one doc per user)
    "userId": "<userId>",      -- partition key
    "summary": "<text>",       -- editable, ~200 tokens
    "updatedAt": "<ISO>",
  }
"""

import json
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

from langchain_core.messages import BaseMessage, HumanMessage, AIMessage

from .db import get_conversations_container

logger = logging.getLogger(__name__)

# After this many total messages the oldest half is summarised.
SUMMARY_TRIGGER = 12
# Model used exclusively for cheap summarisation.
_NANO_DEPLOYMENT = os.getenv("AZURE_OPENAI_NANO_DEPLOYMENT",
                              os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4.1-mini"))


@dataclass
class ConversationMemory:
    summary: str = ""
    updated_at: Optional[str] = None

    def is_empty(self) -> bool:
        return not self.summary.strip()


async def load_memory(user_id: str) -> ConversationMemory:
    """Load conversation memory summary from Cosmos. Returns empty memory if not found."""
    try:
        container = get_conversations_container()
        item = await container.read_item(item=user_id, partition_key=user_id)
        return ConversationMemory(
            summary=item.get("summary", ""),
            updated_at=item.get("updatedAt"),
        )
    except Exception:
        return ConversationMemory()


async def save_memory(user_id: str, summary: str) -> None:
    """Upsert the memory summary for a user in Cosmos."""
    try:
        container = get_conversations_container()
        await container.upsert_item({
            "id": user_id,
            "userId": user_id,
            "summary": summary,
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        })
    except Exception as exc:
        logger.warning("Failed to save memory for user %s: %s", user_id, exc)


async def maybe_summarize(
    user_id: str,
    messages: list[dict],  # [{"role": "user"|"assistant", "content": str}, ...]
    existing_summary: str,
) -> Optional[str]:
    """
    If the message list has grown past SUMMARY_TRIGGER, compress the oldest half
    into a short summary using the nano model. Returns the new summary string,
    or None if no summarisation was needed.
    """
    if len(messages) < SUMMARY_TRIGGER:
        return None

    from .db import _get_env
    from langchain_openai import AzureChatOpenAI
    from langchain_core.messages import SystemMessage, HumanMessage as LCHuman

    nano_llm = AzureChatOpenAI(
        azure_endpoint=_get_env("AZURE_OPENAI_ENDPOINT"),
        api_key=_get_env("AZURE_OPENAI_API_KEY"),
        azure_deployment=_NANO_DEPLOYMENT,
        api_version="2024-12-01-preview",
        temperature=0,
        max_tokens=250,
    )

    # Summarise the first half of messages, keep the second half for context
    half = len(messages) // 2
    to_summarise = messages[:half]

    convo_text = "\n".join(
        f"{m['role'].upper()}: {m['content']}" for m in to_summarise
    )

    prefix = f"Existing summary:\n{existing_summary}\n\n" if existing_summary else ""
    prompt = (
        f"{prefix}New conversation to incorporate (compress into the summary below):\n"
        f"{convo_text}\n\n"
        "Write a concise 3-5 sentence summary capturing: the user's expressed style "
        "preferences, specific clothing pieces or combinations discussed, any gaps or "
        "purchase suggestions mentioned, and recurring themes. Max 200 tokens."
    )

    try:
        response = await nano_llm.ainvoke([LCHuman(content=prompt)])
        new_summary = response.content.strip()
        await save_memory(user_id, new_summary)
        return new_summary
    except Exception as exc:
        logger.warning("Summarisation failed for user %s: %s", user_id, exc)
        return None
