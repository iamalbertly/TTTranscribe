#!/bin/bash

# TTTranscribe startup script for Hugging Face Spaces
set -e

echo "🚀 Starting TTTranscribe service..."

# Set default environment variables
export PORT=${PORT:-8788}
export TMP_DIR=${TMP_DIR:-/tmp}
export KEEP_TEXT_MAX=${KEEP_TEXT_MAX:-10000}
export ASR_PROVIDER=${ASR_PROVIDER:-hf}

# Start the server (environment detection and configuration handled internally)
echo "🎯 Starting server on port $PORT..."
exec node dist/TTTranscribe-Server-Main-Entry.js
