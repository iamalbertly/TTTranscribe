from __future__ import annotations

from typing import Any, Dict

# Re-export all functions from the split modules
from app.api.transcription_routes import (
    TranscribeRequest, UploadResponse,
    start_transcription, get_transcription, upload_and_transcribe, get_transcript_text
)
from app.api.job_routes import (
    get_failed_jobs, clear_failed_jobs, cleanup_old_failed_jobs,
    clear_all_jobs, get_all_jobs_info, clear_jobs_alias,
    get_jobs_summary, get_stuck_jobs, repair_stuck_jobs
)

# This module acts as a stable re-export aggregator for route callables to avoid duplicate imports


