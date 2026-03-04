#!/usr/bin/env python3
from __future__ import annotations

import argparse
import statistics
import time
from pathlib import Path

import httpx


def run_bench(endpoint: str, token: str, image_path: Path, warmups: int, runs: int, timeout_s: int) -> None:
    payload = image_path.read_bytes()
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "image/jpeg",
    }

    with httpx.Client(timeout=timeout_s) as client:
        for _ in range(warmups):
            r = client.post(endpoint, content=payload, headers=headers)
            r.raise_for_status()

        times = []
        for _ in range(runs):
            t0 = time.perf_counter()
            r = client.post(endpoint, content=payload, headers=headers)
            dt = (time.perf_counter() - t0) * 1000.0
            r.raise_for_status()
            times.append(dt)

    print(f"endpoint: {endpoint}")
    print(f"runs: {runs}")
    print(f"avg_ms: {statistics.mean(times):.1f}")
    print(f"p50_ms: {statistics.median(times):.1f}")
    print(f"p95_ms: {sorted(times)[max(0, int(runs * 0.95) - 1)]:.1f}")
    print(f"min_ms: {min(times):.1f}")
    print(f"max_ms: {max(times):.1f}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark Modal segmentation endpoint latency.")
    parser.add_argument("--endpoint", required=True, help="Full Modal endpoint URL for /segment")
    parser.add_argument("--token", required=True, help="SEGMENTATION_SHARED_TOKEN value")
    parser.add_argument("--image", required=True, help="Path to local test image")
    parser.add_argument("--warmups", type=int, default=1)
    parser.add_argument("--runs", type=int, default=10)
    parser.add_argument("--timeout", type=int, default=120)

    args = parser.parse_args()
    run_bench(
        endpoint=args.endpoint,
        token=args.token,
        image_path=Path(args.image),
        warmups=args.warmups,
        runs=args.runs,
        timeout_s=args.timeout,
    )


if __name__ == "__main__":
    main()
