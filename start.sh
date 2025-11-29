#!/bin/bash

# TTTranscribe startup script for Hugging Face Spaces
set -e

echo "🚀 Starting TTTranscribe service..."

# Set default environment variables
export PORT=${PORT:-8788}
export TMP_DIR=${TMP_DIR:-/tmp}
export KEEP_TEXT_MAX=${KEEP_TEXT_MAX:-10000}
export ASR_PROVIDER=${ASR_PROVIDER:-hf}

echo "Preparing runtime environment..."

# If apt.txt is present, try to install requested apt packages (ffmpeg etc.)
if [ -f apt.txt ]; then
	echo "Found apt.txt - attempting to install apt packages listed there"
	sudo apt-get update || true
	xargs -a apt.txt -r sudo apt-get install -y || true
fi

# If requirements.txt is present, try to install Python packages (yt-dlp)
if [ -f requirements.txt ]; then
	echo "Found requirements.txt - attempting to install Python packages"
	# Use system python/pip that exists in Spaces
	if command -v python3 >/dev/null 2>&1; then
		python3 -m pip install --upgrade pip setuptools wheel || true
		python3 -m pip install -r requirements.txt --no-cache-dir || true
	elif command -v python >/dev/null 2>&1; then
		python -m pip install --upgrade pip setuptools wheel || true
		python -m pip install -r requirements.txt --no-cache-dir || true
	else
		echo "No python runtime found - skipping pip install"
	fi
fi

echo "🎯 Starting server on port $PORT..."
exec node dist/TTTranscribe-Server-Main-Entry.js
