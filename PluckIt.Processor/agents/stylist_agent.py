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
from datetime import date
from functools import lru_cache
from typing import AsyncIterator, Optional

from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, SystemMessage
from langchain_openai import AzureChatOpenAI
from langgraph.prebuilt import create_react_agent

from .tools.wardrobe import search_wardrobe, get_wardrobe_summary, _compact
from .tools.weather import get_weather
from .tools.profile import get_user_profile
from .tools.gaps import analyze_wardrobe_gaps
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


TOOLS = [search_wardrobe, get_wardrobe_summary, get_weather, get_user_profile, analyze_wardrobe_gaps, get_trending_moods, get_wear_patterns]

_SYSTEM_TEMPLATE = """\
You are PluckIt AI — a personal stylist with deep knowledge of fashion, colour theory, and personal style.
Today's date is {today}.

Your job:
- Suggest outfits using the user's actual wardrobe (use search_wardrobe or get_wardrobe_summary).
- Personalise advice based on their style preferences (use get_user_profile when you don't already
  have profile details in recent messages or memory — do NOT fetch it again if it was already loaded).
- Factor in weather when relevant (use get_weather only when the user asks about an outdoor occasion).
- Identify wardrobe gaps and suggest what to buy (use analyze_wardrobe_gaps).
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


async def _classify_follow_up_intent(user_message: str, last_assistant: str) -> str | None:
    """
    Nano LLM call to classify whether the user is confirming a prior offer.
    Returns one of: CONFIRM_GAPS, CONFIRM_SEARCH, CONFIRM_OUTFIT, NOT_A_CONFIRM.
    Capped at 10 output tokens — extremely cheap.
    """
    prompt = (
        "You are a conversation intent classifier for a fashion stylist chatbot.\n"
        "Given the stylist's last message and the user's reply, decide if the user is "
        "accepting/confirming an offer the stylist made.\n\n"
        f"Stylist's last message:\n{last_assistant[-600:]}\n\n"
        f"User's reply: {user_message}\n\n"
        "Reply with EXACTLY one of:\n"
        "  CONFIRM_GAPS    — user agreed to gap/buy/shopping analysis\n"
        "  CONFIRM_SEARCH  — user agreed to search wardrobe for specific pieces\n"
        "  CONFIRM_OUTFIT  — user agreed to see a full outfit built from discussed items\n"
        "  NOT_A_CONFIRM   — new question or elaboration, not confirming an offer\n\n"
        "One word only:"
    )
    try:
        from .db import _get_env as _db_env
        nano = AzureChatOpenAI(
            azure_endpoint=_db_env("AZURE_OPENAI_ENDPOINT"),
            api_key=_db_env("AZURE_OPENAI_API_KEY"),
            azure_deployment=os.getenv("AZURE_OPENAI_NANO_DEPLOYMENT", "gpt-4.1-nano"),
            api_version="2024-12-01-preview",
            temperature=0,
            max_tokens=10,
        )
        response = await nano.ainvoke(prompt)
        label = response.content.strip().upper().split()[0]
        return label if label in {"CONFIRM_GAPS", "CONFIRM_SEARCH", "CONFIRM_OUTFIT"} else None
    except Exception as exc:
        logger.warning("Follow-up classification failed: %s", exc)
        return None


_INTENT_ANNOTATION: dict[str, str] = {
    "CONFIRM_GAPS":   "[Context: the user is confirming your offer to analyse wardrobe gaps. Call analyze_wardrobe_gaps and present the full shopping list. Do not call search_wardrobe again.]",
    "CONFIRM_SEARCH": "[Context: the user is confirming your offer to search the wardrobe. Call search_wardrobe for the items mentioned in your last message.]",
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
        intent = await _classify_follow_up_intent(user_message, last)
        return _INTENT_ANNOTATION.get(intent) if intent else None
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
    system_msg = _build_system_prompt(memory_summary)

    # If specific items were selected (drag-to-board), pre-fetch from Cosmos
    # and embed their details directly so the LLM doesn't need to look up by ID.
    context_prefix = ""
    if selected_item_ids:
        try:
            container = get_wardrobe_container()
            fetched = []
            for item_id in selected_item_ids:
                try:
                    doc = await container.read_item(item=item_id, partition_key=user_id)
                    fetched.append(_compact(doc))
                except Exception:
                    pass  # item not found or access error — skip gracefully
            if fetched:
                items_json = json.dumps(fetched, ensure_ascii=False)
                context_prefix = (
                    f"The user has dragged these specific wardrobe items onto the style board "
                    f"and wants to build an outfit around them:\n{items_json}\n\n"
                    f"Please use these as anchor pieces and suggest a complete outfit.\n\n"
                )
        except Exception as exc:
            logger.warning("Failed to pre-fetch selected items %s: %s", selected_item_ids, exc)

    # Annotate short follow-up confirmations so the agent knows which tool to reach for.
    annotation = await _resolve_follow_up_annotation(user_message, recent_messages)
    augmented_message = f"{annotation}\n{user_message}" if annotation else user_message

    messages: list[BaseMessage] = [
        system_msg,
        *_to_lc_messages(recent_messages),
        HumanMessage(content=context_prefix + augmented_message),
    ]

    config = {
        "configurable": {
            "user_id": user_id,
        }
    }

    try:
        async for event in _get_agent_graph().astream_events(
            {"messages": messages},
            config=config,
            version="v2",
        ):
            kind = event["event"]

            if kind == "on_chat_model_stream":
                # Only stream tokens from the top-level agent LLM node, not from
                # nested LLM calls inside tools (e.g. _expand_query).
                if event.get("metadata", {}).get("langgraph_node") != "agent":
                    continue
                chunk = event["data"].get("chunk")
                if chunk and chunk.content:
                    yield f"data: {json.dumps({'type': 'token', 'content': chunk.content})}\n\n"

            elif kind == "on_tool_start":
                tool_name = event.get("name", "tool")
                yield f"data: {json.dumps({'type': 'tool_use', 'name': tool_name})}\n\n"

            elif kind == "on_tool_end":
                tool_name = event.get("name", "tool")
                output = event["data"].get("output", "")
                # Only send a short summary of tool output, not the full payload
                summary = str(output)[:120] + ("…" if len(str(output)) > 120 else "")
                yield f"data: {json.dumps({'type': 'tool_result', 'name': tool_name, 'summary': summary})}\n\n"

    except Exception as exc:
        logger.exception("Agent stream error for user %s: %s", user_id, exc)
        yield f"data: {json.dumps({'type': 'error', 'content': 'Something went wrong. Please try again.'})}\n\n"

    yield f"data: {json.dumps({'type': 'done'})}\n\n"
