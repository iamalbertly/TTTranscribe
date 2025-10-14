FROM node:18-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    git \
    python3 \
    python3-pip \
    python3-venv \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp for TikTok audio download using virtual environment
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install yt-dlp

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node.js dependencies (including dev dependencies for build)
RUN npm ci

# Copy source code
COPY src/ ./src/
COPY tsconfig.json ./
COPY start.sh ./

# Build TypeScript
RUN npm run build

# Remove dev dependencies to reduce image size
RUN npm prune --production

# Note: Hugging Face Spaces handles temporary file storage automatically
# We'll use /tmp which is typically available and writable

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8788
ENV TMP_DIR=/tmp
ENV KEEP_TEXT_MAX=10000
ENV ASR_PROVIDER=hf

# Expose port
EXPOSE 8788

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  ARG HEALTH_URL
  ENV HEALTH_URL=${HEALTH_URL}
  # Default to container port if HEALTH_URL not provided
  CMD curl -f ${HEALTH_URL:-http://0.0.0.0:8788/health} || exit 1

# Make startup script executable
RUN chmod +x start.sh

# Start the server
CMD ["./start.sh"]