#!/usr/bin/env python3
"""
DEPRECATED: use scripts/Test_E2E_Transcribe_v1.0.py instead.
Kept temporarily for compatibility; will be removed in a future cleanup.
"""

import argparse
import hashlib
import hmac
import json
import os
import sys
import time
from typing import Any, Dict

import requests


def make_request(base_url: str, api_key: str, api_secret: str, tiktok_url: str, timeout: int = 180) -> Dict[str, Any]:
    timestamp = int(time.time() * 1000)
    body = {"url": tiktok_url}
    body_json = json.dumps(body)
    string_to_sign = f"POST\n/api/transcribe\n{body_json}\n{timestamp}"
    signature = hmac.new(api_secret.encode("utf-8"), string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
    headers = {
        "Content-Type": "application/json",
        "X-API-Key": api_key,
        "X-Timestamp": str(timestamp),
        "X-Signature": signature,
    }
    resp = requests.post(f"{base_url}/api/transcribe", headers=headers, data=body_json, timeout=timeout)
    return {
        "status_code": resp.status_code,
        "headers": dict(resp.headers),
        "text": resp.text,
        "json": None if "application/json" not in resp.headers.get("Content-Type", "") else resp.json(),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", required=True)
    parser.add_argument("--url", required=True)
    parser.add_argument("--key", default=os.getenv("API_KEY", ""))
    parser.add_argument("--secret", default=os.getenv("API_SECRET", ""))
    args = parser.parse_args()

    if not args.key or not args.secret:
        print("Missing API key/secret. Provide via --key/--secret or env API_KEY/API_SECRET.")
        return 2

    print("[DEPRECATED] Use scripts/Test_E2E_Transcribe_v1.0.py")
    print(f"Base: {args.base}")
    print(f"URL:  {args.url}")
    r = make_request(args.base, args.key, args.secret, args.url)
    print(f"Status: {r['status_code']}")
    print(r["text"])  # raw body to preserve formatting

    return 0 if r["status_code"] == 200 else 1


if __name__ == "__main__":
    sys.exit(main())


