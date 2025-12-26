# TTTranscribe → Business Engine Log Handoff
## Purpose
Compiled evidence from the latest production run so Business Engine can trace, fix, and re-test webhook handling and TikTok download behavior.

## Environment Snapshot (from `.env.local`)
- `PLUCT_BASE_URL`: `https://pluct-business-engine.romeo-lya2.workers.dev`
- `TTT_SHARED_SECRET` / `JWT_SECRET`: `hf_sUP3rL0nGrANd0mAp1K3yV4xYb2pL6nM8zJ9fQ1cD5eS7tT0rW3gU`
- `ENGINE_SHARED_SECRET` / `ENGINE_ADMIN_KEY`: `engine-shared-secret-Yf9pR3kLx2tN6vQ4mC1aS8bE5wG7zH0jU9rK3dP6qT1nV8xL4fZ2yM7cJ5aB9eR`
- `API_KEY`: `key_live_89f590e1f8cd3e4b19cfcf14`
- `API_SECRET`: `7eba1e62f419066eebbbafd91e44e2d357d8f21b57a75c9a4e3201ba31fa1a1a`
- Webhook target (from health/config): `https://pluct-business-engine.romeo-lya2.workers.dev/webhooks/tttranscribe`

## Recent Run (production)
- **When**: 2025-12-26T02:40:08Z
- **Request ID**: `d6e5527c-c925-454d-b58e-293c2b7de58e`
- **Video URL**: `https://www.tiktok.com/@joshwellerjoshweller/video/7583306314663742742`
- **Auth**: static secret accepted
- **Outcome**: Transcription finished, cached; webhook delivery failed (DNS)

### Raw realtime logs
```
[auth] Static secret authenticated
Cache miss for https://www.tiktok.com/@joshwellerjoshweller/video/7583306314663742742, processing normally
{"requestId":"d6e5527c-c925-454d-b58e-293c2b7de58e","phase":"REQUEST_SUBMITTED","percent":0,"note":"queued","msSinceStart":1,"timestamp":"2025-12-26T02:40:08.466Z","estimatedCompletion":"2025-12-26T02:40:18.466Z"}
ttt:accepted req=d6e5527c-c925-454d-b58e-293c2b7de58e url=314663742742
{"requestId":"d6e5527c-c925-454d-b58e-293c2b7de58e","phase":"DOWNLOADING","percent":15,"note":"Downloading audio","msSinceStart":2,"timestamp":"2025-12-26T02:40:08.467Z","estimatedCompletion":"2025-12-26T02:40:18.466Z"}
[download] Attempting with: /opt/venv/bin/yt-dlp args=-x --audio-format wav --no-playlist --geo-bypass --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36" --referer "https://www.tiktok.com/" --impersonate chrome
[download] Failed with /opt/venv/bin/yt-dlp args=-x --audio-format wav --no-playlist --geo-bypass --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36" --referer "https://www.tiktok.com/" --impersonate chrome
[download] Attempting with: /opt/venv/bin/yt-dlp args=-x --audio-format wav --no-playlist --geo-bypass --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36" --referer "https://www.tiktok.com/" --impersonate chrome --force-ipv4
[download] Failed with /opt/venv/bin/yt-dlp args=-x --audio-format wav --no-playlist --geo-bypass --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36" --referer "https://www.tiktok.com/" --impersonate chrome --force-ipv4
[download] Attempting with: /opt/venv/bin/yt-dlp args=-x --audio-format wav --no-playlist --geo-bypass --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36" --referer "https://www.tiktok.com/" --impersonate chrome --extractor-args "tiktok:app_version=34.1.2;device_platform=android"
[download] Failed with /opt/venv/bin/yt-dlp args=-x --audio-format wav --no-playlist --geo-bypass --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36" --referer "https://www.tiktok.com/" --impersonate chrome --extractor-args "tiktok:app_version=34.1.2;device_platform=android"
[download] Attempting with: /usr/local/bin/yt-dlp ...
[download] Failed with /usr/local/bin/yt-dlp ... (same args; multiple retries incl. --force-ipv4 and extractor args)
[download] Attempting with: /usr/bin/yt-dlp ...
[download] Failed with /usr/bin/yt-dlp ... (same args; multiple retries incl. --force-ipv4 and extractor args)
[download] Attempting with: yt-dlp ...
[download] Failed with yt-dlp ... (same args; multiple retries incl. --force-ipv4 and extractor args)
[download] yt-dlp failed for https://www.tiktok.com/@joshwellerjoshweller/video/7583306314663742742, trying TikWM fallback... (Unable to bypass TikTok's bot protection. The service needs additional configuration.)
[tikwm] Fallback download + convert succeeded
{"requestId":"d6e5527c-c925-454d-b58e-293c2b7de58e","phase":"TRANSCRIBING","percent":35,"note":"Transcribing audio","msSinceStart":4049,"timestamp":"2025-12-26T02:40:12.514Z","estimatedCompletion":"2025-12-26T02:40:42.514Z"}
[transcribe] Using local faster-whisper (preferred method)
[local-whisper] Successfully transcribed 454 characters
{"requestId":"d6e5527c-c925-454d-b58e-293c2b7de58e","phase":"COMPLETED","percent":100,"note":"I'm gonna use a little refrigerator (Keywords: gonna, little, peter)","msSinceStart":19497,"timestamp":"2025-12-26T02:40:27.962Z"}
Cached result for https://www.tiktok.com/@joshwellerjoshweller/video/7583306314663742742?_r=1&_t=ZM-92FAMHCw3JL
[webhook] Sending webhook for job d6e5527c-c925-454d-b58e-293c2b7de58e to https://pluct-business-engine.romeo-lya2.workers.dev/webhooks/tttranscribe
[webhook] Idempotency key: 982d9c27b7a5deb27ebacc77f183d7a3fc685942b150c15e1205ec32cb79e015
[webhook] Usage: 35.81s audio, 454 chars
[webhook] Failed to deliver: request to https://pluct-business-engine.romeo-lya2.workers.dev/webhooks/tttranscribe failed, reason: getaddrinfo ENOTFOUND pluct-business-engine.romeo-lya2.workers.dev
[webhook] Client should poll /status/d6e5527c-c925-454d-b58e-293c2b7de58e instead
```

## Findings (what went wrong and why)
1) **TikTok download stage**: All `yt-dlp` attempts failed with TikTok bot protection even after impersonation, IPv4 forcing, and extractor args. The built-in TikWM fallback succeeded, so transcription completed. Action: if we want first-pass success without fallback, supply fresh TikTok cookies/session headers or an app-version/device profile to `yt-dlp`.
2) **Webhook delivery**: Final webhook to `pluct-business-engine.romeo-lya2.workers.dev/webhooks/tttranscribe` failed with `getaddrinfo ENOTFOUND` (DNS lookup failed). This indicates the hostname is not resolvable or mis-typed. Impact: Business Engine never receives completion notifications; clients must poll `/status/:id`.
3) **Authentication**: Static secret authentication is working (multiple `[auth] Static secret authenticated` entries). No auth errors observed.
4) **Caching**: Result cached after completion; repeat requests for the same URL will short-circuit to cache until expiry.

## Actions needed from Business Engine
- **Fix DNS/endpoint**: Ensure `pluct-business-engine.romeo-lya2.workers.dev` resolves and serves `POST /webhooks/tttranscribe` with status 200. Today it is not resolvable (`ENOTFOUND`), so nothing is receiving the webhook.
- **Confirm webhook secret**: TTTranscribe signs with `TTT_SHARED_SECRET` (`hf_sUP3rL0nGrANd0mAp1K3yV4xYb2pL6nM8zJ9fQ1cD5eS7tT0rW3gU`). Verify requests with `X-Webhook-Signature` HMAC-SHA256(body, secret).
- **End-to-end test after DNS fix**: Submit any TikTok URL, observe webhook receipt, and confirm TTTranscribe health shows `queueSize` dropping to 0.

## Optional TTTranscribe-side tuning
- Provide a TikTok cookie jar / verified app headers to `yt-dlp` to reduce reliance on TikWM fallback.
- Keep current logging level (already shows toolchain, args, and failure reason). No code changes are currently required; service behavior is as designed.

## Quick re-test checklist (after DNS fix)
1. Call `POST https://iamromeoly-tttranscribe.hf.space/transcribe` with JWT or static secret; note job ID.
2. Watch logs for `[webhook] Succeeded` or poll `/status/<jobId>` until completed.
3. Verify Business Engine receives the webhook and returns 2xx.
4. Confirm TTTranscribe `/health` shows `webhook.queueSize` is not growing.
