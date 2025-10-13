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

# Install Node.js dependencies
RUN npm ci --only=production

# Copy source code
COPY src/ ./src/
COPY tsconfig.json ./

# Build TypeScript
RUN npm run build

# Create directories for temporary files
RUN mkdir -p /tmp/ttt && chmod 777 /tmp/ttt

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8788
ENV TMP_DIR=/tmp/ttt
ENV KEEP_TEXT_MAX=10000
ENV ASR_PROVIDER=hf

# Expose port
EXPOSE 8788

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8788/health || exit 1

# Start the server
CMD ["node", "dist/index.js"]