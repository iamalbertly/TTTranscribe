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

# Create necessary directories
RUN mkdir -p .local_storage/transcripts/audio \
    .local_storage/transcripts/transcripts \
    .local_storage/transcripts/keys \
    whisper-cache \
    /tmp/whisper-cache \
    /app/whisper_models_cache

# Pre-warm Whisper model to avoid download issues at runtime
RUN python - <<'PY'
import whisper, os
m = os.environ.get("WHISPER_MODEL","tiny") or "tiny"
print(f"Pre-warming Whisper model: {m}")
# Pre-warm the model and ensure it's cached properly
whisper.load_model(m, download_root="/app/whisper_models_cache")
print("Model ready:", m)
# Verify the model file exists
model_path = f"/app/whisper_models_cache/{m}.pt"
if os.path.exists(model_path):
    print(f"Model cached at: {model_path}")
else:
    print("Warning: Model file not found after download")
PY

# Set environment variables
ENV DATABASE_URL=memory://
ENV ENVIRONMENT=production
ENV WHISPER_MODEL=tiny
ENV WHISPER_CACHE_DIR=/app/whisper_models_cache
ENV CORS_ORIGINS=*
ENV ALLOW_TIKTOK_ADAPTER=true
ENV MAX_AUDIO_SECONDS=300
ENV GLOBAL_REQUESTS_PER_MINUTE=60
# Xet storage configuration for better performance
ENV HF_HUB_ENABLE_HF_TRANSFER=1
ENV TRANSCRIPT_STORAGE=xet
# Fix matplotlib permission issues
ENV MPLCONFIGDIR=/tmp/matplotlib
ENV XDG_CACHE_HOME=/tmp/whisper-cache
ENV HOME=/tmp

# Expose port
EXPOSE 7860

# Run the application directly via uvicorn
CMD ["uvicorn", "app.api.main:app", "--host", "0.0.0.0", "--port", "7860", "--log-level", "debug"]