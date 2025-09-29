from __future__ import annotations

import json
import logging
import sys
from typing import Any, Dict, Optional


class JsonLogFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: Dict[str, Any] = {
            "ts": self.formatTime(record, datefmt="%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "msg": record.getMessage(),
            "logger": record.name,
            "module": record.module,
        }
        # Enforce mandatory fields
        job_id = getattr(record, "job_id", None)
        component = getattr(record, "component", None)
        if job_id is None:
            payload["job_id"] = "unknown"
        else:
            payload["job_id"] = job_id
        if component is None:
            payload["component"] = record.name
        else:
            payload["component"] = component

        # Include extras if any
        for key, value in record.__dict__.items():
            if key in {"args", "msg", "levelname", "levelno", "pathname", "filename", "module", "exc_info", "exc_text", "stack_info", "lineno", "funcName", "created", "msecs", "relativeCreated", "thread", "threadName", "processName", "process", "name"}:
                continue
            if key in payload:
                continue
            try:
                json.dumps(value)
                payload[key] = value
            except Exception:
                payload[key] = str(value)

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def configure_logging(level: str = "INFO") -> None:
    root = logging.getLogger()
    root.setLevel(level.upper())
    stream_handler = logging.StreamHandler(sys.stdout)
    stream_handler.setFormatter(JsonLogFormatter())
    # Only use stdout handler for Hugging Face Spaces compatibility
    root.handlers = [stream_handler]


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)


