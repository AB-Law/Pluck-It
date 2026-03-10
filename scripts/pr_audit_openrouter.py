#!/usr/bin/env python3
"""Analyze a PR diff for security, bug, and performance issues via OpenRouter (OpenAI-compatible API).

Environment variables:
  GITHUB_TOKEN         GitHub API auth (required)
  GITHUB_REPOSITORY    owner/repo (required)
  PR_NUMBER            Pull request number (required)
  OPENROUTER_API_KEY   OpenRouter API key (required)
  OPENROUTER_MODEL     Model ID, e.g. stepfun/step-3.5-flash:free (required)
  OPENROUTER_ENDPOINT  API endpoint (default: https://openrouter.ai/api/v1/chat/completions)
  OPENROUTER_MODES     Comma-separated modes to run (default: security,bugs,performance)
  MAX_DIFF_CHARS       Max diff chars sent per mode (default: 80000)
  TIMEOUT_SECONDS      HTTP timeout per call (default: 180)

Outputs findings.json as an array (consumed by comment-pr-findings.js).
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from typing import Any, Dict, List, Optional, Tuple
from urllib import error, request

# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

SYSTEM_PROMPTS: Dict[str, str] = {
    "security": (
        "You are a senior application security engineer. "
        "Review only the provided PR diff for concrete security vulnerabilities. "
        "Focus on the added/changed lines (lines starting with +). "
        "Prefer precision over recall. Avoid speculative findings. "
        "Return JSON only."
    ),
    "bugs": (
        "You are a senior software engineer performing a bug hunt. "
        "Review only the provided PR diff for concrete implementation bugs and regressions. "
        "Focus on the added/changed lines (lines starting with +). "
        "Prefer precision over recall. Avoid speculative findings. "
        "Return JSON only."
    ),
    "performance": (
        "You are a senior performance engineer. "
        "Review only the provided PR diff for concrete performance issues. "
        "Focus on high-impact, realistic improvements (caching, pagination, batching, N+1 patterns). "
        "Focus on the added/changed lines (lines starting with +). "
        "Prefer precision over recall. Avoid speculative findings. "
        "Return JSON only."
    ),
}

MODE_FOCUS: Dict[str, Tuple[str, str, str]] = {
    # mode -> (focus sentence, category_example, empty_guidance)
    "security": (
        "Identify concrete security vulnerabilities (HIGH and MEDIUM preferred).",
        "command_injection",
        'If no vulnerabilities are found, return {"findings": [], "analysis_summary": ...}.',
    ),
    "bugs": (
        "Identify concrete implementation bugs and regressions (HIGH and MEDIUM preferred).",
        "logic_error",
        'If no bugs are found, return {"findings": [], "analysis_summary": ...}.',
    ),
    "performance": (
        "Identify concrete performance issues (HIGH and MEDIUM preferred): "
        "caching, missing pagination, N+1, over-fetching, inefficient loops/queries.",
        "missing_pagination",
        'If no performance findings are found, return {"findings": [], "analysis_summary": ...}.',
    ),
}


def build_user_prompt(diff: str, mode: str) -> str:
    focus, category_example, empty_guidance = MODE_FOCUS[mode]
    return f"""Review the following PR diff for mode: {mode}.

{focus}
Do not report style issues, theoretical concerns, or generic best practices.
Reference the exact file path and the line number from the diff (new-file line numbers).

Return exactly this JSON schema:
{{
  "findings": [
    {{
      "file": "path/to/file.py",
      "line": 42,
      "severity": "HIGH",
      "category": "{category_example}",
      "description": "short description",
      "exploit_scenario": "realistic scenario",
      "recommendation": "specific fix",
      "confidence": 0.9
    }}
  ],
  "analysis_summary": {{
    "files_reviewed": 0,
    "high_severity": 0,
    "medium_severity": 0,
    "low_severity": 0,
    "review_completed": true
  }}
}}

{empty_guidance}

PR Diff:
{diff}
""".strip()


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def call_openrouter(
    endpoint: str,
    api_key: str,
    model: str,
    system_prompt: str,
    user_prompt: str,
    timeout_seconds: int,
    max_retries: int = 3,
) -> Dict[str, Any]:
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0,
    }
    encoded = json.dumps(payload).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
        "HTTP-Referer": "https://github.com",
    }

    last_exc: Exception = RuntimeError("No attempts made")
    for attempt in range(1, max_retries + 1):
        try:
            req = request.Request(endpoint, data=encoded, headers=headers, method="POST")
            with request.urlopen(req, timeout=timeout_seconds) as resp:
                body = resp.read().decode("utf-8")
            data = json.loads(body)
            content = data["choices"][0]["message"]["content"]
            return extract_json(content)
        except Exception as exc:
            last_exc = exc
            if attempt < max_retries:
                wait = 5 * attempt
                print(f"[warn] Attempt {attempt}/{max_retries} failed ({exc}), retrying in {wait}s...")
                time.sleep(wait)
            else:
                print(f"[warn] All {max_retries} attempts failed: {exc}")

    raise last_exc


def github_get(url: str, token: str, accept: Optional[str] = None) -> Any:
    headers: Dict[str, str] = {
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if accept:
        headers["Accept"] = accept
    req = request.Request(url, headers=headers)
    with request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8")


# ---------------------------------------------------------------------------
# JSON extraction (robust fallback)
# ---------------------------------------------------------------------------

def extract_json(text: str) -> Dict[str, Any]:
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    for candidate in re.findall(r"```(?:json)?\s*([\s\S]*?)\s*```", text, re.IGNORECASE):
        try:
            obj = json.loads(candidate.strip())
            if isinstance(obj, dict) and "findings" in obj:
                return obj
        except json.JSONDecodeError:
            continue

    decoder = json.JSONDecoder()
    start = text.find("{")
    while start != -1:
        try:
            obj, _ = decoder.raw_decode(text[start:])
            if isinstance(obj, dict) and "findings" in obj:
                return obj
        except json.JSONDecodeError:
            pass
        start = text.find("{", start + 1)

    raise ValueError(f"No valid JSON with 'findings' key found. Response snippet: {text[:500]}")


# ---------------------------------------------------------------------------
# Finding normalization + dedup
# ---------------------------------------------------------------------------

def normalize(raw: Dict[str, Any], mode: str) -> Optional[Dict[str, Any]]:
    file_path = str(raw.get("file", "")).strip()
    if not file_path:
        return None
    try:
        line = max(1, int(raw.get("line", 1)))
    except (TypeError, ValueError):
        line = 1
    severity = str(raw.get("severity", "MEDIUM")).upper().strip()
    if severity not in {"HIGH", "MEDIUM", "LOW"}:
        severity = "MEDIUM"
    try:
        confidence = max(0.0, min(1.0, float(raw.get("confidence", 0.6))))
    except (TypeError, ValueError):
        confidence = 0.6
    return {
        "file": file_path,
        "line": line,
        "severity": severity,
        "category": str(raw.get("category", "unknown")).strip() or "unknown",
        "description": str(raw.get("description", "")).strip() or "No description",
        "exploit_scenario": str(raw.get("exploit_scenario", "")).strip() or "Not provided",
        "recommendation": str(raw.get("recommendation", "")).strip() or "Not provided",
        "confidence": confidence,
        "mode": mode,
    }


def dedupe(findings: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = set()
    result: List[Dict[str, Any]] = []
    for f in findings:
        key = (f["file"], f["line"], f["category"].lower(), f["description"][:80].lower())
        if key not in seen:
            seen.add(key)
            result.append(f)
    return result


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    token = os.environ.get("GITHUB_TOKEN", "")
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    pr_number = os.environ.get("PR_NUMBER", "")
    api_key = os.environ.get("OPENROUTER_API_KEY", "")
    model = os.environ.get("OPENROUTER_MODEL", "")
    endpoint = os.environ.get("OPENROUTER_ENDPOINT", "https://openrouter.ai/api/v1/chat/completions")
    modes_str = os.environ.get("OPENROUTER_MODES", "security,bugs,performance")
    max_diff_chars = int(os.environ.get("MAX_DIFF_CHARS", "80000"))
    timeout_seconds = int(os.environ.get("TIMEOUT_SECONDS", "300"))

    for name, val in [("GITHUB_TOKEN", token), ("GITHUB_REPOSITORY", repo),
                      ("PR_NUMBER", pr_number), ("OPENROUTER_API_KEY", api_key),
                      ("OPENROUTER_MODEL", model)]:
        if not val:
            print(f"[error] {name} is required", file=sys.stderr)
            return 2

    modes = [m.strip() for m in modes_str.split(",") if m.strip() in SYSTEM_PROMPTS]
    if not modes:
        print("[error] No valid modes specified. Use: security, bugs, performance", file=sys.stderr)
        return 2

    # Fetch PR diff
    diff_url = f"https://api.github.com/repos/{repo}/pulls/{pr_number}"
    print(f"[info] Fetching PR diff for {repo}#{pr_number}")
    try:
        diff = github_get(diff_url, token, accept="application/vnd.github.diff")
    except error.HTTPError as e:
        print(f"[error] Failed to fetch PR diff: {e}", file=sys.stderr)
        return 1

    if len(diff) > max_diff_chars:
        print(f"[info] Diff truncated from {len(diff)} to {max_diff_chars} chars")
        diff = diff[:max_diff_chars]

    if not diff.strip():
        print("[info] Empty diff — no files changed. Writing empty findings.json")
        with open("findings.json", "w") as f:
            json.dump([], f)
        return 0

    all_findings: List[Dict[str, Any]] = []

    for mode in modes:
        print(f"[info] Running {mode} analysis via {model}...")
        user_prompt = build_user_prompt(diff, mode)
        try:
            result = call_openrouter(
                endpoint=endpoint,
                api_key=api_key,
                model=model,
                system_prompt=SYSTEM_PROMPTS[mode],
                user_prompt=user_prompt,
                timeout_seconds=timeout_seconds,
            )
        except Exception as exc:
            print(f"[error] {mode} analysis failed after retries: {exc}", file=sys.stderr)
            print(f"[info] Skipping {mode} mode and continuing with remaining modes")
            continue

        raw_findings = result.get("findings", []) if isinstance(result, dict) else []
        normalized = [normalize(r, mode) for r in raw_findings if isinstance(r, dict)]
        findings = [f for f in normalized if f is not None]
        print(f"[info] {mode}: {len(findings)} findings")
        all_findings.extend(findings)

    all_findings = dedupe(all_findings)
    print(f"[info] Total findings after dedup: {len(all_findings)}")

    with open("findings.json", "w", encoding="utf-8") as f:
        json.dump(all_findings, f, indent=2)
    print(f"[info] Wrote findings.json ({len(all_findings)} findings)")

    return 0





if __name__ == "__main__":
    sys.exit(main())
