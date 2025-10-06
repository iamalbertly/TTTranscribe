import subprocess, pathlib, datetime, os

def short_sha() -> str:
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], text=True).strip()
    except Exception:
        return "unknown"

sha = os.environ.get("GIT_REV") or short_sha()
ts = datetime.datetime.utcnow().isoformat() + "Z"
out = pathlib.Path("app/build_info.py")
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(f'GIT_SHA = "{sha}"\nBUILD_TIME = "{ts}"\n', encoding="utf-8")
print(f"Wrote {out} with {sha} @ {ts}")


