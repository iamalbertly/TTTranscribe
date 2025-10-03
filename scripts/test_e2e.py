#!/usr/bin/env python3
"""
Unified E2E tester for TTTranscibe (v1.0)

- Health check
- Authenticated POST /api/transcribe with HMAC
- Optional start/stop of local server
- Double-run to verify caching (second call should be faster; local billed_tokens=0)
- Append summary to scripts/FINAL_STATUS.md

Usage examples:
  python scripts/test_e2e.py --remote --url https://vm.tiktok.com/ZMADQVF4e/ \
    --key key_live_... --secret ...

  python scripts/test_e2e.py --local --url https://vm.tiktok.com/ZMADQVF4e/ \
    --key CLIENT_A_KEY_123 --secret CLIENT_A_SECRET_ABC \
    --start-local --env API_SECRET=CLIENT_A_SECRET_ABC --env API_KEYS_JSON={"CLIENT_A_KEY_123":"test-client"}
"""

import argparse
import contextlib
import hashlib
import hmac
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import requests

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
FINAL_STATUS = os.path.join(ROOT, "scripts", "FINAL_STATUS.md")


def build_sig(secret: str, method: str, path: str, body: str, ts: int) -> str:
    s = f"{method}\n{path}\n{body}\n{ts}"
    return hmac.new(secret.encode("utf-8"), s.encode("utf-8"), hashlib.sha256).hexdigest()


def call_api(base: str, key: str, secret: str, tik_url: str, timeout: int = 420) -> Dict[str, Any]:
    ts = int(time.time() * 1000)
    body = {"url": tik_url}
    body_json = json.dumps(body)
    sig = build_sig(secret, "POST", "/api/transcribe", body_json, ts)
    headers = {
        "Content-Type": "application/json",
        "X-API-Key": key,
        "X-Timestamp": str(ts),
        "X-Signature": sig,
    }
    r = requests.post(f"{base}/api/transcribe", headers=headers, data=body_json, timeout=timeout)
    data = None
    try:
        if "application/json" in r.headers.get("Content-Type", ""):
            data = r.json()
    except Exception:
        pass
    return {"status": r.status_code, "json": data, "text": r.text, "elapsed": r.elapsed.total_seconds()}


def health(base: str, timeout: int = 10) -> bool:
    try:
        r = requests.get(f"{base}/health", timeout=timeout)
        return r.status_code == 200
    except Exception:
        return False


def start_local_server(env: Dict[str, str]) -> Optional[subprocess.Popen]:
    new_env = os.environ.copy()
    new_env.update(env)
    with contextlib.suppress(Exception):
        stop_local_server()
    return subprocess.Popen([sys.executable, "-u", "main.py"], cwd=ROOT, env=new_env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)


def stop_local_server() -> None:
    ps = os.path.join(ROOT, "scripts", "kill_local.ps1")
    if os.path.exists(ps):
        subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps], cwd=ROOT)


def append_status(lines: list[str]) -> None:
    ts = datetime.now(timezone.utc).isoformat()
    try:
        with open(FINAL_STATUS, "a", encoding="utf-8") as f:
            f.write(f"\n## {ts} E2E Test\n")
            for ln in lines:
                f.write(f"- {ln}\n")
    except Exception:
        pass


def main() -> int:
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--local", action="store_true")
    g.add_argument("--remote", action="store_true")
    ap.add_argument("--url", required=True)
    ap.add_argument("--key", default=os.getenv("API_KEY", ""))
    ap.add_argument("--secret", default=os.getenv("API_SECRET", ""))
    ap.add_argument("--start-local", action="store_true")
    ap.add_argument("--env", action="append", default=[], help="Additional env entries KEY=VALUE for local server")
    ap.add_argument("--retries", type=int, default=1)
    ap.add_argument("--timeout", type=int, default=420, help="Request timeout seconds")
    ap.add_argument("--health-wait", type=int, default=60, help="Seconds to wait for local health")
    args = ap.parse_args()

    base = "http://localhost:7860" if args.local else "https://iamromeoly-tttranscibe.hf.space"
    if not args.key or not args.secret:
        print("Missing API credentials; provide --key/--secret or set API_KEY/API_SECRET.")
        return 2

    proc = None
    try:
        if args.local and args.start_local:
            env_map: Dict[str, str] = {}
            for kv in args.env:
                if "=" in kv:
                    k, v = kv.split("=", 1)
                    env_map[k] = v
            # Ensure server has matching credentials
            env_map["API_SECRET"] = args.secret
            env_map["API_KEYS_JSON"] = json.dumps({args.key: "local"}, separators=(",", ":"))
            proc = start_local_server(env_map)
            deadline = time.time() + max(10, int(args.health_wait))
            while time.time() < deadline and not health(base):
                time.sleep(1)

        if not health(base):
            print(f"Health failed at {base}")
            return 1

        r1 = call_api(base, args.key, args.secret, args.url, timeout=args.timeout)
        ok1 = r1["status"] == 200
        billed1 = None
        if isinstance(r1.get("json"), dict):
            billed1 = r1["json"].get("billed_tokens")

        attempts = 1
        while not ok1 and attempts < max(1, args.retries):
            time.sleep(2)
            r1 = call_api(base, args.key, args.secret, args.url, timeout=args.timeout)
            ok1 = r1["status"] == 200
            attempts += 1

        time.sleep(1)
        r2 = call_api(base, args.key, args.secret, args.url, timeout=args.timeout)
        ok2 = r2["status"] == 200
        billed2 = None
        if isinstance(r2.get("json"), dict):
            billed2 = r2["json"].get("billed_tokens")

        print("Base:", base)
        print("First:", r1["status"], "elapsed_s=", r1["elapsed"], "billed=", billed1)
        if r1["status"] != 200:
            print("First body:")
            print(r1["text"])  # show error details
        print("Second:", r2["status"], "elapsed_s=", r2["elapsed"], "billed=", billed2)
        if r2["status"] != 200:
            print("Second body:")
            print(r2["text"])  # show error details

        lines = [
            f"base={base}",
            f"first_status={r1['status']} elapsed={r1['elapsed']:.2f}s billed={billed1}",
            f"second_status={r2['status']} elapsed={r2['elapsed']:.2f}s billed={billed2}",
        ]
        append_status(lines)

        return 0 if ok1 and ok2 else 1
    finally:
        if proc is not None:
            stop_local_server()
            with contextlib.suppress(Exception):
                proc.terminate()


if __name__ == "__main__":
    sys.exit(main())
