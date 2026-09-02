@echo off
chcp 65001 >nul
echo 启动 AI 漫剧工作室开发环境...
echo.

echo 启动真实 Go API (端口 3101)...
start "AI-Manju Go API" cmd /k "cd /d apps\api && go run ./cmd/server"

timeout /t 3 /nobreak >nul

echo 启动 Studio 前端 (端口 3100)...
start "AI-Manju Studio" cmd /k "pnpm --filter ai-manhua-studio dev"

echo 启动 Canvas Agent...
start "AI-Manju Canvas Agent" cmd /k "pnpm --filter @basketikun/canvas-agent dev"

echo.
echo 开发进程已启动。
echo.
echo 访问地址:
echo    前端: http://localhost:3100
echo    后端: http://localhost:3101
echo.
echo 默认开发登录凭证:
echo    用户名: admin
echo    密码: 请查看项目根目录 .env 中的 ADMIN_PASSWORD
echo.
echo PostgreSQL、Redis 和 Worker 请通过 docker compose 启动。
echo.
pause
