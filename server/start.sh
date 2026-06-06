#!/bin/bash
# Frameline server — one-click start
cd "$(dirname "$0")"
if [ ! -f .env ]; then
  echo "❌  .env 文件不存在"
  echo "    第一次使用请：cp .env.example .env  然后编辑填入 OpenRouter key"
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "📦  首次启动，安装依赖..."
  npm install
fi
echo ""
echo "🎬  启动 Frameline 服务..."
exec node server.js
