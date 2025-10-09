from typing import Optional, Dict, Any
from pydantic import BaseModel


class TranscribeRequest(BaseModel):
    url: str


class TranscribeResponse(BaseModel):
    request_id: str
    status: str
    lang: str
    duration_sec: float
    transcript: str
    transcript_sha256: str
    source: Dict[str, Any]
    billed_tokens: int
    elapsed_ms: int
    ts: str
    job_id: Optional[str] = None


