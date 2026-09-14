FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim@sha256:e5b65587bce7de595f299855d7385fe7fca39b8a74baa261ba1b7147afa78e58 AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONPATH=/app/api \
    PATH="/app/.venv/bin:${PATH}"

WORKDIR /app
RUN python -c "import sys; assert sys.version_info[:2] == (3, 12)"

# 仅替换下载源，保留 Debian 发行版、仓库签名校验和基础镜像锁定。
RUN sed -i 's|http://deb.debian.org|https://mirrors.aliyun.com|g; s|https://deb.debian.org|https://mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml uv.lock ./
# frozen 使用锁定的文件 URL；只在镜像内替换源地址，不改变版本和校验值。
RUN sed -i 's|https://pypi.org/simple|https://mirrors.aliyun.com/pypi/simple|g; s|https://files.pythonhosted.org/packages/|https://mirrors.aliyun.com/pypi/packages/|g' uv.lock
RUN uv sync --frozen --default-index https://mirrors.aliyun.com/pypi/simple --no-dev --no-install-project

COPY api ./api
COPY worker ./worker
COPY migrations ./migrations
COPY scripts ./scripts
COPY README.md ./README.md
RUN uv sync --frozen --default-index https://mirrors.aliyun.com/pypi/simple --no-dev

RUN useradd --create-home --uid 10001 sdvideo \
    && mkdir -p /app/data \
    && chown -R sdvideo:sdvideo /app
USER sdvideo

EXPOSE 8201
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8201"]
