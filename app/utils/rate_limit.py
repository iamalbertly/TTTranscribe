from __future__ import annotations

import time
from typing import Tuple

from app.core.config import get_settings


_state = {"last_reset": 0.0, "tokens": 0}


def allow_request() -> Tuple[bool, int]:
    settings = get_settings()
    now = time.time()
    window = 60.0
    capacity = settings.global_requests_per_minute
    if now - _state["last_reset"] >= window:
        _state["last_reset"] = now
        _state["tokens"] = capacity
    if _state["tokens"] > 0:
        _state["tokens"] -= 1
        return True, 0
    # compute seconds until reset
    retry_after = int(max(1, window - (now - _state["last_reset"])) )
    return False, retry_after


