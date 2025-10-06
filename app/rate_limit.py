import os, time, threading


class TokenBucket:
    def __init__(self, capacity: int, refill_per_sec: float):
        self.capacity = max(1, int(capacity))
        self.refill_rate = float(refill_per_sec)  # tokens per second
        self.tokens = float(self.capacity)
        self.lock = threading.Lock()
        self.last = time.monotonic()

    def consume(self, tokens: float = 1.0) -> bool:
        now = time.monotonic()
        with self.lock:
            elapsed = now - self.last
            self.tokens = min(self.capacity, self.tokens + elapsed * self.refill_rate)
            self.last = now
            if self.tokens >= tokens:
                self.tokens -= tokens
                return True
            return False


_bucket = None


def get_rate_limiter():
    global _bucket
    if _bucket is None:
        capacity = int(os.getenv("RATE_LIMIT_CAPACITY", "60"))
        refill   = float(os.getenv("RATE_LIMIT_REFILL_PER_SEC", "1.0"))
        _bucket = TokenBucket(capacity, refill)
    return _bucket


