"""
Unit tests for agents/memory.py.

Verifies:
- load_memory returns ConversationMemory with correct fields
- save_memory calls upsert_item with correct schema
- maybe_summarize does NOT trigger below SUMMARY_TRIGGER messages
- maybe_summarize DOES trigger at/above SUMMARY_TRIGGER and calls the nano LLM
"""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from agents.memory import ConversationMemory, SUMMARY_TRIGGER, load_memory, save_memory, maybe_summarize

TEST_USER = "test-user-001"


# ── load_memory ───────────────────────────────────────────────────────────────

@pytest.mark.unit
async def test_load_memory_returns_stored_summary(mock_conversations_container):
    with patch("agents.memory.get_conversations_container", return_value=mock_conversations_container):
        memory = await load_memory(TEST_USER)

    assert memory.summary == "User prefers minimalist style."
    assert memory.updated_at == "2026-01-01T00:00:00Z"
    assert not memory.is_empty()


@pytest.mark.unit
async def test_load_memory_returns_empty_on_not_found():
    container = AsyncMock()
    container.read_item = AsyncMock(side_effect=Exception("Not found"))

    with patch("agents.memory.get_conversations_container", return_value=container):
        memory = await load_memory(TEST_USER)

    assert memory.is_empty()
    assert memory.summary == ""


# ── save_memory ───────────────────────────────────────────────────────────────

@pytest.mark.unit
async def test_save_memory_upserts_correct_schema(mock_conversations_container):
    mock_conversations_container.upsert_item = AsyncMock(return_value={})

    with patch("agents.memory.get_conversations_container", return_value=mock_conversations_container):
        await save_memory(TEST_USER, "New summary text.")

    call_args = mock_conversations_container.upsert_item.call_args[0][0]
    assert call_args["id"] == TEST_USER
    assert call_args["userId"] == TEST_USER
    assert call_args["summary"] == "New summary text."
    assert "updatedAt" in call_args


# ── maybe_summarize — threshold logic ────────────────────────────────────────

@pytest.mark.unit
async def test_maybe_summarize_does_not_trigger_below_threshold():
    """Below SUMMARY_TRIGGER messages → no LLM call, returns None."""
    messages = [{"role": "user", "content": f"msg {i}"} for i in range(SUMMARY_TRIGGER - 1)]

    result = await maybe_summarize(TEST_USER, messages, existing_summary="")
    assert result is None


@pytest.mark.unit
async def test_maybe_summarize_triggers_at_threshold():
    """At SUMMARY_TRIGGER messages → calls the nano LLM, saves memory, returns summary string."""
    messages = [
        {"role": "user" if i % 2 == 0 else "assistant", "content": f"msg {i}"}
        for i in range(SUMMARY_TRIGGER + 1)
    ]

    fake_llm_response = MagicMock()
    fake_llm_response.content = "User is into minimalist fashion and prefers neutral tones."
    fake_llm = MagicMock()
    fake_llm.ainvoke = AsyncMock(return_value=fake_llm_response)

    mock_container = AsyncMock()
    mock_container.upsert_item = AsyncMock(return_value={})

    with (
        patch("langchain_openai.AzureChatOpenAI", return_value=fake_llm),
        patch("agents.memory.get_conversations_container", return_value=mock_container),
    ):
        result = await maybe_summarize(TEST_USER, messages, existing_summary="")

    assert result is not None
    assert len(result) > 0
    mock_container.upsert_item.assert_called_once()


@pytest.mark.unit
async def test_maybe_summarize_exactly_one_below_threshold_returns_none():
    """Boundary condition: SUMMARY_TRIGGER - 1 messages should NOT trigger."""
    messages = [{"role": "user", "content": "x"} for _ in range(SUMMARY_TRIGGER - 1)]
    result = await maybe_summarize(TEST_USER, messages, existing_summary="some context")
    assert result is None
