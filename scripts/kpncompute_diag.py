"""CLI-only read access to KpnCompute diagnostic logs.

Set KPNCOMPUTE_DIAGNOSTIC_KEY in the shell; never pass the key as a command
line argument, where it can leak through process listings or shell history.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def main() -> int:
    parser = argparse.ArgumentParser(description="Read KpnCompute diagnostic logs")
    parser.add_argument("command", choices=("logs", "stats", "errors"))
    parser.add_argument("--hours", type=int, default=24)
    parser.add_argument(
        "--base-url",
        default=os.getenv("KPNCOMPUTE_API_URL", "https://api.kpnsolute.com/compute"),
    )
    args = parser.parse_args()
    key = os.getenv("KPNCOMPUTE_DIAGNOSTIC_KEY", "").strip()
    if not key:
        parser.error("KPNCOMPUTE_DIAGNOSTIC_KEY is required")
    paths = {
        "logs": "/api/diagnostics/logs?limit=250",
        "stats": f"/api/diagnostics/logs/stats?since_hours={max(1, args.hours)}",
        "errors": f"/api/diagnostics/logs/errors?since_hours={max(1, args.hours)}",
    }
    request = Request(
        args.base_url.rstrip("/") + paths[args.command],
        headers={"X-Diagnostic-Key": key, "Accept": "application/json"},
    )
    try:
        with urlopen(request, timeout=30) as response:
            print(json.dumps(json.load(response), indent=2))
    except (HTTPError, URLError) as exc:
        print(f"diagnostic request failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
