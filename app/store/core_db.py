from __future__ import annotations

from typing import Any, Dict, Optional, Tuple
import os

try:
    import asyncpg  # type: ignore
except Exception:  # pragma: no cover
    asyncpg = None  # type: ignore

from app.core.config import get_settings
from app.core.logging import get_logger
from app.store.db_operations import DatabaseOperations


logger = get_logger(__name__)


class CoreDatabase:
    """Core database operations without job management."""
    
    def __init__(self, dsn: Optional[str] = None):
        # Prefer direct env override to avoid stale cached settings in tests
        env_dsn = os.getenv("DATABASE_URL")
        self._dsn = dsn or env_dsn or get_settings().database_url
        self._pool: Optional["asyncpg.pool.Pool"] = None
        self._memory_mode: bool = self._dsn.startswith("memory://")
        # In-memory state (when memory mode enabled)
        self._jobs: Dict[str, Dict[str, Any]] = {}
        self._assets: Dict[str, Dict[str, Any]] = {}
        # Initialize operations
        self._ops = DatabaseOperations(self._pool, self._memory_mode, self._jobs, self._assets)

    def _now(self):
        """Get current UTC datetime."""
        import datetime as dt
        return dt.datetime.utcnow()

    async def connect(self) -> None:
        if self._memory_mode:
            logger.info("memory db ready", extra={"component": "db", "job_id": "startup"})
            # Ensure operations reflect current mode
            self._ops = DatabaseOperations(self._pool, self._memory_mode, self._jobs, self._assets)
            return
        if asyncpg is None:
            raise RuntimeError("asyncpg is required for non-memory DATABASE_URL. Install build tools and asyncpg.")
        if self._pool is None:
            try:
                self._pool = await asyncpg.create_pool(self._dsn, min_size=1, max_size=5)
                logger.info("db pool created", extra={"component": "db", "job_id": "startup"})
                # Reflect live pool in operations
                self._ops = DatabaseOperations(self._pool, self._memory_mode, self._jobs, self._assets)
            except Exception as e:
                # Fallback to memory mode outside production to keep dev/test running
                env = get_settings().environment.lower()
                if env != "production":
                    logger.warning("db connect failed; falling back to memory db", extra={"component": "db", "job_id": "startup", "error": str(e)})
                    self._memory_mode = True
                    logger.info("memory db ready", extra={"component": "db", "job_id": "startup"})
                    # Update operations to use memory mode immediately
                    self._ops = DatabaseOperations(self._pool, self._memory_mode, self._jobs, self._assets)
                    return
                raise

    async def aclose(self) -> None:
        if self._memory_mode:
            # Ensure ops remain consistent in memory mode
            self._ops = DatabaseOperations(self._pool, self._memory_mode, self._jobs, self._assets)
            return
        if self._pool is not None:
            await self._pool.close()
            self._pool = None
            logger.info("db pool closed", extra={"component": "db", "job_id": "shutdown"})
            # Clear pool reference in operations
            self._ops = DatabaseOperations(self._pool, self._memory_mode, self._jobs, self._assets)

    async def init_schema(self) -> None:
        if self._memory_mode:
            return
        assert self._pool is not None
        async with self._pool.acquire() as conn:
            # Expect schema applied via db/migrations.sql; ensure tables exist minimally
            await conn.execute(
                """
                create extension if not exists "uuid-ossp";
                create table if not exists public.jobs (
                  id uuid primary key default uuid_generate_v4(),
                  status text not null check (status in ('PENDING','FETCHING_MEDIA','NORMALIZING_MEDIA','MEDIA_READY','TRANSCRIBING','COMPLETE','FAILED')),
                  request_url text,
                  audio_storage_key text,
                  transcription_storage_key text,
                  error_message text,
                  idempotency_key text,
                  content_hash text,
                  cache_hit boolean not null default false,
                  lease_owner text,
                  lease_expires_at timestamptz,
                  created_at timestamptz not null default now(),
                  updated_at timestamptz not null default now()
                );
                create table if not exists public.assets (
                  content_hash text primary key,
                  audio_storage_key text,
                  transcription_storage_key text,
                  created_at timestamptz not null default now(),
                  updated_at timestamptz not null default now()
                );
                """
            )

    # Delegate operations to DatabaseOperations
    async def insert_job(self, status: str = "PENDING", request_url: Optional[str] = None, idempotency_key: Optional[str] = None, content_hash: Optional[str] = None) -> str:
        return await self._ops.insert_job(status, request_url, idempotency_key, content_hash)

    async def update_status(self, job_id: str, status: str, error_message: Optional[str] = None) -> None:
        return await self._ops.update_status(job_id, status, error_message)

    async def set_storage_keys(self, job_id: str, audio_key: Optional[str], transcription_key: Optional[str]) -> None:
        return await self._ops.set_storage_keys(job_id, audio_key, transcription_key)

    async def set_content_hash(self, job_id: str, content_hash: str) -> None:
        return await self._ops.set_content_hash(job_id, content_hash)

    async def set_cache_hit(self, job_id: str, cache_hit: bool) -> None:
        return await self._ops.set_cache_hit(job_id, cache_hit)

    async def get_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        return await self._ops.get_job(job_id)

    async def get_job_by_hash(self, content_hash: str) -> Optional[Dict[str, Any]]:
        return await self._ops.get_job_by_hash(content_hash)

    async def upsert_asset(self, content_hash: str, audio_key: Optional[str], transcription_key: Optional[str]) -> None:
        return await self._ops.upsert_asset(content_hash, audio_key, transcription_key)

    async def get_asset(self, content_hash: str) -> Optional[Dict[str, Any]]:
        return await self._ops.get_asset(content_hash)

    # Leasing and queue helpers
    async def claim_jobs(self, status: str, limit: int, worker_id: str, lease_seconds: int) -> list[Dict[str, Any]]:
        if self._memory_mode:
            import datetime as dt
            now = dt.datetime.utcnow()
            # find available jobs in given status without active lease
            available = []
            for job in self._jobs.values():
                if job["status"] == status and (job.get("lease_expires_at") is None or job.get("lease_expires_at") < now):
                    available.append(job)
            available.sort(key=lambda j: j.get("created_at"))
            selected = available[:limit]
            for job in selected:
                job["lease_owner"] = worker_id
                job["lease_expires_at"] = now + dt.timedelta(seconds=lease_seconds)
                job["updated_at"] = now
            return [dict(job) for job in selected]
        assert self._pool is not None
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """
                with candidates as (
                  select id
                  from jobs
                  where status = $1
                  and (lease_expires_at is null or lease_expires_at < now())
                  order by created_at asc
                  limit $2
                  for update skip locked
                ), updated as (
                  update jobs j
                  set lease_owner = $3,
                      lease_expires_at = now() + ($4 || ' seconds')::interval,
                      updated_at = now()
                  from candidates c
                  where j.id = c.id
                  returning j.id::text
                )
                select j.id::text, j.status, j.request_url, j.audio_storage_key, j.transcription_storage_key, j.error_message, j.idempotency_key, j.content_hash
                from jobs j
                where j.id in (select id from updated)
                """,
                status,
                limit,
                worker_id,
                lease_seconds,
            )
            return [dict(r) for r in rows]

    async def renew_lease(self, job_id: str, lease_seconds: int) -> None:
        if self._memory_mode:
            import datetime as dt
            job = self._jobs.get(job_id)
            if job:
                job["lease_expires_at"] = dt.datetime.utcnow() + dt.timedelta(seconds=lease_seconds)
            return
        assert self._pool is not None
        async with self._pool.acquire() as conn:
            await conn.execute(
                "update jobs set lease_expires_at = now() + ($2 || ' seconds')::interval, updated_at = now() where id::text = $1",
                job_id,
                lease_seconds,
            )

    async def release_job_lease(self, job_id: str) -> None:
        if self._memory_mode:
            job = self._jobs.get(job_id)
            if job:
                job["lease_owner"] = None
                job["lease_expires_at"] = None
            return
        assert self._pool is not None
        async with self._pool.acquire() as conn:
            await conn.execute(
                "update jobs set lease_owner = null, lease_expires_at = null, updated_at = now() where id::text = $1",
                job_id,
            )

    async def queue_counts_per_status(self) -> Dict[str, int]:
        if self._memory_mode:
            counts: Dict[str, int] = {}
            for job in self._jobs.values():
                s = job["status"]
                counts[s] = counts.get(s, 0) + 1
            return counts
        assert self._pool is not None
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                "select status, count(*)::int as ct from jobs group by status"
            )
            return {r[0]: r[1] for r in rows}
