from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

from app.core.config import get_settings
from app.core.logging import get_logger
from app.store.job_manager import JobManager
from app.store.core_db import CoreDatabase


logger = get_logger(__name__)


class Database(CoreDatabase):
    """Database with job management capabilities."""
    
    def __init__(self, dsn: Optional[str] = None):
        super().__init__(dsn)
        # Initialize job manager
        self.job_manager = JobManager(self)


    # Delegate job management methods to JobManager
    async def cleanup_old_failed_jobs(self, hours_old: int = 24) -> int:
        return await self.job_manager.cleanup_old_failed_jobs(hours_old)

    async def get_failed_jobs(self, limit: int = 50) -> list[Dict[str, Any]]:
        return await self.job_manager.get_failed_jobs(limit)

    async def clear_all_failed_jobs(self) -> int:
        return await self.job_manager.clear_all_failed_jobs()

    async def clear_all_jobs(self) -> int:
        return await self.job_manager.clear_all_jobs()

    async def release_orphaned_jobs(self, max_age_minutes: int = 10) -> int:
        return await self.job_manager.release_orphaned_jobs(max_age_minutes)

    async def repair_stuck_jobs_on_startup(self) -> int:
        return await self.job_manager.repair_stuck_jobs_on_startup()

    async def repair_expired_leases(self) -> int:
        return await self.job_manager.repair_expired_leases()

    async def get_stuck_jobs(self) -> list[Dict[str, Any]]:
        return await self.job_manager.get_stuck_jobs()

    async def repair_stuck_jobs(self) -> int:
        return await self.job_manager.repair_stuck_jobs()


