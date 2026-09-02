#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

echo "启动 AI 漫剧工作室开发环境..."
echo "请先通过 docker compose 启动 PostgreSQL、Redis 和 Worker。"

pnpm dev:api &
API_PID=$!
pnpm dev:web &
WEB_PID=$!
pnpm dev:agent &
AGENT_PID=$!

cleanup() {
  kill "$API_PID" "$WEB_PID" "$AGENT_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "前端: http://localhost:3100"
echo "后端: http://localhost:3101"
echo "用户名: admin"
echo "密码: 请查看项目根目录 .env 中的 ADMIN_PASSWORD"
echo "按 Ctrl+C 停止开发进程。"

wait "$API_PID" "$WEB_PID" "$AGENT_PID"
