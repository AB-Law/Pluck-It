"""
Unit tests for agents/stylist_agent.py.
"""

import json
from unittest.mock import AsyncMock, patch

import pytest

from agents.stylist_agent import _event_to_sse, stream_stylist_response


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
