#!/usr/bin/env python3
"""Run a local repo audit (security, bugs, or performance) against an OpenAI-compatible endpoint."""

from __future__ import annotations

import argparse
from concurrent.futures import Future, ThreadPoolExecutor, as_completed
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Sequence, Tuple
from urllib import error, request

DEFAULT_EXCLUDE_DIRS = {
    ".git",
    ".venv",
    "venv",
    "node_modules",
    "bin",
    "obj",
    "build",
    "dist",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".idea",
    ".vscode",
}

DEFAULT_EXTENSIONS = {
    ".py",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".cs",
    ".go",
    ".java",
    ".rb",
    ".php",
    ".rs",
    ".sh",
    ".yml",
    ".yaml",
    ".json",
    ".sql",
    ".tf",
    ".bicep",
    ".md",
}

SYSTEM_PROMPTS = {
    "security": (
        "You are a senior application security engineer. "
        "Review only the provided repository snippets for concrete vulnerabilities. "
        "Prefer precision over recall. Avoid speculative findings. "
        "Return JSON only."
    ),
    "bugs": (
        "You are a senior software engineer performing a bug hunt. "
        "Review only the provided repository snippets for concrete implementation bugs and regressions. "
        "Prefer precision over recall. Avoid speculative findings. "
        "Return JSON only."
    ),
    "performance": (
        "You are a senior performance engineer. "
        "Review only the provided repository snippets for concrete performance issues and optimization opportunities. "
        "Focus on high-impact, realistic improvements (e.g., caching, pagination, batching, query/index usage, reducing N+1 patterns). "
        "Prefer precision over recall. Avoid speculative findings. "
        "Return JSON only."
    ),
}


@dataclass
class Finding:
    file: str
    line: int
    severity: str
    category: str
    description: str
    exploit_scenario: str
    recommendation: str
    confidence: float

    def to_dict(self) -> Dict[str, Any]:
        return {
            "file": self.file,
            "line": self.line,
            "severity": self.severity,
            "category": self.category,
            "description": self.description,
            "exploit_scenario": self.exploit_scenario,
            "recommendation": self.recommendation,
            "confidence": self.confidence,
        }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Local full-repo audit (security, bugs, or performance) via OpenAI-compatible API")
    parser.add_argument("--repo-path", default=".", help="Path to repository to scan")
    parser.add_argument("--endpoint", default="http://127.0.0.1:1234/v1/chat/completions", help="OpenAI-compatible chat completions endpoint")
    parser.add_argument("--endpoints", default="", help="Comma-separated OpenAI-compatible endpoints for parallel processing")
    parser.add_argument("--model", required=True, help="Model id loaded in LM Studio")
    parser.add_argument("--models", default="", help="Comma-separated model ids to round-robin across endpoints/chunks")
    parser.add_argument("--mode", choices=["security", "bugs", "performance"], default="security", help="Analysis mode")
    parser.add_argument("--api-key", default=os.environ.get("OPENAI_API_KEY", "lm-studio"), help="Bearer token for endpoint")
    parser.add_argument("--workers", type=int, default=1, help="Number of concurrent chunk workers")
    parser.add_argument("--max-file-chars", type=int, default=6000, help="Max chars per file included in prompt")
    parser.add_argument("--max-chunk-chars", type=int, default=26000, help="Max chars per model request chunk")
    parser.add_argument("--temperature", type=float, default=0.1)
    parser.add_argument("--top-p", type=float, default=0.95)
    parser.add_argument("--timeout-seconds", type=int, default=180)
    parser.add_argument("--sleep-seconds", type=float, default=0.2)
    parser.add_argument("--extensions", default=",".join(sorted(DEFAULT_EXTENSIONS)), help="Comma-separated extensions to include")
    parser.add_argument("--exclude-dirs", default=",".join(sorted(DEFAULT_EXCLUDE_DIRS)), help="Comma-separated directories to exclude")
    parser.add_argument("--output", default="security-findings.local.json", help="Output JSON file path")
    parser.add_argument("--checkpoint", default="", help="Checkpoint JSON path (default: <output>.checkpoint.json)")
    parser.add_argument("--resume", action="store_true", help="Resume from checkpoint if it exists")
    return parser.parse_args()


def iter_source_files(repo: Path, include_exts: Sequence[str], exclude_dirs: Sequence[str]) -> Iterable[Path]:
    include = {e if e.startswith(".") else f".{e}" for e in include_exts if e}
    excludes = set(exclude_dirs)

    for root, dirs, files in os.walk(repo):
        dirs[:] = [d for d in dirs if d not in excludes and not d.startswith(".")]
        root_path = Path(root)
        for filename in files:
            path = root_path / filename
            if path.suffix.lower() not in include:
                continue
            yield path


def is_probably_binary(blob: bytes) -> bool:
    return b"\x00" in blob


def read_text_file(path: Path) -> Tuple[bool, str]:
    try:
        data = path.read_bytes()
    except OSError:
        return False, ""
    if is_probably_binary(data):
        return False, ""
    try:
        return True, data.decode("utf-8")
    except UnicodeDecodeError:
        try:
            return True, data.decode("latin-1")
        except UnicodeDecodeError:
            return False, ""


def number_lines(text: str) -> str:
    return "\n".join(f"{idx + 1}: {line}" for idx, line in enumerate(text.splitlines()))


def build_file_snippets(repo: Path, args: argparse.Namespace) -> List[Tuple[str, str]]:
    include_exts = [s.strip() for s in args.extensions.split(",") if s.strip()]
    exclude_dirs = [s.strip() for s in args.exclude_dirs.split(",") if s.strip()]

    snippets: List[Tuple[str, str]] = []
    for path in iter_source_files(repo, include_exts, exclude_dirs):
        ok, content = read_text_file(path)
        if not ok or not content.strip():
            continue

        rel = path.relative_to(repo).as_posix()
        trimmed = content[: args.max_file_chars]
        truncated = "\n# NOTE: file content truncated for token budget." if len(content) > len(trimmed) else ""
        numbered = number_lines(trimmed)
        snippet = f"FILE: {rel}\n```\n{numbered}\n```{truncated}\n"
        snippets.append((rel, snippet))

    snippets.sort(key=lambda x: x[0])
    return snippets


def chunk_snippets(snippets: Sequence[Tuple[str, str]], max_chunk_chars: int) -> List[str]:
    chunks: List[str] = []
    current: List[str] = []
    current_len = 0

    for _, snippet in snippets:
        size = len(snippet)
        if current and current_len + size > max_chunk_chars:
            chunks.append("\n".join(current))
            current = []
            current_len = 0
        current.append(snippet)
        current_len += size

    if current:
        chunks.append("\n".join(current))

    return chunks


def build_user_prompt(repo_name: str, chunk_index: int, total_chunks: int, chunk_payload: str, mode: str) -> str:
    if mode == "bugs":
        focus = "Identify concrete implementation bugs and regressions (HIGH and MEDIUM preferred)."
        category_example = "logic_error"
        empty_guidance = 'If no bugs are found, return {{"findings": [], "analysis_summary": ...}}.'
    elif mode == "performance":
        focus = (
            "Identify concrete performance issues and optimization opportunities "
            "(HIGH and MEDIUM preferred): caching opportunities, missing pagination, N+1 patterns, "
            "over-fetching, inefficient loops/queries, repeated expensive computation."
        )
        category_example = "missing_pagination"
        empty_guidance = 'If no performance findings are found, return {{"findings": [], "analysis_summary": ...}}.'
    else:
        focus = "Identify concrete security vulnerabilities (HIGH and MEDIUM preferred)."
        category_example = "command_injection"
        empty_guidance = 'If no vulnerabilities are found, return {{"findings": [], "analysis_summary": ...}}.'

    return f"""
You are reviewing repository "{repo_name}".
Chunk {chunk_index} of {total_chunks}.

{focus}
Do not report style issues, theoretical concerns, or generic best practices.

Return exactly this JSON schema:
{{
  "findings": [
    {{
      "file": "path/to/file.py",
      "line": 42,
      "severity": "HIGH",
      "category": "{category_example}",
      "description": "short description",
      "exploit_scenario": "realistic exploit path",
      "recommendation": "specific fix",
      "confidence": 0.0
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

Repository snippets for this chunk:
{chunk_payload}
""".strip()


def extract_first_json_blob(text: str) -> Dict[str, Any]:
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    fenced_candidates = re.findall(r"```(?:json)?\s*([\s\S]*?)\s*```", text, flags=re.IGNORECASE)
    for candidate in fenced_candidates:
        candidate = candidate.strip()
        try:
            obj = json.loads(candidate)
            if isinstance(obj, dict):
                if "findings" in obj:
                    return obj
                fallback_obj = obj
                # Keep trying other fenced blocks in case a better candidate exists.
                continue
        except json.JSONDecodeError:
            continue
    if "fallback_obj" in locals():
        return fallback_obj

    decoder = json.JSONDecoder()
    start = text.find("{")
    while start != -1:
        try:
            obj, _ = decoder.raw_decode(text[start:])
            if isinstance(obj, dict):
                if "findings" in obj:
                    return obj
                fallback_obj = obj
        except json.JSONDecodeError:
            pass
        start = text.find("{", start + 1)

    if "fallback_obj" in locals():
        return fallback_obj

    raise ValueError("No valid JSON object found in model response")


def call_chat_completion(
    endpoint: str,
    api_key: str,
    model: str,
    system_prompt: str,
    user_prompt: str,
    temperature: float,
    top_p: float,
    timeout_seconds: int,
) -> Dict[str, Any]:
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": temperature,
        "top_p": top_p,
    }

    req = request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )

    with request.urlopen(req, timeout=timeout_seconds) as resp:
        body = resp.read().decode("utf-8")

    try:
        data = json.loads(body)
    except json.JSONDecodeError as exc:
        snippet = body[:1000].replace("\n", "\\n")
        raise ValueError(f"Endpoint returned non-JSON payload: {exc}. Body snippet: {snippet}") from exc

    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        snippet = json.dumps(data, indent=2)[:1000].replace("\n", "\\n")
        raise ValueError(f"Unexpected chat completion response shape. Payload snippet: {snippet}") from exc

    try:
        return extract_first_json_blob(content)
    except ValueError as exc:
        preview = str(content)[:1200].replace("\n", "\\n")
        raise ValueError(f"{exc}. Model content snippet: {preview}") from exc


def normalize_finding(raw: Dict[str, Any]) -> Finding | None:
    file_path = str(raw.get("file", "")).strip()
    if not file_path:
        return None

    try:
        line = int(raw.get("line", 1))
    except (TypeError, ValueError):
        line = 1

    try:
        confidence = float(raw.get("confidence", 0.6))
    except (TypeError, ValueError):
        confidence = 0.6

    severity = str(raw.get("severity", "MEDIUM")).upper().strip() or "MEDIUM"
    if severity not in {"HIGH", "MEDIUM", "LOW"}:
        severity = "MEDIUM"

    return Finding(
        file=file_path,
        line=max(1, line),
        severity=severity,
        category=str(raw.get("category", "unknown")).strip() or "unknown",
        description=str(raw.get("description", "")).strip() or "No description provided",
        exploit_scenario=str(raw.get("exploit_scenario", "")).strip() or "Not provided",
        recommendation=str(raw.get("recommendation", "")).strip() or "Not provided",
        confidence=max(0.0, min(1.0, confidence)),
    )


def dedupe_findings(findings: Sequence[Finding]) -> List[Finding]:
    seen = set()
    unique: List[Finding] = []
    for f in findings:
        key = (f.file, f.line, f.category.lower(), f.description.lower())
        if key in seen:
            continue
        seen.add(key)
        unique.append(f)
    return unique


def summarize(findings: Sequence[Finding], files_reviewed: int) -> Dict[str, Any]:
    high = sum(1 for f in findings if f.severity == "HIGH")
    medium = sum(1 for f in findings if f.severity == "MEDIUM")
    low = sum(1 for f in findings if f.severity == "LOW")
    return {
        "files_reviewed": files_reviewed,
        "high_severity": high,
        "medium_severity": medium,
        "low_severity": low,
        "review_completed": True,
    }


def parse_csv(value: str) -> List[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def resolve_output_path(repo: Path, output_arg: str) -> Path:
    out_path = Path(output_arg)
    if not out_path.is_absolute():
        out_path = repo / out_path
    return out_path


def resolve_checkpoint_path(repo: Path, output_path: Path, checkpoint_arg: str) -> Path:
    if checkpoint_arg:
        cp_path = Path(checkpoint_arg)
        if not cp_path.is_absolute():
            cp_path = repo / cp_path
        return cp_path
    return output_path.with_suffix(output_path.suffix + ".checkpoint.json")


def write_json_atomic(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    tmp_path.replace(path)


def load_checkpoint(path: Path) -> Dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def resolve_endpoints(args: argparse.Namespace) -> List[str]:
    endpoints = parse_csv(args.endpoints) if args.endpoints else []
    if endpoints:
        return endpoints
    return [args.endpoint]


def resolve_models(args: argparse.Namespace) -> List[str]:
    models = parse_csv(args.models) if args.models else []
    if models:
        return models
    return [args.model]


def process_chunk(
    idx: int,
    total_chunks: int,
    chunk: str,
    repo_name: str,
    endpoint: str,
    model: str,
    args: argparse.Namespace,
) -> Tuple[int, List[Finding]]:
    prompt = build_user_prompt(repo_name, idx, total_chunks, chunk, args.mode)
    result = call_chat_completion(
        endpoint=endpoint,
        api_key=args.api_key,
        model=model,
        system_prompt=SYSTEM_PROMPTS[args.mode],
        user_prompt=prompt,
        temperature=args.temperature,
        top_p=args.top_p,
        timeout_seconds=args.timeout_seconds,
    )

    raw_findings = result.get("findings", []) if isinstance(result, dict) else []
    chunk_findings = [normalize_finding(item) for item in raw_findings if isinstance(item, dict)]
    normalized = [f for f in chunk_findings if f is not None]
    if args.sleep_seconds > 0:
        time.sleep(args.sleep_seconds)
    return idx, normalized


def main() -> int:
    args = parse_args()
    args.api_key = args.api_key.strip()
    if not args.api_key:
        print("[error] API key is empty after trimming whitespace.", file=sys.stderr)
        return 2

    repo = Path(args.repo_path).resolve()

    if not repo.exists() or not repo.is_dir():
        print(f"[error] Repo path is invalid: {repo}", file=sys.stderr)
        return 2

    output_arg = args.output
    if output_arg == "security-findings.local.json":
        if args.mode == "bugs":
            output_arg = "bug-findings.local.json"
        elif args.mode == "performance":
            output_arg = "performance-findings.local.json"
    output_path = resolve_output_path(repo, output_arg)
    checkpoint_path = resolve_checkpoint_path(repo, output_path, args.checkpoint)

    snippets = build_file_snippets(repo, args)
    if not snippets:
        print("[error] No source files found with selected extensions.", file=sys.stderr)
        return 2

    chunks = chunk_snippets(snippets, args.max_chunk_chars)
    endpoints = resolve_endpoints(args)
    models = resolve_models(args)
    workers = max(1, args.workers)
    effective_workers = min(workers, len(chunks))

    print(
        f"[info] Scanning {len(snippets)} files in {len(chunks)} chunks "
        f"with {effective_workers} worker(s), {len(endpoints)} endpoint(s), {len(models)} model id(s)"
    )

    all_findings: List[Finding] = []
    completed_chunks: Dict[str, Dict[str, Any]] = {}

    if args.resume and checkpoint_path.exists():
        checkpoint = load_checkpoint(checkpoint_path)
        cp_repo = str(checkpoint.get("repo_path", ""))
        cp_total_chunks = checkpoint.get("total_chunks")
        cp_completed = checkpoint.get("completed_chunks", {})

        if cp_repo and cp_repo != repo.as_posix():
            print(
                f"[error] Checkpoint repo mismatch: {cp_repo} != {repo.as_posix()}",
                file=sys.stderr,
            )
            return 2

        if isinstance(cp_total_chunks, int) and cp_total_chunks != len(chunks):
            print(
                f"[error] Checkpoint chunk mismatch: {cp_total_chunks} != {len(chunks)}",
                file=sys.stderr,
            )
            return 2

        if isinstance(cp_completed, dict):
            completed_chunks = cp_completed
            for chunk_data in completed_chunks.values():
                if not isinstance(chunk_data, dict):
                    continue
                raw_findings = chunk_data.get("findings", [])
                if not isinstance(raw_findings, list):
                    continue
                for raw in raw_findings:
                    if isinstance(raw, dict):
                        finding = normalize_finding(raw)
                        if finding is not None:
                            all_findings.append(finding)
            print(f"[info] Resumed {len(completed_chunks)} completed chunk(s) from {checkpoint_path}")

    futures: Dict[Future[Tuple[int, List[Finding]]], Tuple[int, str, str]] = {}

    with ThreadPoolExecutor(max_workers=max(1, min(effective_workers, len(chunks)))) as pool:
        for idx, chunk in enumerate(chunks, start=1):
            if str(idx) in completed_chunks:
                continue
            endpoint = endpoints[(idx - 1) % len(endpoints)]
            model = models[(idx - 1) % len(models)]
            future = pool.submit(
                process_chunk,
                idx,
                len(chunks),
                chunk,
                repo.name,
                endpoint,
                model,
                args,
            )
            futures[future] = (idx, endpoint, model)

        if not futures:
            print("[info] No pending chunks to process.")
        else:
            for future in as_completed(futures):
                idx, endpoint, model = futures[future]
                try:
                    _, findings = future.result()
                except Exception as exc:
                    for pending in futures:
                        if not pending.done():
                            pending.cancel()
                    if isinstance(exc, error.URLError):
                        print(
                            f"[error] Request failed on chunk {idx} (endpoint={endpoint}, model={model}): {exc}",
                            file=sys.stderr,
                        )
                    else:
                        print(
                            f"[error] Failed on chunk {idx} (endpoint={endpoint}, model={model}): {exc}",
                            file=sys.stderr,
                        )
                    print(f"[info] Progress saved in checkpoint: {checkpoint_path}", file=sys.stderr)
                    return 1

                all_findings.extend(findings)
                completed_chunks[str(idx)] = {
                    "endpoint": endpoint,
                    "model": model,
                    "findings": [f.to_dict() for f in findings],
                }
                checkpoint_payload = {
                    "repo_path": repo.as_posix(),
                    "total_chunks": len(chunks),
                    "completed_chunks": completed_chunks,
                    "updated_at_epoch": int(time.time()),
                }
                write_json_atomic(checkpoint_path, checkpoint_payload)
                print(f"[info] Chunk {idx}/{len(chunks)} complete: {len(findings)} findings")

    all_findings = dedupe_findings(all_findings)

    output = {
        "repo_path": repo.as_posix(),
        "mode": args.mode,
        "model": args.model,
        "models": models,
        "endpoint": args.endpoint,
        "endpoints": endpoints,
        "workers": effective_workers,
        "checkpoint_path": checkpoint_path.as_posix(),
        "findings": [f.to_dict() for f in all_findings],
        "analysis_summary": summarize(all_findings, files_reviewed=len(snippets)),
    }

    write_json_atomic(output_path, output)
    print(f"[info] Wrote report to {output_path}")
    print(f"[info] Checkpoint file: {checkpoint_path}")

    high = output["analysis_summary"]["high_severity"]
    return 1 if high > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
