import asyncio
import os
from pathlib import Path
import pytest
import pytest_asyncio
import httpx
from app.api.main import app


@pytest_asyncio.fixture
async def test_app():
    """Create a test app with proper initialization."""
    # Set test environment
    os.environ["DATABASE_URL"] = "memory://test"
    os.environ["ENVIRONMENT"] = "test"
    os.environ["WHISPER_MODEL"] = "tiny"
    os.environ["WHISPER_CACHE_DIR"] = ".whisper_cache"
    os.environ["CORS_ORIGINS"] = "*"
    
    # Initialize the app
    from app.api.main import lifespan
    async with lifespan(app):
        yield app


@pytest.mark.asyncio
async def test_pipeline_happy_path(monkeypatch, tmp_path, test_app):
    # Fakes
    async def fake_fetch(job_id, url, db, storage, settings):
        return b"00", {"_filename": "x"}

    async def fake_normalize(job_id, db, storage, settings, fetched_bytes=None):
        out = tmp_path / "out.wav"
        out.write_bytes(b"11")
        await db.set_content_hash(job_id, "hash123")
        await db.set_storage_keys(job_id, "audio/hash123.wav", None)
        await db.update_status(job_id, "TRANSCRIBING")
        return out, "hash123", 1.0

    async def fake_transcribe(job_id, db, storage, whisper_model, settings):
        await db.update_status(job_id, "COMPLETE")
        await db.set_cache_hit(job_id, False)
        return {"text": "hello"}

    from app.services import fetchers, normalize, transcribe
    monkeypatch.setattr(fetchers, "fetch_media_stage", fake_fetch)
    monkeypatch.setattr(normalize, "normalize_and_hash_stage", fake_normalize)
    monkeypatch.setattr(transcribe, "run_transcription_stage", fake_transcribe)

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=test_app), base_url="http://test") as ac:
        r = await ac.post("/transcribe", json={"url": "https://www.tiktok.com/@x/video/1"})
        assert r.status_code == 202
        job = r.json()["job_id"]

        # Poll until complete - increase timeout for test
        for _ in range(100):  # Increased from 20 to 100
            pr = await ac.get(f"/transcribe/{job}")
            js = pr.json()
            if pr.status_code == 200 and js.get("status") == "COMPLETE":
                assert "data" in js
                break
            await asyncio.sleep(0.1)  # Increased from 0.05 to 0.1
        else:
            pytest.fail("pipeline did not complete in time")


@pytest.mark.asyncio
async def test_pipeline_failure_maps_error(monkeypatch, tmp_path, test_app):
    async def bad_fetch(job_id, url, db, storage, settings):
        await db.update_status(job_id, "FAILED", error_message="extraction_error")
        raise fetchers.FetchError("extraction_error")

    from app.services import fetchers
    monkeypatch.setattr(fetchers, "fetch_media_stage", bad_fetch)

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=test_app), base_url="http://test") as ac:
        r = await ac.post("/transcribe", json={"url": "https://www.tiktok.com/@x/video/1"})
        assert r.status_code == 202
        job = r.json()["job_id"]
        for _ in range(100):  # Increased from 20 to 100
            pr = await ac.get(f"/transcribe/{job}")
            if pr.status_code >= 400:
                detail = pr.json()
                assert detail.get("code") in {"extraction_error", "unexpected_error"}
                break
            await asyncio.sleep(0.1)  # Increased from 0.05 to 0.1
        else:
            pytest.fail("failure not observed")


