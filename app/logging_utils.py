import sys, json, time, os
from collections import deque


LOGS = deque(maxlen=1500)


class UILogHandler:
    def __init__(self, name: str = "app"):
        self.name = name

    def log(self, level: str, msg: str, **fields):
        record = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z", time.gmtime()),
            "level": level.upper(),
            "logger": self.name,
            "msg": msg,
            **fields,
        }
        line = json.dumps(record, ensure_ascii=False)
        LOGS.append(line)
        print(line, file=sys.stdout, flush=True)


def read_logs() -> str:
    return "\n".join(LOGS)


# Optional Google Cloud Logging mirror
GCP_LOGGER = None
try:
    if os.getenv("GOOGLE_APPLICATION_CREDENTIALS"):
        try:
            from google.cloud import logging as gcp_logging  # type: ignore

            _gcp_client = gcp_logging.Client(project=os.getenv("GCP_PROJECT_ID", "tttranscibe-project-64857"))
            GCP_LOGGER = _gcp_client.logger(os.getenv("GCP_LOG_NAME", "tttranscibe"))
        except Exception as _gcp_err:
            print(
                json.dumps(
                    {
                        "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z", time.gmtime()),
                        "level": "WARNING",
                        "logger": "tttranscribe",
                        "msg": "gcp_logging_init_failed",
                        "error": str(_gcp_err),
                    }
                ),
                file=sys.stdout,
                flush=True,
            )
except Exception:
    pass


