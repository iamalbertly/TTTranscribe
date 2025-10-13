#!/bin/bash

# TTTranscribe startup script for Hugging Face Spaces
set -e

echo "🚀 Starting TTTranscribe service..."

# Check if required environment variables are set
if [ -z "$ENGINE_SHARED_SECRET" ]; then
    echo "❌ ERROR: ENGINE_SHARED_SECRET environment variable is required"
    exit 1
fi

if [ -z "$HF_API_KEY" ]; then
    echo "❌ ERROR: HF_API_KEY environment variable is required"
    exit 1
fi

# Create temp directory in a location allowed by Hugging Face Spaces
mkdir -p /tmp/ttt || echo "Warning: Could not create /tmp/ttt, using alternative location"
# Try alternative locations that are typically writable in Hugging Face Spaces
export TMP_DIR=${TMP_DIR:-/tmp}

# Set default environment variables if not provided
export PORT=${PORT:-8788}
export TMP_DIR=${TMP_DIR:-/tmp}
export KEEP_TEXT_MAX=${KEEP_TEXT_MAX:-10000}
export ASR_PROVIDER=${ASR_PROVIDER:-hf}

echo "📋 Configuration:"
echo "   Port: $PORT"
echo "   Temp Dir: $TMP_DIR"
echo "   ASR Provider: $ASR_PROVIDER"
echo "   Auth Secret: ${ENGINE_SHARED_SECRET:0:8}..."
echo "   HF API Key: ${HF_API_KEY:0:8}..."

# Start the server
echo "🎯 Starting server on port $PORT..."
exec node dist/index.js
