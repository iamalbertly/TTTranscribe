import time
from threading import Lock
from collections import deque
from typing import Any, Dict, List


class JobsRegistry:
    def __init__(self, max_recent: int = 500) -> None:
        self._jobs: Dict[str, Dict[str, Any]] = {}
        self._jobs_order: deque[str] = deque(maxlen=max_recent)
        self._lock = Lock()

    def new_job(self, job_id: str, url: str) -> None:
        with self._lock:
            self._jobs[job_id] = {
                "job_id": job_id,
                "status": "PENDING",
                "created_at": time.time(),
                "updated_at": time.time(),
                "url": url,
                "cache_hit": False,
                "elapsed_ms": None,
                "error": None,
            }
            self._jobs_order.appendleft(job_id)

    def set_job(self, job_id: str, **fields: Any) -> None:
        with self._lock:
            if job_id in self._jobs:
                self._jobs[job_id].update(fields)
                self._jobs[job_id]["updated_at"] = time.time()

    def queue_snapshot(self) -> Dict[str, int]:
        with self._lock:
            qsize = sum(1 for j in self._jobs.values() if j["status"] in ("PENDING", "RUNNING"))
            active = sum(1 for j in self._jobs.values() if j["status"] == "RUNNING")
        return {"queue_size": qsize, "active": active}

    def recent(self, limit: int = 25) -> List[Dict[str, Any]]:
        with self._lock:
            return [self._jobs[jid] for jid in list(self._jobs_order)[:limit]]

    def summary(self) -> Dict[str, Any]:
        with self._lock:
            total = len(self._jobs)
            counts = {"PENDING": 0, "RUNNING": 0, "COMPLETE": 0, "FAILED": 0}
            for j in self._jobs.values():
                if j["status"] in counts:
                    counts[j["status"]] += 1
            recent = [self._jobs[jid] for jid in list(self._jobs_order)[:25]]
        return {
            "total": total,
            "pending": counts["PENDING"],
            "running": counts["RUNNING"],
            "complete": counts["COMPLETE"],
            "failed": counts["FAILED"],
            "recent": recent,
        }

    def failed(self) -> Dict[str, Any]:
        with self._lock:
            items = [j for j in self._jobs.values() if j["status"] == "FAILED"]
        return {"jobs": items}

    def repair(self, stale_seconds: int = 600) -> Dict[str, Any]:
        now = time.time()
        repaired = 0
        with self._lock:
            for j in self._jobs.values():
                if j["status"] == "PENDING" and (now - j["created_at"]) > stale_seconds:
                    j["status"] = "FAILED"
                    j["updated_at"] = now
                    repaired += 1
        return {"status": "ok", "repaired": repaired}


def mount_job_endpoints(app, registry: JobsRegistry, logger) -> None:
    @app.get("/queue/status")
    async def queue_status():
        try:
            snap = registry.queue_snapshot()
            qsize = snap["queue_size"]
            active = snap["active"]
            return {
                "status": "ok",
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "msg": "estimation",
                "event_id": None,
                "rank": None,
                "queue_size": qsize,
                "rank_eta": None,
                "queue": {
                    "queue_size": qsize,
                    "active_jobs": active,
                    "estimated_wait_time": 0 if qsize == 0 else 5 * qsize,
                    "status": "idle" if qsize == 0 else "busy",
                },
            }
        except Exception as e:
            logger.log("error", "queue_status_failed", error=str(e))
            return {"status": "error", "error": str(e), "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}

    @app.get("/jobs")
    async def jobs_summary():
        return registry.summary()

    @app.get("/jobs/failed")
    async def jobs_failed():
        return registry.failed()

    @app.post("/jobs/repair")
    async def jobs_repair():
        return registry.repair()


