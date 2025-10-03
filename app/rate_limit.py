import os, time
from threading import Lock
from typing import Dict


class TokenBucket:
    def __init__(self, capacity: int, refill_rate: float):
        self.capacity = capacity
        self.tokens = capacity
        self.last_refill = time.time()
        self.lock = Lock()

    def consume(self, tokens: int = 1) -> bool:
        with self.lock:
            now = time.time()
            time_passed = now - self.last_refill
            self.tokens = min(self.capacity, self.tokens + time_passed * self.refill_rate)
            self.last_refill = now
            if self.tokens >= tokens:
                self.tokens -= tokens
                return True
            return False


_capacity = int(os.getenv("RATE_LIMIT_CAPACITY", "60"))
_refill_per_min = float(os.getenv("RATE_LIMIT_REFILL_PER_MIN", "1"))
_refill_rate_per_sec = _refill_per_min / 60.0

rate_limiters: Dict[str, TokenBucket] = {}


def get_rate_limiter(api_key: str) -> TokenBucket:
    if api_key not in rate_limiters:
        rate_limiters[api_key] = TokenBucket(capacity=_capacity, refill_rate=_refill_rate_per_sec)
    return rate_limiters[api_key]


