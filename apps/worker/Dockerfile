FROM python:3.12-slim@sha256:78387bc3881b8273120a12ebe6c1ab22b018ccc2c9adf565ae1ac9b536e184ea

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app/apps/worker

RUN sed -i 's|http://deb.debian.org|http://mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends curl ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN python -c "import sys; assert sys.version_info[:2] == (3, 12)"
COPY apps/worker/requirements.lock /app/apps/worker/requirements.lock
RUN pip install --no-cache-dir --require-hashes -r /app/apps/worker/requirements.lock

COPY apps/worker /app/apps/worker
RUN groupadd --system aiworker \
    && useradd --system --gid aiworker --home-dir /app --shell /usr/sbin/nologin aiworker \
    && mkdir -p /app/data/assets/jobs \
    && chmod 1777 /app/data/assets /app/data/assets/jobs \
    && chown -R aiworker:aiworker /app
WORKDIR /app/apps/worker

EXPOSE 8101
USER aiworker
CMD ["python", "-m", "worker.runtime"]
