# ---- Stage 1: install production npm dependencies ----
FROM node:20-slim AS deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production && npm cache clean --force

# ---- Stage 2: runtime image ----
FROM node:20-slim

# Install Python 3 (for ffsubsync) and curl (for healthcheck)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      python3 \
      python3-pip \
      python3-venv \
      curl && \
    rm -rf /var/lib/apt/lists/*

# Install ffsubsync into a virtualenv (pinned version for reproducibility)
ENV VIRTUAL_ENV=/opt/venv
RUN python3 -m venv "$VIRTUAL_ENV"
ENV PATH="${VIRTUAL_ENV}/bin:${PATH}"
RUN pip install --no-cache-dir ffsubsync==0.5.0

# Copy production node_modules from the deps stage
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY package.json ./
COPY src/ ./src/

# Runtime configuration
ENV NODE_ENV=production \
    PORT=3100 \
    CACHE_DIR=/data/cache \
    PUBLIC_URL=https://subsync.peyloride.com

# Create cache directory and set ownership to the non-root node user
RUN mkdir -p /data/cache && chown -R node:node /data/cache /app

USER node

EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD curl -f http://localhost:${PORT}/health || exit 1

CMD ["node", "src/server.js"]
