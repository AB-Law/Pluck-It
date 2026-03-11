"""
Unit tests for agents/stylist_agent.py.
"""

import json
from unittest.mock import patch

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
