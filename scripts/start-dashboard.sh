#!/usr/bin/env bash
# 启动中控 + 面板（后台运行），日志在 /tmp/dspark-server.log
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8890}"

port_busy() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti :"$PORT" >/dev/null 2>&1
  elif command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | grep -q ":$PORT "
  else
    return 1
  fi
}

if port_busy; then
  echo "端口 $PORT 已占用（服务可能已在运行）"
  exit 0
fi
cd "$ROOT"
if [ ! -d "apps/dashboard/dist" ]; then
  pnpm --filter dashboard build >/dev/null 2>&1 || { echo "前端构建失败"; exit 1; }
fi
# 运行器：优先 node（显式加载 .env）；gen8 等只有 bun 的机器回退到 bun（自动加载 .env）
RUNNER=(node --env-file-if-exists=.env)
if ! command -v node >/dev/null 2>&1; then
  BUN_BIN="$(command -v bun || echo "$HOME/.bun/bin/bun")"
  [ -x "$BUN_BIN" ] || { echo "找不到 node 或 bun"; exit 1; }
  RUNNER=("$BUN_BIN")
fi
nohup "${RUNNER[@]}" apps/server/src/index.ts > /tmp/dspark-server.log 2>&1 &
sleep 2
# 绑定失败时上面会立即退出 → 用健康探针确认，而不是盲目报成功
if curl -fsS --max-time 3 "http://127.0.0.1:$PORT/api/nodes" >/dev/null 2>&1; then
  echo "中控已启动: http://127.0.0.1:$PORT"
else
  echo "中控启动失败，日志尾部：" >&2
  tail -5 /tmp/dspark-server.log >&2
  exit 1
fi
