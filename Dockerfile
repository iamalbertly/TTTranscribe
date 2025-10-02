FROM python:3.11-slim

# Install system dependencies (ffmpeg required for audio processing)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    git \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy requirements first for better caching
COPY requirements.txt .

# Install PyTorch CPU version first
RUN pip install --no-cache-dir torch==2.2.2 --index-url https://download.pytorch.org/whl/cpu

# Install other Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create necessary directories with proper permissions
RUN mkdir -p /tmp/whisper-cache \
    /app/whisper_models_cache \
    /tmp/huggingface \
    /tmp/whisper-cache/huggingface \
    && chmod -R 777 /tmp/whisper-cache \
    && chmod -R 777 /tmp/huggingface \
    && chmod -R 777 /app/whisper_models_cache

# Pre-warm faster-whisper model to avoid download issues at runtime
RUN python - <<'PY'
from faster_whisper import WhisperModel
import os
m = os.environ.get("WHISPER_MODEL", "tiny") or "tiny"
print(f"Pre-warming faster-whisper model: {m}")

# Ensure cache directories exist
cache_dirs = ["/tmp/whisper-cache", "/tmp/huggingface", "/tmp/whisper-cache/huggingface", "/app/whisper_models_cache"]
for cache_dir in cache_dirs:
    os.makedirs(cache_dir, exist_ok=True)
    os.chmod(cache_dir, 0o777)

# Pre-warm the model and ensure it's cached properly
try:
    model = WhisperModel(m, device="cpu", compute_type="int8")
    print("Model ready:", m)
    print("faster-whisper model loaded successfully")
except Exception as e:
    print(f"Warning: Failed to pre-warm model: {e}")
    print("Model will be downloaded at runtime")
PY

# Set environment variables
ENV WHISPER_MODEL=tiny
ENV WHISPER_CACHE_DIR=/app/whisper_models_cache
# Fix matplotlib permission issues
ENV MPLCONFIGDIR=/tmp/matplotlib
ENV XDG_CACHE_HOME=/tmp/whisper-cache
ENV HOME=/tmp
# Set Hugging Face cache directory to avoid permission issues
ENV HF_HOME=/tmp/huggingface
ENV HF_HUB_CACHE=/tmp/whisper-cache/huggingface

# Expose port
EXPOSE 7860

# Run the application directly
CMD ["python", "main.py"]