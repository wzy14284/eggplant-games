#!/usr/bin/env bash
# 一键部署：启动游戏服务。
# 用法:
#   ./deploy.sh          启动服务
#   ./deploy.sh stop     停止服务
#   ./deploy.sh status   查看运行状态
#   ./deploy.sh restart  重启
#
# 环境变量（可在 .env 文件中配置）:
#   PORT       端口（默认 23456）
#   HOST       监听地址（HTTP 默认 127.0.0.1，HTTPS 默认 0.0.0.0）
#   TLS_CERT   TLS 证书路径（设置后启用 HTTPS）
#   TLS_KEY    TLS 私钥路径（设置后启用 HTTPS）

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="$ROOT/.run"
mkdir -p "$RUN_DIR"
SERVER_LOG="$RUN_DIR/server.log"

# 加载 .env 文件（如果存在）
if [[ -f "$ROOT/.env" ]]; then
  set -a; source "$ROOT/.env"; set +a
fi

# 颜色
G="\033[32m"; Y="\033[33m"; R="\033[31m"; B="\033[36m"; N="\033[0m"

port_listening() {
  local port="${1:-${PORT:-}}"
  [[ -z "$port" ]] && return 1
  # 优先用 ss，其次 netstat，最后 lsof
  if command -v ss >/dev/null 2>&1; then
    ss -tlnp 2>/dev/null | grep -q ":${port} "
  elif command -v netstat >/dev/null 2>&1; then
    netstat -tlnp 2>/dev/null | grep -q ":${port} "
  else
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
  fi
}
proc_alive() { local pid="$1"; [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; }

start_server() {
  local port="${PORT:-23456}"

  if port_listening "$port"; then
    echo -e "${Y}服务已在运行（端口 $port 占用），跳过启动${N}"
    return
  fi
  echo -e "${B}启动游戏服务...${N}"
  ( cd "$ROOT" && npm start ) >"$SERVER_LOG" 2>&1 &
  echo $! > "$RUN_DIR/server.pid"
  # 等端口起来
  local pid
  pid=$(cat "$RUN_DIR/server.pid" 2>/dev/null || true)
  for _ in $(seq 1 30); do port_listening "$port" && break; sleep 0.2; done
  if port_listening "$port" || proc_alive "$pid"; then
    if [[ -n "${TLS_CERT:-}" && -n "${TLS_KEY:-}" ]]; then
      echo -e "${G}服务已启动: https://localhost:$port${N}"
    else
      echo -e "${G}服务已启动: http://localhost:$port${N}"
    fi
  else
    echo -e "${R}服务启动失败，日志:${N}"; tail -20 "$SERVER_LOG"
    return 1
  fi
}

stop_all() {
  local sp
  sp="$(cat "$RUN_DIR/server.pid" 2>/dev/null || true)"
  proc_alive "$sp" && { kill "$sp"; echo -e "${Y}已停止服务${N}"; }
  # 兜底：按命令名再清一遍
  pkill -f "node server/app.js" 2>/dev/null || true
  rm -f "$RUN_DIR"/*.pid 2>/dev/null || true
}

status_all() {
  echo -e "${B}--- 状态 ---${N}"
  local port="${PORT:-23456}"
  local scheme="http"
  if [[ -n "${TLS_CERT:-}" && -n "${TLS_KEY:-}" ]]; then
    scheme="https"
  fi
  if port_listening "$port"; then
    echo -e "${G}游戏服务: 运行中${N} ($scheme://localhost:$port)"
  else
    echo -e "${R}游戏服务: 未运行${N}"
  fi
}

case "${1:-start}" in
  start)
    command -v node >/dev/null || { echo -e "${R}未安装 node${N}"; exit 1; }
    [[ -d "$ROOT/node_modules" ]] || { echo -e "${B}首次运行，安装依赖...${N}"; ( cd "$ROOT" && npm install ); }
    start_server
    echo
    echo -e "停止: ${B}./deploy.sh stop${N}"
    ;;
  stop) stop_all ;;
  status) status_all ;;
  restart) stop_all; start_server ;;
  *) echo "用法: ./deploy.sh [start|stop|status|restart]"; exit 1 ;;
esac
