import pytest
import httpx
from app.api.main import app


@pytest.mark.asyncio
async def test_health_ok():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.get("/health")
        assert r.status_code == 200
        data = r.json()
        assert data.get("status") == "ok"
        for key in ["worker_active", "db_ok", "yt_dlp_ok", "ffmpeg_ok", "whisper_model", "environment", "queue_counts", "semaphores"]:
            assert key in data


