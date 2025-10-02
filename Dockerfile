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

# Create persistent cache directories
RUN mkdir -p /root/.cache/huggingface

# No build-time model pre-warming - let faster-whisper download at runtime

# Set environment variables
ENV WHISPER_MODEL=tiny
# Use persistent cache directories
ENV HF_HOME=/root/.cache/huggingface
ENV XDG_CACHE_HOME=/root/.cache
ENV HF_HUB_ENABLE_HF_TRANSFER=1
# Fix matplotlib permission issues
ENV MPLCONFIGDIR=/tmp/matplotlib
ENV HOME=/tmp

# Expose port
EXPOSE 7860

# Run the application directly
CMD ["python", "main.py"]