"""
Unit tests for agents/stylist_agent.py.
"""

import json
import os
import sys
import types
import uuid
from contextlib import contextmanager
from unittest.mock import AsyncMock, patch

import pytest

from agents.stylist_agent import (
    _event_to_sse,
    _normalize_langfuse_trace_id,
    _build_langfuse_callbacks,
    _flush_langfuse_callbacks,
    stream_stylist_response,
)


def test_normalize_langfuse_trace_id_accepts_uuid_and_returns_hex() -> None:
    assert _normalize_langfuse_trace_id("b46d215b-9eba-4eb2-9595-915884fda7e8") == uuid.UUID("b46d215b-9eba-4eb2-9595-915884fda7e8").hex


def test_build_langfuse_callbacks_is_noop_when_keys_missing() -> None:
    with patch.dict(os.environ, {"LANGFUSE_PUBLIC_KEY": "", "LANGFUSE_SECRET_KEY": "", "LANGFUSE_HOST": ""}):
        assert _build_langfuse_callbacks("trace-id") == []


def test_build_langfuse_callbacks_builds_when_signature_matches() -> None:
    calls = {}

    class FakeLangfuse:
        def __init__(self, *, public_key: str, secret_key: str, base_url: str | None = None) -> None:
            calls["langfuse_init"] = (public_key, secret_key, base_url)
            self.tracing_enabled = True

        def flush(self) -> None:
            calls["client_flush_called"] = True

    class FakeCallback:
        def __init__(
            self,
            *,
            public_key: str,
            secret_key: str,
            host: str | None = None,
            session_id: str | None = None,
            user_id: str | None = None,
            metadata: dict[str, str] | None = None,
            trace_context: dict[str, str] | None = None,
        ) -> None:
            calls["callback_init"] = {
                "public_key": public_key,
                "secret_key": secret_key,
                "host": host,
                "session_id": session_id,
                "user_id": user_id,
                "metadata": metadata,
                "trace_context": trace_context,
            }
            self._langfuse_client = FakeLangfuse(public_key=public_key, secret_key=secret_key, base_url=host)

        def flush(self) -> None:
            calls["callback_flush_called"] = True

    @contextmanager
    def fake_propagate_attributes(**_kwargs):
        yield

    fake_langfuse_module = types.ModuleType("langfuse")
    fake_langfuse_module.Langfuse = FakeLangfuse
    fake_langfuse_module.propagate_attributes = fake_propagate_attributes

    fake_langfuse_langchain_module = types.ModuleType("langfuse.langchain")
    fake_langfuse_langchain_module.CallbackHandler = FakeCallback

    with (
        patch.dict(sys.modules, {"langfuse": fake_langfuse_module, "langfuse.langchain": fake_langfuse_langchain_module}),
        patch.dict(os.environ, {"LANGFUSE_PUBLIC_KEY": "pk-test", "LANGFUSE_SECRET_KEY": "sk-test", "LANGFUSE_HOST": "https://us.cloud.langfuse.com"}),
    ):
        callbacks = _build_langfuse_callbacks(
            "b46d215b-9eba-4eb2-9595-915884fda7e8",
            user_id="test-user",
        )

    assert len(callbacks) == 1
    assert calls["callback_init"]["public_key"] == "pk-test"
    assert calls["callback_init"]["secret_key"] == "sk-test"
    assert calls["callback_init"]["host"] == "https://us.cloud.langfuse.com"
    assert calls["callback_init"]["user_id"] == "test-user"
    assert calls["callback_init"]["session_id"] == uuid.UUID("b46d215b-9eba-4eb2-9595-915884fda7e8").hex
    assert calls["callback_init"]["metadata"] == {"trace_id": uuid.UUID("b46d215b-9eba-4eb2-9595-915884fda7e8").hex}
    assert calls["callback_init"]["trace_context"] == {"trace_id": uuid.UUID("b46d215b-9eba-4eb2-9595-915884fda7e8").hex}
    _flush_langfuse_callbacks(callbacks)
    assert calls["client_flush_called"] is True


def _parse_sse(event_line: str) -> dict:
    return json.loads(event_line.removeprefix("data: ").strip())


@pytest.mark.unit
def test_discovery_tool_event_names_are_continuous() -> None:
    start = _parse_sse(_event_to_sse({
        "event": "on_tool_start",
        "name": "search_scraped_items",
        "data": {},
    }))
    end = _parse_sse(_event_to_sse({
        "event": "on_tool_end",
        "name": "search_scraped_items",
        "data": {"output": {"items": []}},
    }))

    assert start["type"] == "tool_use"
    assert end["type"] == "tool_result"
    assert start["name"] == end["name"] == "search_scraped_items"


@pytest.mark.unit
async def test_stream_stylist_response_emits_discovery_tool_events() -> None:
    class _FakeAgentGraph:
        def __init__(self) -> None:
            self.received_payload = None

        async def astream_events(self, payload, config=None, version=None):
            self.received_payload = payload
            yield {
                "event": "on_tool_start",
                "name": "search_scraped_items",
                "data": {"query": "linen weekend blazer"},
            }
            yield {
                "event": "on_tool_end",
                "name": "search_scraped_items",
                "data": {"output": {"items": [{"title": "Sample Item"}]}},
            }

    fake_graph = _FakeAgentGraph()

    with patch("agents.stylist_agent._get_agent_graph", return_value=fake_graph):
        events = []
        async for event_line in stream_stylist_response(
            user_id="user-1",
            user_message="I want to discover linen blazers to buy for a spring trip",
            recent_messages=[],
            memory_summary="",
        ):
            events.append(_parse_sse(event_line))

    assert len(events) >= 3
    assert events[0]["type"] == "tool_use"
    assert events[0]["name"] == "search_scraped_items"
    assert events[1]["type"] == "tool_result"
    assert events[1]["name"] == "search_scraped_items"
    assert events[-1]["type"] == "done"

    assert fake_graph.received_payload is not None
    last_message = fake_graph.received_payload["messages"][-1]
    assert "discover" in last_message.content.lower()
    assert "buy" in last_message.content.lower()


@pytest.mark.unit
async def test_stream_stylist_response_fast_followup_skips_graph_for_search_confirmation() -> None:
    def _fake_ainvoke(payload, config=None):
        return "search result: denim blazer"

    search_tool_stub = type("ToolStub", (), {"ainvoke": AsyncMock(side_effect=_fake_ainvoke)})
    with (
        patch("agents.stylist_agent._get_agent_graph") as mock_graph,
        patch("agents.stylist_agent.search_wardrobe", new=search_tool_stub),
    ):
        events = []
        async for event_line in stream_stylist_response(
            user_id="user-1",
            user_message="yes",
            recent_messages=[{"role": "assistant", "content": "Want me to search your wardrobe for denim blazers?"}],
            memory_summary="",
        ):
            events.append(_parse_sse(event_line))

    assert mock_graph.call_count == 0
    assert events[0]["type"] == "tool_use"
    assert events[0]["name"] == "search_wardrobe"
    assert events[1]["type"] == "tool_result"
    assert events[1]["name"] == "search_wardrobe"
    assert events[2]["type"] == "token"
    assert events[-1]["type"] == "done"


@pytest.mark.unit
async def test_stream_stylist_response_fast_followup_discovery_routes_to_scraped_search() -> None:
    captured = {}

    def _fake_ainvoke(payload, config=None):
        captured["payload"] = payload
        return "scraped search result"

    search_tool_stub = type("ToolStub", (), {"ainvoke": AsyncMock(side_effect=_fake_ainvoke)})
    with (
        patch("agents.stylist_agent._get_agent_graph") as mock_graph,
        patch("agents.stylist_agent.search_scraped_items", new=search_tool_stub),
        patch("agents.stylist_agent.search_wardrobe", new=search_tool_stub),
        patch("agents.stylist_agent._classify_follow_up_intent", return_value="CONFIRM_SEARCH"),
    ):
        events = []
        async for event_line in stream_stylist_response(
            user_id="user-1",
            user_message="Yes, make it casual",
            recent_messages=[{"role": "assistant", "content": "Want me to discover denim blazers for your spring trip?"}],
            memory_summary="",
        ):
            events.append(_parse_sse(event_line))

    assert mock_graph.call_count == 0
    assert events[0]["type"] == "tool_use"
    assert events[0]["name"] == "search_scraped_items"
    assert events[1]["type"] == "tool_result"
    assert events[1]["name"] == "search_scraped_items"
    assert captured["payload"]["query"] != "denim blazers"
    assert "denim blazers" in captured["payload"]["query"]
    assert "casual" in captured["payload"]["query"]
    assert events[-1]["type"] == "done"


@pytest.mark.unit
async def test_stream_stylist_response_fast_followup_passes_langfuse_callbacks_to_tools() -> None:
    captured = {}
    fake_callback = object()

    def _fake_ainvoke(payload, config=None):
        captured["config"] = config
        return "wardrobe search result"

    search_tool_stub = type("ToolStub", (), {"ainvoke": AsyncMock(side_effect=_fake_ainvoke)})
    with (
        patch("agents.stylist_agent._get_agent_graph") as mock_graph,
        patch("agents.stylist_agent._build_langfuse_callbacks", return_value=[fake_callback]),
        patch("agents.stylist_agent.search_wardrobe", new=search_tool_stub),
    ):
        events = []
        async for event_line in stream_stylist_response(
            user_id="user-1",
            user_message="yes",
            recent_messages=[{"role": "assistant", "content": "Want me to search your wardrobe for denim blazers?"}],
            memory_summary="",
        ):
            events.append(_parse_sse(event_line))

    assert mock_graph.call_count == 0
    assert captured["config"]["callbacks"] == [fake_callback]
    assert captured["config"]["configurable"]["user_id"] == "user-1"
    assert events[0]["type"] == "tool_use"
    assert events[0]["name"] == "search_wardrobe"
    assert events[1]["type"] == "tool_result"
    assert events[1]["name"] == "search_wardrobe"
    assert events[-1]["type"] == "done"


@pytest.mark.unit
async def test_stream_stylist_response_fast_followup_skips_graph_for_gap_confirmation() -> None:
    def _fake_ainvoke(config=None):
        return "wardrobe gap list"

    gap_tool_stub = type("ToolStub", (), {"ainvoke": AsyncMock(side_effect=_fake_ainvoke)})
    with (
        patch("agents.stylist_agent._get_agent_graph") as mock_graph,
        patch("agents.stylist_agent.analyze_wardrobe_gaps", new=gap_tool_stub),
    ):
        events = []
        async for event_line in stream_stylist_response(
            user_id="user-1",
            user_message="Yes",
            recent_messages=[{"role": "assistant", "content": "Want me to run a wardrobe gap analysis and build a shopping list?"}],
            memory_summary="",
        ):
            events.append(_parse_sse(event_line))

    assert mock_graph.call_count == 0
    assert events[0]["type"] == "tool_use"
    assert events[0]["name"] == "analyze_wardrobe_gaps"
    assert events[1]["type"] == "tool_result"
    assert events[1]["name"] == "analyze_wardrobe_gaps"
    assert events[2]["type"] == "token"
    assert events[-1]["type"] == "done"


@pytest.mark.unit
async def test_stream_stylist_response_fast_followup_uses_last_query_for_search_confirmation() -> None:
    captured = {}

    def _fake_ainvoke(payload, config=None):
        captured["payload"] = payload
        return "search result"

    search_tool_stub = type("ToolStub", (), {"ainvoke": AsyncMock(side_effect=_fake_ainvoke)})
    with (
        patch("agents.stylist_agent._get_agent_graph") as mock_graph,
        patch("agents.stylist_agent.search_wardrobe", new=search_tool_stub),
        patch("agents.stylist_agent._classify_follow_up_intent", return_value="CONFIRM_SEARCH"),
    ):
        events = []
        async for event_line in stream_stylist_response(
            user_id="user-1",
            user_message="Yes, make it casual",
            recent_messages=[{"role": "assistant", "content": "Want me to search your wardrobe for denim blazers?"}],
            memory_summary="",
        ):
            events.append(_parse_sse(event_line))

    assert mock_graph.call_count == 0
    assert captured["payload"]["query"] != "denim blazers"
    assert "denim blazers" in captured["payload"]["query"]
    assert "casual" in captured["payload"]["query"]
    assert events[2]["type"] == "token"
    assert events[0]["type"] == "tool_use"
    assert events[1]["type"] == "tool_result"


@pytest.mark.unit
async def test_stream_stylist_response_enforces_tool_call_cap() -> None:
    class _LoopingAgentGraph:
        async def astream_events(self, payload, config=None, version=None):
            for idx in range(3):
                yield {
                    "event": "on_tool_start",
                    "name": f"tool-{idx}",
                }
                yield {
                    "event": "on_tool_end",
                    "name": f"tool-{idx}",
                    "data": {"output": "ok"},
                }

    with (
        patch("agents.stylist_agent._TOOL_CALL_RECURSION_LIMIT", 1),
        patch("agents.stylist_agent._get_agent_graph", return_value=_LoopingAgentGraph()),
    ):
        events = []
        async for event_line in stream_stylist_response(
            user_id="user-1",
            user_message="Tell me about jackets for this season",
            recent_messages=[],
            memory_summary="",
        ):
            events.append(_parse_sse(event_line))

    event_types = [e["type"] for e in events]
    error_events = [e for e in events if e["type"] == "error"]
    assert error_events[-1]["content"] == "Tool-call limit reached. Please retry with a shorter request."
    tool_use_count = len([e for e in events if e["type"] == "tool_use"])
    assert tool_use_count <= 1
    assert event_types[-1] == "done"
