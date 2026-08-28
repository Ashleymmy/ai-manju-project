@echo off
chcp 65001 >nul
echo 🚀 启动 AI 漫剧工作室开发环境...
echo.

echo 📡 启动后端 API 服务器 (端口 3101)...
start "Mock API Server" cmd /k "cd mock-api && npm start"

timeout /t 3 /nobreak >nul

echo 🎨 启动前端开发服务器 (端口 3000)...
start "Frontend Dev Server" cmd /k "pnpm dev"

echo.
echo ✅ 开发环境启动成功！
echo.
echo 📍 访问地址:
echo    前端: http://localhost:3000
echo    后端: http://localhost:3101
echo.
echo 🔐 默认登录凭证:
echo    用户名: admin
echo    密码: admin12345
echo.
echo ⚠️  关闭窗口即可停止服务
echo.
pause
