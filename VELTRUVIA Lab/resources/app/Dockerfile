# ═══════════════════════════════════════════════════════════════════════
# VELTRUVIA Docker Container
# Multi-stage build for minimal production image
# ═══════════════════════════════════════════════════════════════════════

# Stage 1: Dependencies
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Stage 2: Production
FROM node:24-alpine AS production
LABEL maintainer="VELTRUVIA Medical Systems"
LABEL description="VELTRUVIA Neuro-Oncology EMR"

# Security: run as non-root
RUN addgroup -g 1001 -S veltruvia && \
    adduser -u 1001 -S veltruvia -G veltruvia

WORKDIR /app

# Copy dependencies from stage 1
COPY --from=deps /app/node_modules ./node_modules

# Copy application code
COPY . .

# Create data directories
RUN mkdir -p /app/data /app/data/backups /app/logs && \
    chown -R veltruvia:veltruvia /app

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/app/data/veltruvia.db

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Expose ports
EXPOSE 3000
# MLLP/TCP for lab instruments (optional)
EXPOSE 2575
# WebSocket for telehealth (handled via same port)

# Switch to non-root user
USER veltruvia

# Volumes for persistent data
VOLUME ["/app/data", "/app/logs"]

CMD ["node", "src/server.js"]
