from __future__ import annotations

from pathlib import Path
from typing import Optional

import httpx

from app.core.config import get_settings
from app.core.logging import get_logger


logger = get_logger(__name__)


class SupabaseStorage:
    def __init__(self, client: Optional[httpx.AsyncClient] = None):
        self.settings = get_settings()
        self._client = client or httpx.AsyncClient(timeout=60)
        # Local dev fallback: if Supabase URL or keys are missing, write to local filesystem
        self._use_local = not (self.settings.supabase_url and self.settings.supabase_service_role_key)
        if self._use_local:
            root = Path(self.settings.local_storage_root)
            self._local_root = root / self.settings.supabase_storage_bucket
            self._local_root.mkdir(parents=True, exist_ok=True)
            logger.info(
                "using local storage fallback",
                extra={"component": "storage", "job_id": "n/a", "path": str(self._local_root)},
            )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def put(self, local_path: Path, object_name: str) -> str:
        # Returns the storage key (object path within the bucket)
        if self._use_local:
            dest = self._local_root / object_name
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(local_path.read_bytes())
            logger.info(
                "stored locally",
                extra={"component": "storage", "job_id": "n/a", "object": object_name, "path": str(dest)},
            )
            return object_name
        url = f"{self.settings.supabase_url}/storage/v1/object/{self.settings.supabase_storage_bucket}/{object_name}"
        headers = {"Authorization": f"Bearer {self.settings.supabase_service_role_key}"}
        with local_path.open("rb") as f:
            resp = await self._client.post(url, headers=headers, content=f.read())
            resp.raise_for_status()
        logger.info("uploaded to storage", extra={"component": "storage", "job_id": "n/a", "object": object_name})
        return object_name

    async def get(self, object_name: str) -> bytes:
        if self._use_local:
            src = self._local_root / object_name
            data = src.read_bytes()
            return data
        url = f"{self.settings.supabase_url}/storage/v1/object/{self.settings.supabase_storage_bucket}/{object_name}"
        headers = {"Authorization": f"Bearer {self.settings.supabase_service_role_key}"}
        resp = await self._client.get(url, headers=headers)
        resp.raise_for_status()
        return resp.content

    def public_url(self, object_name: str) -> str:
        """
        Return a publicly accessible URL for the given storage object.
        - Local fallback: serve via FastAPI mounts under /files/
        - Supabase: assumes bucket is public; use /object/public path
        """
        if self._use_local:
            # Mounted in app.api.main as /files/audio and /files/transcripts
            return f"/files/{object_name}"
        base = self.settings.supabase_url.rstrip("/")
        bucket = self.settings.supabase_storage_bucket
        return f"{base}/storage/v1/object/public/{bucket}/{object_name}"


# Xet storage integration for better performance
def get_storage():
    """
    Get the appropriate storage backend based on environment configuration
    """
    import os
    from .storage_xet import XetStorage
    from .storage_hf_dataset import HFDatasetStorage
    
    backend = os.getenv("TRANSCRIPT_STORAGE", "xet")
    
    if backend == "xet":
        try:
            return XetStorage()
        except Exception as e:
            logger.warning(f"Xet storage failed, falling back to HF dataset: {e}")
            return HFDatasetStorage()
    elif backend == "hf-dataset":
        return HFDatasetStorage()
    else:
        # Default to SupabaseStorage for backward compatibility
        return SupabaseStorage()


