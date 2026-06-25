#!/usr/bin/env bash
# 一键部署：启动游戏服务 + Cloudflare 隧道，打印公网地址。
# 用法:
#   ./deploy.sh          启动并打印公网地址
#   ./deploy.sh stop     停止服务与隧道
#   ./deploy.sh status   查看运行状态
#   ./deploy.sh restart  重启

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="$ROOT/.run"
mkdir -p "$RUN_DIR"
SERVER_LOG="$RUN_DIR/server.log"
TUNNEL_LOG="$RUN_DIR/tunnel.log"
PORT="${PORT:-8080}"
HOST_ADDR="127.0.0.1"

# 颜色
G="\033[32m"; Y="\033[33m"; R="\033[31m"; B="\033[36m"; N="\033[0m"

port_listening() { lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; }
proc_alive() { local pid="$1"; [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; }

start_server() {
  if port_listening; then
    echo -e "${Y}服务已在运行（端口 $PORT 占用），跳过启动${N}"
    return
  fi
  echo -e "${B}启动游戏服务...${N}"
  ( cd "$ROOT" && PORT="$PORT" HOST="$HOST_ADDR" npm start ) >"$SERVER_LOG" 2>&1 &
  echo $! > "$RUN_DIR/server.pid"
  # 等端口起来
  for _ in $(seq 1 30); do port_listening && break; sleep 0.2; done
  if port_listening; then
    echo -e "${G}服务已启动: http://localhost:$PORT${N}"
  else
    echo -e "${R}服务启动失败，日志:${N}"; tail -20 "$SERVER_LOG"
    return 1
  fi
}

start_tunnel() {
  if proc_alive "$(cat "$RUN_DIR/tunnel.pid" 2>/dev/null || true)"; then
    echo -e "${Y}隧道已在运行，跳过启动${N}"
  else
    echo -e "${B}启动 Cloudflare 隧道...${N}"
    : > "$TUNNEL_LOG"
    cloudflared tunnel --url "http://localhost:$PORT" >"$TUNNEL_LOG" 2>&1 &
    echo $! > "$RUN_DIR/tunnel.pid"
  fi
  # 等公网地址出现
  local url=""
  echo -ne "${B}等待公网地址${N}"
  for _ in $(seq 1 40); do
    url="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -1 || true)"
    [[ -n "$url" ]] && break
    echo -n "."; sleep 0.5
  done
  echo
  if [[ -z "$url" ]]; then
    echo -e "${R}未拿到公网地址，隧道日志:${N}"; tail -20 "$TUNNEL_LOG"
    return 1
  fi
  echo "$url" > "$RUN_DIR/url.txt"
  echo
  echo -e "${G}========================================================${N}"
  echo -e "${G}  把这个地址发给朋友:${N}"
  echo -e "${G}  $url${N}"
  echo -e "${G}========================================================${N}"
  echo -e "本地: http://localhost:$PORT   日志: $RUN_DIR/"
  echo -e "停止: ./deploy.sh stop"
}

stop_all() {
  local tp sp
  tp="$(cat "$RUN_DIR/tunnel.pid" 2>/dev/null || true)"
  sp="$(cat "$RUN_DIR/server.pid" 2>/dev/null || true)"
  proc_alive "$tp" && { kill "$tp"; echo -e "${Y}已停止隧道${N}"; }
  proc_alive "$sp" && { kill "$sp"; echo -e "${Y}已停止服务${N}"; }
  # 兜底：按命令名再清一遍
  pkill -f "cloudflared tunnel --url http://localhost:$PORT" 2>/dev/null || true
  pkill -f "node server/app.js" 2>/dev/null || true
  rm -f "$RUN_DIR"/*.pid "$RUN_DIR/url.txt" 2>/dev/null || true
}

status_all() {
  echo -e "${B}--- 状态 ---${N}"
  if port_listening; then echo -e "${G}游戏服务: 运行中${N} (http://localhost:$PORT)"; else echo -e "${R}游戏服务: 未运行${N}"; fi
  if proc_alive "$(cat "$RUN_DIR/tunnel.pid" 2>/dev/null || true)"; then
    echo -e "${G}隧道: 运行中${N}"
    [[ -f "$RUN_DIR/url.txt" ]] && echo -e "公网地址: $(cat "$RUN_DIR/url.txt")"
  else echo -e "${R}隧道: 未运行${N}"; fi
}

case "${1:-start}" in
  start)
    command -v cloudflared >/dev/null || { echo -e "${R}未安装 cloudflared，请先 brew install cloudflared${N}"; exit 1; }
    command -v node >/dev/null || { echo -e "${R}未安装 node${N}"; exit 1; }
    [[ -d "$ROOT/node_modules" ]] || { echo -e "${B}首次运行，安装依赖...${N}"; ( cd "$ROOT" && npm install ); }
    start_server
    start_tunnel
    ;;
  stop) stop_all ;;
  status) status_all ;;
  restart) stop_all; start_server; start_tunnel ;;
  *) echo "用法: ./deploy.sh [start|stop|status|restart]"; exit 1 ;;
esac
