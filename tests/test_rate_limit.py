import asyncio
import pytest
import httpx
from app.api.main import app


@pytest.mark.asyncio
async def test_rate_limit_trips(monkeypatch):
    # Force low RPM for test
    monkeypatch.setenv("GLOBAL_REQUESTS_PER_MINUTE", "2")
    results = []
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as ac:
        for _ in range(6):
            r = await ac.post("/transcribe", json={"url": "https://www.tiktok.com/@x/video/1"})
            results.append(r)

    assert any(resp.status_code == 429 for resp in results)
    for resp in results:
        if resp.status_code == 429:
            assert resp.headers.get("Retry-After") is not None


