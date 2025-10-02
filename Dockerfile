FROM python:3.11-slim

# Install system dependencies (ffmpeg required for audio processing)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements first for better caching
COPY requirements.txt .

# Install PyTorch CPU version first
RUN pip install --no-cache-dir torch==2.2.2 --index-url https://download.pytorch.org/whl/cpu

# Install other Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Ensure persistent cache directory exists
RUN mkdir -p /data/transcripts_cache && chmod -R 777 /data

# Create clean, writable cache directories
RUN mkdir -p /home/user/.cache/huggingface \
    && chmod -R 777 /home/user/.cache

# No build-time model pre-warming - let faster-whisper download at runtime

# Set environment variables
ENV WHISPER_MODEL=tiny
# Use clean, writable cache directories
ENV HF_HOME=/home/user/.cache/huggingface
ENV XDG_CACHE_HOME=/home/user/.cache
ENV TRANSFORMERS_CACHE=/home/user/.cache/huggingface
ENV HF_HUB_DISABLE_TELEMETRY=1
ENV HF_HUB_ENABLE_HF_TRANSFER=1
ENV HF_HUB_READ_ONLY_TOKEN=
ENV TRANSCRIPT_CACHE_DIR=/data/transcripts_cache
# Fix matplotlib permission issues
ENV MPLCONFIGDIR=/tmp/matplotlib
ENV HOME=/tmp

# Expose port
EXPOSE 7860

# Run the application directly
CMD ["python", "main.py"]
