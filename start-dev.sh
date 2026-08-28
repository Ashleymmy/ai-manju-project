#!/bin/bash

# 启动开发环境脚本
# 同时启动前端 (Vite) 和后端 (Mock API)

echo "🚀 启动 AI 漫剧工作室开发环境..."
echo ""

# 启动 Mock API 后端
echo "📡 启动后端 API 服务器 (端口 3101)..."
cd mock-api && npm start &
BACKEND_PID=$!

# 等待后端启动
sleep 3

# 启动前端
echo "🎨 启动前端开发服务器 (端口 3000)..."
cd .. && pnpm dev &
FRONTEND_PID=$!

echo ""
echo "✅ 开发环境启动成功！"
echo ""
echo "📍 访问地址:"
echo "   前端: http://localhost:3000"
echo "   后端: http://localhost:3101"
echo ""
echo "🔐 默认登录凭证:"
echo "   用户名: admin"
echo "   密码: admin12345"
echo ""
echo "⚠️  按 Ctrl+C 停止所有服务"
echo ""

# 等待任意进程结束
wait $BACKEND_PID $FRONTEND_PID
