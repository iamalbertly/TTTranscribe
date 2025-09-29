from __future__ import annotations

from typing import Any, Dict, Optional

try:
    import asyncpg  # type: ignore
except Exception:  # pragma: no cover
    asyncpg = None  # type: ignore

from app.core.logging import get_logger


logger = get_logger(__name__)


class DatabaseOperations:
    """Core database operations for jobs and assets."""
    
    def __init__(self, pool: Optional["asyncpg.pool.Pool"], memory_mode: bool, jobs: Dict[str, Dict[str, Any]], assets: Dict[str, Dict[str, Any]]):
        self._pool = pool
        self._memory_mode = memory_mode
        self._jobs = jobs
        self._assets = assets

    def _now(self):
        """Get current UTC datetime."""
        import datetime as dt
        return dt.datetime.utcnow()

    async def insert_job(self, status: str = "PENDING", request_url: Optional[str] = None, idempotency_key: Optional[str] = None, content_hash: Optional[str] = None) -> str:
        if self._memory_mode:
            import uuid, datetime as dt
            job_id = str(uuid.uuid4())
            self._jobs[job_id] = {
                "id": job_id,
                "status": status,
                "request_url": request_url,
                "audio_storage_key": None,
                "transcription_storage_key": None,
                "error_message": None,
                "idempotency_key": idempotency_key,
                "content_hash": content_hash,
                "cache_hit": False,
                "lease_owner": None,
                "lease_expires_at": None,
                "created_at": dt.datetime.utcnow(),
                "updated_at": dt.datetime.utcnow(),
            }
            return job_id
        assert self._pool is not None
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                insert into jobs (status, request_url, idempotency_key, content_hash)
                values ($1, $2, $3, $4) returning id::text
                """,
                status,
                request_url,
                idempotency_key,
                content_hash,
            )
            return row[0]

    async def update_status(self, job_id: str, status: str, error_message: Optional[str] = None) -> None:
        if self._memory_mode:
            import datetime as dt
            job = self._jobs.get(job_id)
            if job:
                job["status"] = status
                job["error_message"] = error_message
                job["updated_at"] = dt.datetime.utcnow()
            return
        assert self._pool is not None
        async with self._pool.acquire() as conn:
            await conn.execute(
                "update jobs set status=$2, error_message=$3, updated_at=now() where id::text=$1",
                job_id,
                status,
                error_message,
            )

    async def set_storage_keys(self, job_id: str, audio_key: Optional[str], transcription_key: Optional[str]) -> None:
        if self._memory_mode:
            import datetime as dt
            job = self._jobs.get(job_id)
            if job:
                job["audio_storage_key"] = audio_key
                job["transcription_storage_key"] = transcription_key
                job["updated_at"] = dt.datetime.utcnow()
            return
        assert self._pool is not None
        async with self._pool.acquire() as conn:
            await conn.execute(
                "update jobs set audio_storage_key=$2, transcription_storage_key=$3, updated_at=now() where id::text=$1",
                job_id,
                audio_key,
                transcription_key,
            )

    async def set_content_hash(self, job_id: str, content_hash: str) -> None:
        if self._memory_mode:
            import datetime as dt
            job = self._jobs.get(job_id)
            if job:
                job["content_hash"] = content_hash
                job["updated_at"] = dt.datetime.utcnow()
            return
        assert self._pool is not None
        async with self._pool.acquire() as conn:
            await conn.execute(
                "update jobs set content_hash=$2, updated_at=now() where id::text=$1",
                job_id,
                content_hash,
            )

    async def set_cache_hit(self, job_id: str, cache_hit: bool) -> None:
        if self._memory_mode:
            import datetime as dt
            job = self._jobs.get(job_id)
            if job:
                job["cache_hit"] = cache_hit
                job["updated_at"] = dt.datetime.utcnow()
            return
        assert self._pool is not None
        async with self._pool.acquire() as conn:
            await conn.execute(
                "update jobs set cache_hit=$2, updated_at=now() where id::text=$1",
                job_id,
                cache_hit,
            )

    async def get_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        if self._memory_mode:
            return self._jobs.get(job_id)
        assert self._pool is not None
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow("select id::text, status, request_url, audio_storage_key, transcription_storage_key, error_message, idempotency_key, content_hash, cache_hit, created_at, updated_at from jobs where id::text=$1", job_id)
            return dict(row) if row else None

    async def get_job_by_hash(self, content_hash: str) -> Optional[Dict[str, Any]]:
        if self._memory_mode:
            # return the most recent job with this hash (by created_at)
            matches = [j for j in self._jobs.values() if j.get("content_hash") == content_hash]
            matches.sort(key=lambda j: j.get("created_at"), reverse=True)
            return matches[0] if matches else None
        assert self._pool is not None
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow("select id::text, status, request_url, audio_storage_key, transcription_storage_key, error_message, idempotency_key, content_hash, cache_hit, created_at, updated_at from jobs where content_hash=$1 order by created_at desc limit 1", content_hash)
            return dict(row) if row else None

    async def upsert_asset(self, content_hash: str, audio_key: Optional[str], transcription_key: Optional[str]) -> None:
        if self._memory_mode:
            import datetime as dt
            existing = self._assets.get(content_hash)
            now = dt.datetime.utcnow()
            if existing:
                existing["audio_storage_key"] = audio_key
                existing["transcription_storage_key"] = transcription_key
                existing["updated_at"] = now
            else:
                self._assets[content_hash] = {
                    "content_hash": content_hash,
                    "audio_storage_key": audio_key,
                    "transcription_storage_key": transcription_key,
                    "created_at": now,
                    "updated_at": now,
                }
            return
        assert self._pool is not None
        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                insert into assets (content_hash, audio_storage_key, transcription_storage_key)
                values ($1, $2, $3)
                on conflict (content_hash) do update set
                  audio_storage_key = excluded.audio_storage_key,
                  transcription_storage_key = excluded.transcription_storage_key,
                  updated_at = now();
                """,
                content_hash,
                audio_key,
                transcription_key,
            )

    async def get_asset(self, content_hash: str) -> Optional[Dict[str, Any]]:
        if self._memory_mode:
            return self._assets.get(content_hash)
        assert self._pool is not None
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "select content_hash, audio_storage_key, transcription_storage_key from assets where content_hash=$1",
                content_hash,
            )
            return dict(row) if row else None
