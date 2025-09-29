from __future__ import annotations

import asyncio
from typing import Any, Dict, List

from app.core.config import get_settings
from app.core.logging import get_logger


logger = get_logger(__name__)


JOB_STATUSES: List[str] = [
    "PENDING",
    "FETCHING_MEDIA",
    "NORMALIZING_MEDIA",
    "MEDIA_READY",
    "TRANSCRIBING",
    "COMPLETE",
    "FAILED",
]


async def run_worker_loop(db, storage, whisper_model, settings=None, fetch_sem: asyncio.Semaphore | None = None, transcribe_sem: asyncio.Semaphore | None = None) -> None:
    """
    Main worker loop. Assumes db, storage, and whisper_model are pre-initialized
    and stable for the lifetime of this process. Never re-creates these clients.
    """
    if settings is None:
        settings = get_settings()

    fetch_sem = fetch_sem or asyncio.Semaphore(max(1, settings.max_concurrent_fetches))
    transcribe_sem = transcribe_sem or asyncio.Semaphore(max(1, settings.max_concurrent_transcribes))

    poll_interval = max(1, settings.worker_poll_interval_seconds)
    lease_seconds = max(30, settings.worker_lease_seconds)
    worker_id = settings.worker_id

    async def _process_fetch(job: Dict[str, Any]):
        from app.services.fetchers import fetch_media_stage, FetchError
        async with fetch_sem:
            job_id = job["id"] if "id" in job else job.get("id")
            try:
                # Renew lease midway through fetch
                renew_at = lease_seconds / 2
                renew_task = asyncio.create_task(_periodic_renew(db, job_id, lease_seconds, renew_at))
                media_bytes, meta = await fetch_media_stage(job_id, job["request_url"], db, storage, settings)
                renew_task.cancel()
                return media_bytes
            except FetchError as e:
                error_msg = str(e) if str(e) else "extraction_error"
                await db.update_status(job_id, "FAILED", error_message=error_msg)
                await db.release_job_lease(job_id)
                logger.error("fetch failed", extra={"component": "worker", "job_id": job_id, "error": error_msg})
                
                # In development, log the error but continue processing other jobs
                if settings.environment == "development":
                    logger.warning("Development mode: fetch failed but continuing to process other jobs", 
                                  extra={"component": "worker", "job_id": job_id, "error": error_msg})
            except Exception as e:
                error_msg = f"fetch_error: {str(e)}" if str(e) else "unexpected_error"
                await db.update_status(job_id, "FAILED", error_message=error_msg)
                await db.release_job_lease(job_id)
                logger.error("fetch failed with unexpected error", extra={"component": "worker", "job_id": job_id, "error": str(e)})
                
                # In development, log the error but continue processing other jobs
                if settings.environment == "development":
                    logger.warning("Development mode: unexpected fetch error but continuing to process other jobs", 
                                  extra={"component": "worker", "job_id": job_id, "error": str(e)})

    async def _process_normalize(job: Dict[str, Any], media_bytes: bytes):
        from app.services.normalize import normalize_and_hash_stage, NormalizeError
        job_id = job["id"]
        try:
            norm_path, content_hash, duration = await normalize_and_hash_stage(job_id, db, storage, settings, fetched_bytes=media_bytes)
            return norm_path, content_hash, duration
        except NormalizeError as e:
            msg = str(e) if str(e) else "normalize_error"
            await db.update_status(job_id, "FAILED", error_message=msg)
            await db.release_job_lease(job_id)
            logger.error("normalize failed", extra={"component": "worker", "job_id": job_id, "error": msg})
            
            # In development, log the error but continue processing other jobs
            if settings.environment == "development":
                logger.warning("Development mode: normalize failed but continuing to process other jobs", 
                              extra={"component": "worker", "job_id": job_id, "error": msg})

    async def _process_transcribe(job: Dict[str, Any]):
        from app.services.transcribe import run_transcription_stage
        async with transcribe_sem:
            job_id = job["id"]
            try:
                renew_at = lease_seconds / 2
                renew_task = asyncio.create_task(_periodic_renew(db, job_id, lease_seconds, renew_at))
                result = await run_transcription_stage(job_id, db, storage, whisper_model, settings)
                renew_task.cancel()
                await db.release_job_lease(job_id)
            except Exception as e:
                error_msg = f"transcription_error: {str(e)}" if str(e) else "transcription_error"
                await db.update_status(job_id, "FAILED", error_message=error_msg)
                await db.release_job_lease(job_id)
                logger.error("transcription failed", extra={"component": "worker", "job_id": job_id, "error": str(e)})
                
                # In development, log the error but continue processing other jobs
                if settings.environment == "development":
                    logger.warning("Development mode: transcription failed but continuing to process other jobs", 
                                  extra={"component": "worker", "job_id": job_id, "error": str(e)})

    async def _periodic_renew(db, job_id: str, lease_seconds: int, interval: float):
        try:
            while True:
                await asyncio.sleep(interval)
                await db.renew_lease(job_id, lease_seconds)
        except asyncio.CancelledError:
            return

    logger.info("worker started", extra={"component": "worker", "job_id": "startup", "worker_id": worker_id})
    
    # Startup repair: fix any stuck jobs from previous runs
    try:
        startup_repair_count = await db.repair_stuck_jobs_on_startup()
        if startup_repair_count > 0:
            logger.info("startup repair completed", extra={
                "component": "worker", 
                "job_id": "startup", 
                "worker_id": worker_id, 
                "repaired_count": startup_repair_count
            })
    except Exception as e:
        logger.error("startup repair failed", extra={
            "component": "worker", 
            "job_id": "startup", 
            "worker_id": worker_id, 
            "error": str(e)
        })
    
    try:
        while True:
            # Heartbeat
            counts = await db.queue_counts_per_status()
            logger.info(
                "heartbeat",
                extra={
                    "component": "worker",
                    "job_id": "heartbeat",
                    "worker_id": worker_id,
                    "counts": counts,
                },
            )

            # Cleanup old failed jobs every 10 heartbeats (roughly every 5 minutes)
            if hasattr(run_worker_loop, '_heartbeat_count'):
                run_worker_loop._heartbeat_count += 1
            else:
                run_worker_loop._heartbeat_count = 1
            
            if run_worker_loop._heartbeat_count % 10 == 0:
                try:
                    deleted_count = await db.cleanup_old_failed_jobs(hours_old=1)  # Clean jobs older than 1 hour
                    if deleted_count > 0:
                        logger.info(
                            "cleaned up old failed jobs",
                            extra={
                                "component": "worker",
                                "job_id": "cleanup",
                                "worker_id": worker_id,
                                "deleted_count": deleted_count,
                            },
                        )
                except Exception as e:
                    logger.error(
                        "failed to cleanup old jobs",
                        extra={
                            "component": "worker",
                            "job_id": "cleanup",
                            "worker_id": worker_id,
                            "error": str(e),
                        },
                    )
            
            # Orphan sweep: mark stuck RUNNING jobs as FAILED every 5 heartbeats
            if run_worker_loop._heartbeat_count % 5 == 0:
                try:
                    orphan_count = await db.release_orphaned_jobs(max_age_minutes=10)  # Jobs stuck for 10+ minutes
                    if orphan_count > 0:
                        logger.info(
                            "released orphaned jobs",
                            extra={
                                "component": "worker",
                                "job_id": "orphan_sweep",
                                "worker_id": worker_id,
                                "orphan_count": orphan_count,
                            },
                        )
                except Exception as e:
                    logger.error(
                        "failed to release orphaned jobs",
                        extra={
                            "component": "worker",
                            "job_id": "orphan_sweep",
                            "worker_id": worker_id,
                            "error": str(e),
                        },
                    )
            
            # Lease repair: release expired leases every 3 heartbeats
            if run_worker_loop._heartbeat_count % 3 == 0:
                try:
                    lease_repair_count = await db.repair_expired_leases()
                    if lease_repair_count > 0:
                        logger.info(
                            "repaired expired leases",
                            extra={
                                "component": "worker",
                                "job_id": "lease_repair",
                                "worker_id": worker_id,
                                "repaired_count": lease_repair_count,
                            },
                        )
                except Exception as e:
                    logger.error(
                        "failed to repair expired leases",
                        extra={
                            "component": "worker",
                            "job_id": "lease_repair",
                            "worker_id": worker_id,
                            "error": str(e),
                        },
                    )

            progressed = False

            # PENDING → FETCH+NORMALIZE
            pending = await db.claim_jobs("PENDING", limit= settings.max_concurrent_fetches, worker_id=worker_id, lease_seconds=lease_seconds)
            if pending:
                progressed = True
                tasks = []
                for job in pending:
                    async def _handle(job=job):
                        try:
                            media_bytes = await _process_fetch(job)
                            if not media_bytes:
                                return
                            normalize_result = await _process_normalize(job, media_bytes)
                            if not normalize_result:
                                return
                            norm_path, content_hash, duration = normalize_result
                            # If job was completed due to cache hit, nothing to do
                            job_after = await db.get_job(job["id"])
                            if job_after and job_after.get("status") == "COMPLETE":
                                await db.release_job_lease(job["id"])
                                return
                            await _process_transcribe(job)
                        except asyncio.CancelledError:
                            raise
                        except Exception as e:
                            error_msg = f"pipeline_error: {str(e)}" if str(e) else "unexpected_error"
                            await db.update_status(job["id"], "FAILED", error_message=error_msg)
                            await db.release_job_lease(job["id"])
                            logger.error("pipeline failed", extra={"component": "worker", "job_id": job["id"], "error": str(e)})
                            
                            # In development, log the error but continue processing other jobs
                            if settings.environment == "development":
                                logger.warning("Development mode: pipeline failed but continuing to process other jobs", 
                                              extra={"component": "worker", "job_id": job["id"], "error": str(e)})
                    tasks.append(asyncio.create_task(_handle()))
                await asyncio.gather(*tasks, return_exceptions=True)

            if not progressed:
                await asyncio.sleep(poll_interval)
    except asyncio.CancelledError:
        logger.info("worker shutdown requested", extra={"component": "worker", "job_id": "shutdown", "worker_id": worker_id})
        return


