FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim@sha256:e5b65587bce7de595f299855d7385fe7fca39b8a74baa261ba1b7147afa78e58 AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONPATH=/app/api \
    PATH="/app/.venv/bin:${PATH}"

WORKDIR /app
RUN python -c "import sys; assert sys.version_info[:2] == (3, 12)"

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY api ./api
COPY worker ./worker
COPY migrations ./migrations
COPY scripts ./scripts
COPY README.md ./README.md
RUN uv sync --frozen --no-dev

RUN useradd --create-home --uid 10001 sdvideo \
    && mkdir -p /app/data \
    && chown -R sdvideo:sdvideo /app
USER sdvideo

EXPOSE 8201
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8201"]
