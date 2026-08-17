# Nash 2.0 — Python backend + React frontend
# Multi-stage: build frontend with Node, run with Python/gunicorn

# ── Stage 1: Build React frontend ───────────────────────────────────────
FROM node:20-alpine AS frontend-build

WORKDIR /app


COPY --chown=node:node package.json package-lock.json turbo.json ./
COPY --chown=node:node client/package.json ./client/package.json
COPY --chown=node:node packages/data-provider/package.json ./packages/data-provider/package.json
COPY --chown=node:node packages/data-schemas/package.json ./packages/data-schemas/package.json
COPY --chown=node:node packages/client/package.json ./packages/client/package.json

RUN npm config set fetch-retry-maxtimeout 600000 && \
    npm config set fetch-retries 5 && \
    npm config set fetch-retry-mintimeout 15000 && \
    npm ci --no-audit

COPY packages/ ./packages/
COPY client/ ./client/
COPY librechat.yaml ./

ARG NODE_MAX_OLD_SPACE_SIZE=4096

RUN NODE_OPTIONS="--max-old-space-size=${NODE_MAX_OLD_SPACE_SIZE}" \
    npx turbo run build

# ── Stage 2: Python API + static frontend ───────────────────────────────
FROM python:3.12-slim AS runtime

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.9.5 /uv /uvx /bin/

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY api/ ./api/
COPY librechat.yaml ./


COPY --from=frontend-build /app/client/dist ./client/dist

RUN mkdir -p /app/uploads

EXPOSE 3080

ENV HOST=0.0.0.0
ENV PORT=3080

CMD ["uv", "run", "gunicorn", \
     "--bind", "0.0.0.0:3080", \
     "--timeout", "0", \
     "--workers", "1", \
     "--worker-class", "gevent", \
     "--worker-connections", "100", \
     "--no-control-socket", \
     "api.app:create_app()"]

