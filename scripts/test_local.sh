#!/usr/bin/env bash
set -euo pipefail

echo "Prerequisites:"
echo " - Ensure ffmpeg and yt-dlp are installed and on your PATH."
echo " - Start the app in another terminal: python main.py"

sleep 10

echo "Checking /health..."
code=$(curl -s -o /tmp/health.json -w "%{http_code}" http://localhost:8000/health)
if [ "$code" != "200" ]; then echo "Health HTTP $code"; cat /tmp/health.json; exit 1; fi
cat /tmp/health.json
worker=$(jq -r '.worker_active' /tmp/health.json)
dbok=$(jq -r '.db_ok' /tmp/health.json)
ytdlp=$(jq -r '.yt_dlp_ok' /tmp/health.json)
ffok=$(jq -r '.ffmpeg_ok' /tmp/health.json)
if [ "$worker" != "true" ] || [ "$dbok" != "true" ] || [ "$ytdlp" != "true" ] || [ "$ffok" != "true" ]; then
  echo "Health checks failed"; exit 1;
fi

echo "Submitting job..."
payload=$(jq -n --arg url "https://vm.tiktok.com/ZMA2jFqyJ" --arg key "$(uuidgen)" '{url:$url, idempotency_key:$key}')
code=$(curl -s -o /tmp/submit.json -w "%{http_code}" -H 'Content-Type: application/json' -d "$payload" http://localhost:8000/transcribe)
if [ "$code" != "202" ]; then echo "Submit HTTP $code"; cat /tmp/submit.json; exit 1; fi
job=$(jq -r '.job_id' /tmp/submit.json)
[ -n "$job" ] || { echo "No job_id"; exit 1; }

start=$(date +%s)
echo "Polling job $job..."
while true; do
  sleep 5
  code=$(curl -s -o /tmp/job.json -w "%{http_code}" http://localhost:8000/transcribe/$job)
  if [ "$code" -ge 400 ]; then echo "FAILED"; cat /tmp/job.json; exit 1; fi
  status=$(jq -r '.status' /tmp/job.json)
  if [ "$status" = "COMPLETE" ]; then
    end=$(date +%s); elapsed=$((end-start))
    echo "COMPLETE in ${elapsed}s"
    hit=$(jq -r '.data.cache_hit' /tmp/job.json)
    if [ "$hit" != "false" ]; then echo "Expected cache_hit:false"; exit 1; fi
    break
  else
    echo "Status: $status"
  fi
done

echo "Done."


