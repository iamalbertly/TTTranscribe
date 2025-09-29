from __future__ import annotations

from typing import Any, Dict

from fastapi import HTTPException

from app.core.logging import get_logger


logger = get_logger(__name__)


async def get_failed_jobs(limit: int, state: Dict[str, Any]) -> Dict[str, Any]:
    """Get recent failed jobs for debugging."""
    db: Any = state.get("db")
    if db is None:
        raise HTTPException(status_code=503, detail={"code": "unexpected_error", "message": "service not ready"})
    
    failed_jobs = await db.get_failed_jobs(limit)
    return {
        "failed_jobs": failed_jobs,
        "count": len(failed_jobs)
    }


async def clear_failed_jobs(state: Dict[str, Any]) -> Dict[str, Any]:
    """Clear all failed jobs."""
    db: Any = state.get("db")
    if db is None:
        raise HTTPException(status_code=503, detail={"code": "unexpected_error", "message": "service not ready"})
    
    deleted_count = await db.clear_all_failed_jobs()
    return {
        "message": f"Cleared {deleted_count} failed jobs",
        "deleted_count": deleted_count
    }


async def cleanup_old_failed_jobs(hours_old: int, state: Dict[str, Any]) -> Dict[str, Any]:
    """Clean up failed jobs older than specified hours."""
    db: Any = state.get("db")
    if db is None:
        raise HTTPException(status_code=503, detail={"code": "unexpected_error", "message": "service not ready"})
    
    deleted_count = await db.cleanup_old_failed_jobs(hours_old)
    return {
        "message": f"Cleared {deleted_count} failed jobs older than {hours_old} hours",
        "deleted_count": deleted_count,
        "hours_old": hours_old
    }


async def clear_all_jobs(state: Dict[str, Any]) -> Dict[str, Any]:
    db: Any = state.get("db")
    if db is None:
        raise HTTPException(status_code=503, detail={"code": "unexpected_error", "message": "service not ready"})
    deleted_count = await db.clear_all_jobs()
    return {"message": f"Cleared {deleted_count} jobs", "deleted_count": deleted_count}


async def get_all_jobs_info(state: Dict[str, Any]) -> Dict[str, Any]:
    db: Any = state.get("db")
    if db is None:
        raise HTTPException(status_code=503, detail={"code": "unexpected_error", "message": "service not ready"})
    counts = await db.queue_counts_per_status()
    return {
        "message": "Use DELETE /jobs/all to clear all jobs (dev only).",
        "queue_counts": counts,
    }


async def clear_jobs_alias(state: Dict[str, Any]) -> Dict[str, Any]:
    return await clear_all_jobs(state)


async def get_jobs_summary(state: Dict[str, Any]) -> Dict[str, Any]:
    db: Any = state.get("db")
    if db is None:
        raise HTTPException(status_code=503, detail={"code": "unexpected_error", "message": "service not ready"})
    summary: Dict[str, Any] = {"queue_counts": await db.queue_counts_per_status()}
    try:
        summary["failed_recent"] = await db.get_failed_jobs(limit=10)
        summary["stuck"] = await db.get_stuck_jobs()
    except Exception:
        pass
    return summary


async def get_stuck_jobs(state: Dict[str, Any]) -> Dict[str, Any]:
    """Get jobs that are stuck (expired leases or long-running)."""
    db: Any = state.get("db")
    if db is None:
        raise HTTPException(status_code=503, detail={"code": "unexpected_error", "message": "service not ready"})
    
    stuck_jobs = await db.get_stuck_jobs()
    return {
        "stuck_jobs": stuck_jobs,
        "count": len(stuck_jobs)
    }


async def repair_stuck_jobs(state: Dict[str, Any]) -> Dict[str, Any]:
    """Repair all stuck jobs: release leases and reset to PENDING."""
    db: Any = state.get("db")
    if db is None:
        raise HTTPException(status_code=503, detail={"code": "unexpected_error", "message": "service not ready"})
    
    repaired_count = await db.repair_stuck_jobs()
    return {
        "message": f"Repaired {repaired_count} stuck jobs",
        "repaired_count": repaired_count
    }
