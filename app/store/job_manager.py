from __future__ import annotations

from typing import Any, Dict, List, Optional
import datetime as dt

from app.core.logging import get_logger


logger = get_logger(__name__)


class JobManager:
    """Handles job lifecycle management and cleanup operations."""
    
    def __init__(self, db):
        self.db = db

    async def cleanup_old_failed_jobs(self, hours_old: int = 24) -> int:
        """Remove failed jobs older than specified hours. Returns count of deleted jobs."""
        if self.db._memory_mode:
            cutoff = dt.datetime.utcnow() - dt.timedelta(hours=hours_old)
            to_delete = []
            for job_id, job in self.db._jobs.items():
                if job["status"] == "FAILED" and job.get("updated_at", job.get("created_at")) < cutoff:
                    to_delete.append(job_id)
            for job_id in to_delete:
                del self.db._jobs[job_id]
            return len(to_delete)
        
        assert self.db._pool is not None
        async with self.db._pool.acquire() as conn:
            result = await conn.execute(
                "delete from jobs where status = 'FAILED' and updated_at < now() - ($1 || ' hours')::interval",
                hours_old
            )
            return int(result.split()[-1])  # Extract count from "DELETE N"

    async def get_failed_jobs(self, limit: int = 50) -> List[Dict[str, Any]]:
        """Get recent failed jobs for debugging."""
        if self.db._memory_mode:
            failed_jobs = [job for job in self.db._jobs.values() if job["status"] == "FAILED"]
            failed_jobs.sort(key=lambda j: j.get("updated_at", j.get("created_at")), reverse=True)
            return failed_jobs[:limit]
        
        assert self.db._pool is not None
        async with self.db._pool.acquire() as conn:
            rows = await conn.fetch(
                """
                select id::text, status, request_url, error_message, created_at, updated_at 
                from jobs 
                where status = 'FAILED' 
                order by updated_at desc 
                limit $1
                """,
                limit
            )
            return [dict(r) for r in rows]

    async def clear_all_failed_jobs(self) -> int:
        """Clear all failed jobs. Returns count of deleted jobs."""
        if self.db._memory_mode:
            to_delete = [job_id for job_id, job in self.db._jobs.items() if job["status"] == "FAILED"]
            for job_id in to_delete:
                del self.db._jobs[job_id]
            return len(to_delete)
        
        assert self.db._pool is not None
        async with self.db._pool.acquire() as conn:
            result = await conn.execute("delete from jobs where status = 'FAILED'")
            return int(result.split()[-1])  # Extract count from "DELETE N"

    async def clear_all_jobs(self) -> int:
        """Clear all jobs (for development shutdown)."""
        if self.db._memory_mode:
            count = len(self.db._jobs)
            self.db._jobs.clear()
            return count
        
        assert self.db._pool is not None
        async with self.db._pool.acquire() as conn:
            result = await conn.execute("delete from jobs")
            return int(result.split()[-1])  # Extract count from "DELETE N"

    async def release_orphaned_jobs(self, max_age_minutes: int = 10) -> int:
        """Release jobs that have been RUNNING for too long (orphaned). Returns count of released jobs."""
        if self.db._memory_mode:
            now = dt.datetime.utcnow()
            cutoff = now - dt.timedelta(minutes=max_age_minutes)
            
            orphaned_count = 0
            for job_id, job in self.db._jobs.items():
                if (job["status"] in ("FETCHING_MEDIA", "NORMALIZING_MEDIA", "MEDIA_READY", "TRANSCRIBING") and 
                    job.get("updated_at", job.get("created_at")) < cutoff):
                    job["status"] = "FAILED"
                    job["error_message"] = "job_orphaned_timeout"
                    job["updated_at"] = now
                    job["lease_owner"] = None
                    job["lease_expires_at"] = None
                    orphaned_count += 1
            
            return orphaned_count
        
        assert self.db._pool is not None
        async with self.db._pool.acquire() as conn:
            result = await conn.execute(
                """
                update jobs 
                set status = 'FAILED', 
                    error_message = 'job_orphaned_timeout',
                    lease_owner = null,
                    lease_expires_at = null,
                    updated_at = now()
                where status in ('FETCHING_MEDIA', 'NORMALIZING_MEDIA', 'MEDIA_READY', 'TRANSCRIBING')
                and updated_at < now() - ($1 || ' minutes')::interval
                """,
                max_age_minutes
            )
            return int(result.split()[-1])  # Extract count from "UPDATE N"

    async def repair_stuck_jobs_on_startup(self) -> int:
        """Repair stuck jobs on startup: reset RUNNING jobs older than 5 minutes to PENDING."""
        if self.db._memory_mode:
            # In memory mode, reset any RUNNING jobs to PENDING
            repaired = 0
            for job_id, job in self.db._jobs.items():
                if job.get("status") in ["RUNNING", "FETCHING_MEDIA", "NORMALIZING_MEDIA", "MEDIA_READY", "TRANSCRIBING"]:
                    job["status"] = "PENDING"
                    job["worker_id"] = None
                    job["lease_expires_at"] = None
                    job["updated_at"] = self.db._now()
                    repaired += 1
            return repaired
        
        assert self.db._pool is not None
        async with self.db._pool.acquire() as conn:
            result = await conn.fetchval(
                """
                UPDATE jobs 
                SET status = 'PENDING', 
                    worker_id = NULL,
                    lease_expires_at = NULL,
                    updated_at = NOW()
                WHERE status IN ('RUNNING', 'FETCHING_MEDIA', 'NORMALIZING_MEDIA', 'MEDIA_READY', 'TRANSCRIBING')
                AND updated_at < NOW() - INTERVAL '5 minutes'
                RETURNING COUNT(*)
                """
            )
            return result or 0

    async def repair_expired_leases(self) -> int:
        """Release expired leases and reset jobs to PENDING."""
        if self.db._memory_mode:
            # In memory mode, release expired leases
            repaired = 0
            now = self.db._now()
            for job_id, job in self.db._jobs.items():
                lease_expires = job.get("lease_expires_at")
                if lease_expires and lease_expires < now and job.get("status") in ["RUNNING", "FETCHING_MEDIA", "NORMALIZING_MEDIA", "MEDIA_READY", "TRANSCRIBING"]:
                    job["status"] = "PENDING"
                    job["worker_id"] = None
                    job["lease_expires_at"] = None
                    job["updated_at"] = now
                    repaired += 1
            return repaired
        
        assert self.db._pool is not None
        async with self.db._pool.acquire() as conn:
            result = await conn.fetchval(
                """
                UPDATE jobs 
                SET status = 'PENDING', 
                    worker_id = NULL,
                    lease_expires_at = NULL,
                    updated_at = NOW()
                WHERE status IN ('RUNNING', 'FETCHING_MEDIA', 'NORMALIZING_MEDIA', 'MEDIA_READY', 'TRANSCRIBING')
                AND lease_expires_at < NOW()
                RETURNING COUNT(*)
                """
            )
            return result or 0

    async def get_stuck_jobs(self) -> List[Dict[str, Any]]:
        """Get jobs that are stuck (expired leases or long-running)."""
        if self.db._memory_mode:
            # In memory mode, find stuck jobs
            stuck_jobs = []
            now = self.db._now()
            for job_id, job in self.db._jobs.items():
                status = job.get("status")
                lease_expires = job.get("lease_expires_at")
                updated_at = job.get("updated_at")
                
                is_stuck = False
                if status in ["RUNNING", "FETCHING_MEDIA", "NORMALIZING_MEDIA", "MEDIA_READY", "TRANSCRIBING"]:
                    if lease_expires and lease_expires < now:
                        is_stuck = True
                    elif updated_at and (now - updated_at).total_seconds() > 600:  # 10 minutes
                        is_stuck = True
                
                if is_stuck:
                    stuck_jobs.append({
                        "id": job_id,
                        "status": status,
                        "worker_id": job.get("worker_id"),
                        "lease_expires_at": lease_expires,
                        "updated_at": updated_at,
                        "request_url": job.get("request_url")
                    })
            return stuck_jobs
        
        assert self.db._pool is not None
        async with self.db._pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT id, status, worker_id, lease_expires_at, updated_at, request_url
                FROM jobs 
                WHERE status IN ('RUNNING', 'FETCHING_MEDIA', 'NORMALIZING_MEDIA', 'MEDIA_READY', 'TRANSCRIBING')
                AND (
                    lease_expires_at < NOW() 
                    OR updated_at < NOW() - INTERVAL '10 minutes'
                )
                ORDER BY updated_at ASC
                """
            )
            return [dict(row) for row in rows]

    async def repair_stuck_jobs(self) -> int:
        """Repair all stuck jobs: release leases and reset to PENDING."""
        if self.db._memory_mode:
            # In memory mode, repair stuck jobs
            repaired = 0
            now = self.db._now()
            for job_id, job in self.db._jobs.items():
                status = job.get("status")
                lease_expires = job.get("lease_expires_at")
                updated_at = job.get("updated_at")
                
                is_stuck = False
                if status in ["RUNNING", "FETCHING_MEDIA", "NORMALIZING_MEDIA", "MEDIA_READY", "TRANSCRIBING"]:
                    if lease_expires and lease_expires < now:
                        is_stuck = True
                    elif updated_at and (now - updated_at).total_seconds() > 600:  # 10 minutes
                        is_stuck = True
                
                if is_stuck:
                    job["status"] = "PENDING"
                    job["worker_id"] = None
                    job["lease_expires_at"] = None
                    job["updated_at"] = now
                    repaired += 1
            return repaired
        
        assert self.db._pool is not None
        async with self.db._pool.acquire() as conn:
            result = await conn.fetchval(
                """
                UPDATE jobs 
                SET status = 'PENDING', 
                    worker_id = NULL,
                    lease_expires_at = NULL,
                    updated_at = NOW()
                WHERE status IN ('RUNNING', 'FETCHING_MEDIA', 'NORMALIZING_MEDIA', 'MEDIA_READY', 'TRANSCRIBING')
                AND (
                    lease_expires_at < NOW() 
                    OR updated_at < NOW() - INTERVAL '10 minutes'
                )
                RETURNING COUNT(*)
                """
            )
            return result or 0
