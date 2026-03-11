"""
Stylist LangGraph agent.

Builds a ReAct agent (create_react_agent) backed by GPT-4.1-mini with five tools:
  - search_wardrobe
  - get_wardrobe_summary
  - get_weather
  - get_user_profile
  - analyze_wardrobe_gaps

The agent streams token-by-token events which the FastAPI chat endpoint converts
to SSE for the Angular client.
"""

import json
import logging
import os
import re
from datetime import date
from functools import lru_cache
from typing import AsyncIterator, Optional

from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, SystemMessage
from langchain_core.runnables import RunnableConfig
from langchain_openai import AzureChatOpenAI
from langgraph.prebuilt import create_react_agent

from .tools.wardrobe import search_wardrobe, get_wardrobe_summary, _compact
from .tools.weather import get_weather
from .tools.profile import get_user_profile
from .tools.gaps import analyze_wardrobe_gaps
from .tools.scraped_items import search_scraped_items
from .tools.mood import get_trending_moods
from .tools.wear_patterns import get_wear_patterns
from .db import get_wardrobe_container

logger = logging.getLogger(__name__)


def _get_env(name: str, default: Optional[str] = None) -> str:
    v = os.getenv(name, default)
    if v is None:
        raise RuntimeError(f"Missing env var: {name}")
    return v


def _build_llm() -> AzureChatOpenAI:
    return AzureChatOpenAI(
        azure_endpoint=_get_env("AZURE_OPENAI_ENDPOINT"),
        api_key=_get_env("AZURE_OPENAI_API_KEY"),
        azure_deployment=_get_env("AZURE_OPENAI_DEPLOYMENT", "gpt-4.1-mini"),
        api_version="2024-12-01-preview",
        temperature=0.7,
        streaming=True,
    )


TOOLS = [search_wardrobe, get_wardrobe_summary, get_weather, get_user_profile, analyze_wardrobe_gaps, get_trending_moods, get_wear_patterns, search_scraped_items]

_SYSTEM_TEMPLATE = """\
You are PluckIt AI — a personal stylist with deep knowledge of fashion, colour theory, and personal style.
Today's date is {today}.

Your job:
- Suggest outfits using the user's actual wardrobe (use search_wardrobe or get_wardrobe_summary).
- Personalise advice based on their style preferences (use get_user_profile when you don't already
  have profile details in recent messages or memory — do NOT fetch it again if it was already loaded).
- Factor in weather when relevant (use get_weather only when the user asks about an outdoor occasion).
- Identify wardrobe gaps and suggest what to buy (use analyze_wardrobe_gaps).
- For any discovery request to buy or find new pieces (for example \"where to buy\" or \"discover this look\"), use search_scraped_items.
- Reference current fashion trends and moods when relevant (use get_trending_moods — especially
  when the user asks what's trending, describes a vibe, or wants trend-informed outfit ideas).
- Keep responses concise, warm, and actionable — you're a friend who happens to be a stylist.
- When showing outfit combinations, reference item categories/colours/brands, not blob URLs.
- Never make up items — only reference what exists in search results.
- RATIONALE REQUIRED: Every item or outfit recommendation MUST include a one-sentence rationale
  grounded in a concrete signal you have seen (e.g. wear frequency, climate context, occasion match,
  style alignment). Examples: "You've worn your black hoodie 14 times — it clearly works for you."
  or "This linen shirt suits your temperate climate and minimalist style."

CRITICAL — conversation continuity:
- ALWAYS read the full conversation history before choosing what to do.
- If the user sends a short confirmation ("yes", "sure", "go ahead", "please do", "yes please",
  "sounds good", "that'd be great", etc.) look at YOUR PREVIOUS message to know what was
  offered, then IMMEDIATELY and FULLY deliver it — call the right tool and present real results.
- Do NOT re-describe the same situation again. Do NOT ask "Would you like me to…?" again.
  You already asked; they said yes. Just do it.
- Do NOT re-run search_wardrobe when you already know what's in the wardrobe from this conversation.
- Do NOT fetch profile or weather unless genuinely needed for the current turn.

---
## FEW-SHOT EXAMPLES OF CORRECT BEHAVIOUR

### Example 1 — User confirms a gap analysis offer

Conversation so far:
  User: "What goes with my Cortiez top?"
  You: [called search_wardrobe → found 1 top, no bottoms/shoes]
  You: "Your Cortiez black mesh top is the only piece right now. Try black joggers, cargo
        shorts, and white sneakers — none of which you have yet. Want me to run a full gap
        analysis and build you a shopping list?"
  User: "Yes"

What you MUST do:
  → call analyze_wardrobe_gaps (you do NOT need to call search_wardrobe again)
  → present the gap results as a concrete shopping list, e.g.:
       "Here's what to add to complete your streetwear wardrobe:
        • Bottoms (have 0, need 4): black cargo pants, black joggers, red shorts, grey sweatpants
        • Shoes (have 0, need 3): white low-top sneakers, black high-tops, slides
        • Accessories (have 0, need 2): black cap, silver chain
        These all pair directly with your Cortiez top."
  → Do NOT end with "Would you like me to…?" or any new offer.

What you must NEVER do (wrong):
  ✗ Call search_wardrobe again and rediscover the same result.
  ✗ Say "You currently only have the Cortiez top… Would you like me to analyse gaps?"
     (You already offered; they said yes. Repeating the offer is wrong.)

### Example 2 — User confirms a search offer

Conversation so far:
  You: "I can search your wardrobe for black trousers that work with this — want me to?"
  User: "Go ahead"

What you MUST do:
  → call search_wardrobe("black trousers") and present results directly.
  → Do NOT ask again.

### Example 3 — Multi-turn: user clarifies after a yes

Conversation so far:
  You: "Want me to check your wardrobe for blazers?"
  User: "Yes but stick to casual ones"

What you MUST do:
  → call search_wardrobe("casual blazer") and present results.
  → Incorporate their clarification into the search; do not ask for permission again.
---
{memory_block}
"""
_FOLLOW_UP_PROMPT = """\
You are a conversation intent classifier for a fashion stylist chatbot.
Given the stylist's last message and the user's reply, decide if the user is
accepting/confirming an offer the stylist made.

Stylist's last message:
{last_assistant}

User's reply: {user_message}

Reply with EXACTLY one of:
  CONFIRM_GAPS, CONFIRM_SEARCH, CONFIRM_OUTFIT, NOT_A_CONFIRM
"""
_FOLLOW_UP_SEARCH_PATTERNS = (
    re.compile(r"\bsearch\b[^\n.!?]{0,90}\bfor\s+(?P<query>[^\n.!?]+)", re.IGNORECASE),
    re.compile(r"\bfind\b[^\n.!?]{0,90}\bfor\s+(?P<query>[^\n.!?]+)", re.IGNORECASE),
    re.compile(r"\blook\b[^\n.!?]{0,90}\bfor\s+(?P<query>[^\n.!?]+)", re.IGNORECASE),
    re.compile(r"\bdiscover\b\s+(?P<query>[^\n.!?]+?)\s+\bfor\b", re.IGNORECASE),
    re.compile(r"\bdiscover\b\s+(?P<query>[^\n.!?]+)", re.IGNORECASE),
    re.compile(r"\b(?:search|find|look)\b\s+(?P<query>[^\n.!?]+)", re.IGNORECASE),
)
_FOLLOW_UP_GAP_KEYWORDS = (
    "gap analysis",
    "wardrobe gaps",
    "shopping list",
    "what should i buy",
    "what to buy",
)
_FOLLOW_UP_OUTFIT_KEYWORDS = (
    "build an outfit",
    "complete outfit",
    "full outfit",
    "put together",
)

_TOOL_CALL_RECURSION_LIMIT = int(os.getenv("STYLIST_TOOL_CALL_RECURSION_LIMIT", "8"))


def _build_system_prompt(memory_summary: str) -> SystemMessage:
    memory_block = ""
    if memory_summary.strip():
        memory_block = f"\nConversation memory (what you know about this user so far):\n{memory_summary}\n"
    content = _SYSTEM_TEMPLATE.format(
        today=date.today().isoformat(),
        memory_block=memory_block,
    )
    return SystemMessage(content=content)


def _to_lc_messages(raw: list[dict]) -> list[BaseMessage]:
    """Convert frontend message dicts to LangChain message objects."""
    result = []
    for m in raw:
        role = m.get("role", "user")
        content = m.get("content", "")
        if role == "assistant":
            result.append(AIMessage(content=content))
        else:
            result.append(HumanMessage(content=content))
    return result


# Short messages that are unambiguously affirmative — zero-cost fast path.
_AFFIRMATIVES = frozenset([
    "yes", "yeah", "yep", "yup", "sure", "ok", "okay", "please", "go ahead", "go on",
    "do it", "show me", "yes please", "sounds good", "sounds great", "absolutely",
    "definitely", "of course", "why not", "let's do it", "let's go",
])


def _last_assistant_content(recent_messages: list[dict]) -> str:
    for m in reversed(recent_messages):
        if m.get("role") == "assistant":
            return m.get("content", "")
    return ""


def _get_fast_follow_up_intent(user_message: str, last_assistant: str) -> str | None:
    normalised = user_message.strip().lower().rstrip("!.? ")
    if not normalised:
        return None
    if normalised in _AFFIRMATIVES:
        lower_last = last_assistant.lower()
        if any(keyword in lower_last for keyword in _FOLLOW_UP_GAP_KEYWORDS):
            return "CONFIRM_GAPS"
        if any(keyword in lower_last for keyword in _FOLLOW_UP_OUTFIT_KEYWORDS):
            return "CONFIRM_OUTFIT"
        if "search" in lower_last or "discover" in lower_last:
            return "CONFIRM_SEARCH"
    return None


def _is_discovery_follow_up(last_assistant: str) -> bool:
    lower_last = (last_assistant or "").lower()
    if "discover" in lower_last:
        return True
    return "to buy" in lower_last or "where to buy" in lower_last


def _extract_follow_up_refinement(user_message: str) -> str:
    normalised = (user_message or "").strip().lower().rstrip("?.!")
    if not normalised:
        return ""
    for phrase in sorted(_AFFIRMATIVES, key=len, reverse=True):
        if not normalised.startswith(phrase):
            continue
        if normalised == phrase:
            return ""
        return normalised[len(phrase):].lstrip(" ,")
    return normalised


def _extract_follow_up_search_query(last_assistant: str, user_message: str) -> str:
    target_text = (last_assistant or "").replace("\\n", " ")
    query = ""
    for pattern in _FOLLOW_UP_SEARCH_PATTERNS:
        match = pattern.search(target_text)
        if match:
            found_query = match.groupdict().get("query", "").strip()
            if found_query:
                query = found_query
                break

    if not query:
        return user_message.strip()

    refinement = _extract_follow_up_refinement(user_message)
    if not refinement:
        return query
    if refinement in query.lower():
        return query
    return f"{query} {refinement}"


@lru_cache(maxsize=1)
def _build_stylist_config(user_id: str) -> RunnableConfig:
    return RunnableConfig(configurable={"user_id": user_id})


@lru_cache(maxsize=1)
def _get_follow_up_llm():
    from .db import _get_env as _db_env

    return AzureChatOpenAI(
        azure_endpoint=_db_env("AZURE_OPENAI_ENDPOINT"),
        api_key=_db_env("AZURE_OPENAI_API_KEY"),
        azure_deployment=os.getenv("AZURE_OPENAI_NANO_DEPLOYMENT",
                                  os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4.1-mini")),
        api_version="2024-12-01-preview",
        temperature=0,
        max_tokens=10,
    )


def _tool_result_event(name: str, payload: object) -> str:
    summary = str(payload)[:120] + ("..." if len(str(payload)) > 120 else "")
    return f"data: {json.dumps({'type': 'tool_result', 'name': name, 'summary': summary})}\n\n"


def _assistant_followup_response(content: str) -> str:
    return f"data: {json.dumps({'type': 'token', 'content': content})}\n\n"


def _tool_use_event(name: str) -> str:
    return f"data: {json.dumps({'type': 'tool_use', 'name': name})}\n\n"


async def _run_fast_followup(
    user_id: str,
    user_message: str,
    recent_messages: list[dict],
) -> list[str] | None:
    if not recent_messages:
        return None

    last_assistant = _last_assistant_content(recent_messages)
    intent = _get_fast_follow_up_intent(user_message, last_assistant)
    if intent is None:
        intent = await _classify_follow_up_intent(user_message, last_assistant)
    if intent is None:
        return None

    events: list[str] = []
    cfg = _build_stylist_config(user_id)

    if intent == "CONFIRM_SEARCH":
        query = _extract_follow_up_search_query(last_assistant, user_message)
        search_tool = search_scraped_items if _is_discovery_follow_up(last_assistant) else search_wardrobe
        tool_name = "search_scraped_items" if _is_discovery_follow_up(last_assistant) else "search_wardrobe"
        events.append(_tool_use_event(tool_name))
        result = await search_tool.ainvoke({"query": query}, config=cfg)
        events.append(_tool_result_event(tool_name, result))
        events.append(_assistant_followup_response(f"Done - I searched for {query!r} and can share the results."))
        return events

    if intent == "CONFIRM_GAPS":
        events.append(_tool_use_event("analyze_wardrobe_gaps"))
        result = await analyze_wardrobe_gaps.ainvoke(config=cfg)
        events.append(_tool_result_event("analyze_wardrobe_gaps", result))
        events.append(_assistant_followup_response("Done - here are your wardrobe gap results."))
        return events

    return None


async def _classify_follow_up_intent(user_message: str, last_assistant: str) -> str | None:
    """
    Nano LLM call to classify whether the user is confirming a prior offer.
    Returns one of: CONFIRM_GAPS, CONFIRM_SEARCH, CONFIRM_OUTFIT, NOT_A_CONFIRM.
    Capped at 10 output tokens — extremely cheap.
    """
    prompt = _FOLLOW_UP_PROMPT.format(
        last_assistant=last_assistant[-600:],
        user_message=user_message,
    )
    try:
        response = await _get_follow_up_llm().ainvoke(prompt)
        label = response.content.strip().upper().split()[0]
        return label if label in {"CONFIRM_GAPS", "CONFIRM_SEARCH", "CONFIRM_OUTFIT"} else None
    except Exception as exc:
        logger.warning("Follow-up classification failed: %s", exc)
        return None


_INTENT_ANNOTATION: dict[str, str] = {
    "CONFIRM_GAPS":   "[Context: the user is confirming your offer to analyse wardrobe gaps. Call analyze_wardrobe_gaps and present the full shopping list. Do not call search_wardrobe again.]",
    "CONFIRM_SEARCH": "[Context: the user is confirming your offer to search the wardrobe. Call search_wardrobe for the items mentioned in your last message.]",
    "CONFIRM_DISCOVER": "[Context: the user is confirming your offer to discover items to buy. Call search_scraped_items for the items mentioned in your last message.]",
    "CONFIRM_OUTFIT": "[Context: the user is confirming your offer to build a complete outfit. Use the items already discussed — do not re-search the wardrobe.]",
}


async def _resolve_follow_up_annotation(user_message: str, recent_messages: list[dict]) -> str | None:
    """
    Return a short context annotation to prepend to the user message when they
    are confirming a previous offer. Returns None for normal messages.
    """
    normalised = user_message.strip().lower().rstrip("!.? ")
    words = normalised.split()
    if len(words) > 12:
        return None
    last = _last_assistant_content(recent_messages)
    if not last:
        return None
    if normalised in _AFFIRMATIVES or len(words) <= 6:
        fast_intent = _get_fast_follow_up_intent(user_message, last)
        if fast_intent:
            if fast_intent == "CONFIRM_SEARCH" and _is_discovery_follow_up(last):
                return _INTENT_ANNOTATION.get("CONFIRM_DISCOVER")
            return _INTENT_ANNOTATION.get(fast_intent)
        intent = await _classify_follow_up_intent(user_message, last)
        if intent == "CONFIRM_SEARCH" and _is_discovery_follow_up(last):
            return _INTENT_ANNOTATION.get("CONFIRM_DISCOVER")
        return _INTENT_ANNOTATION.get(intent) if intent else None
    return None


async def _build_context_prefix(user_id: str, selected_item_ids: Optional[list[str]]) -> str:
    if not selected_item_ids:
        return ""

    try:
        container = get_wardrobe_container()
        fetched = []
        for item_id in selected_item_ids:
            try:
                doc = await container.read_item(item=item_id, partition_key=user_id)
                fetched.append(_compact(doc))
            except Exception:
                pass
        if not fetched:
            return ""
        items_json = json.dumps(fetched, ensure_ascii=False)
        return (
            f"The user has dragged these specific wardrobe items onto the style board "
            f"and wants to build an outfit around them:\n{items_json}\n\n"
            f"Please use these as anchor pieces and suggest a complete outfit.\n\n"
        )
    except Exception as exc:
        logger.warning("Failed to pre-fetch selected items %s: %s", selected_item_ids, exc)
        return ""


def _event_to_sse(event: dict) -> Optional[str]:
    kind = event["event"]

    if kind == "on_chat_model_stream":
        if event.get("metadata", {}).get("langgraph_node") != "agent":
            return None
        chunk = event["data"].get("chunk")
        if not chunk or not chunk.content:
            return None
        return f"data: {json.dumps({'type': 'token', 'content': chunk.content})}\n\n"

    if kind == "on_tool_start":
        tool_name = event.get("name", "tool")
        return f"data: {json.dumps({'type': 'tool_use', 'name': tool_name})}\n\n"

    if kind == "on_tool_end":
        tool_name = event.get("name", "tool")
        output = event["data"].get("output", "")
        summary = str(output)[:120] + ("…" if len(str(output)) > 120 else "")
        return f"data: {json.dumps({'type': 'tool_result', 'name': tool_name, 'summary': summary})}\n\n"

    return None


# Lazy singleton — built on first request so import succeeds without env vars
@lru_cache(maxsize=1)
def _get_agent_graph():
    llm = _build_llm()
    return create_react_agent(llm, tools=TOOLS)


async def stream_stylist_response(
    user_id: str,
    user_message: str,
    recent_messages: list[dict],
    memory_summary: str,
    selected_item_ids: Optional[list[str]] = None,
) -> AsyncIterator[str]:
    """
    Stream SSE-formatted events to the caller.

    Each yielded string is a fully-formed SSE line: `data: <json>\\n\\n`.
    Event types:
      - {"type": "token", "content": "..."}        — LLM token chunk
      - {"type": "tool_use", "name": "..."}         — tool about to be called
      - {"type": "tool_result", "name": "...", "summary": "..."}  — tool returned
      - {"type": "done"}                            — stream complete
    """
    system_msg       = _build_system_prompt(memory_summary)
    context_prefix   = await _build_context_prefix(user_id, selected_item_ids)
    # Annotate short follow-up confirmations so the agent knows which tool to reach for.
    annotation = await _resolve_follow_up_annotation(user_message, recent_messages)
    augmented_message = f"{annotation}\n{user_message}" if annotation else user_message
    fast_follow_up = await _run_fast_followup(user_id, user_message, recent_messages)
    if fast_follow_up is not None:
        for event_line in fast_follow_up:
            yield event_line
        yield f"data: {json.dumps({'type': 'done'})}\n\n"
        return

    messages: list[BaseMessage] = [
        system_msg,
        *_to_lc_messages(recent_messages),
        HumanMessage(content=context_prefix + augmented_message),
    ]

    config = {
        "configurable": {
            "user_id": user_id,
        },
        "recursion_limit": _TOOL_CALL_RECURSION_LIMIT,
    }

    tool_start_count = 0
    abort = False

    try:
        async for event in _get_agent_graph().astream_events(
            {"messages": messages},
            config=config,
            version="v2",
        ):
            if event.get("event") == "on_tool_start":
                tool_start_count += 1
                if tool_start_count > _TOOL_CALL_RECURSION_LIMIT:
                    abort = True
                    break
            event_sse = _event_to_sse(event)
            if event_sse is not None:
                yield event_sse

    except Exception as exc:
        logger.exception("Agent stream error for user %s: %s", user_id, exc)
        yield f"data: {json.dumps({'type': 'error', 'content': 'Something went wrong. Please try again.'})}\n\n"
    if abort:
        logger.warning("Tool-call recursion cap hit for user %s", user_id)
        yield f"data: {json.dumps({'type': 'error', 'content': 'Tool-call limit reached. Please retry with a shorter request.'})}\n\n"

    yield f"data: {json.dumps({'type': 'done'})}\n\n"
