FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app/apps/worker

RUN sed -i 's|http://deb.debian.org|http://mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends curl ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY apps/worker/requirements.txt /app/apps/worker/requirements.txt
RUN pip install --no-cache-dir --index-url https://mirrors.aliyun.com/pypi/simple/ -r /app/apps/worker/requirements.txt

COPY apps/worker /app/apps/worker
RUN groupadd --system aiworker \
    && useradd --system --gid aiworker --home-dir /app --shell /usr/sbin/nologin aiworker \
    && mkdir -p /app/data/assets/jobs \
    && chmod 1777 /app/data/assets /app/data/assets/jobs \
    && chown -R aiworker:aiworker /app
WORKDIR /app/apps/worker

EXPOSE 8101
USER aiworker
CMD ["celery", "-A", "worker.tasks", "worker", "--loglevel=info"]
