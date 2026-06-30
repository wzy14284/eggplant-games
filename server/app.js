// 服务入口：HTTP/HTTPS 托管静态前端 + WebSocket 游戏服务。
// 安全默认：仅监听 127.0.0.1，不直接暴露到公网（用 Cloudflare Tunnel 时也只让本地可达）。
// 设置 TLS_CERT / TLS_KEY 环境变量后自动切换 HTTPS，HOST 默认改为 0.0.0.0，PORT 默认 443。

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Lobby } from './lobby.js';
import { registerBuiltins, listGames } from './gameRegistry.js';
import { S2C } from './protocol.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// TLS 配置：设置了证书环境变量即启用 HTTPS
const TLS_CERT = process.env.TLS_CERT || '';
const TLS_KEY = process.env.TLS_KEY || '';
const useTLS = TLS_CERT && TLS_KEY;

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT) || 23456;

registerBuiltins();

// --- HTTP：静态文件托管（前端页面） ---
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  // 防目录穿越
  const filePath = path.join(PUBLIC_DIR, urlPath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(buf);
  });
}

let server;
if (useTLS) {
  const tlsOptions = {
    cert: fs.readFileSync(TLS_CERT),
    key: fs.readFileSync(TLS_KEY),
  };
  server = https.createServer(tlsOptions, serveStatic);
} else {
  server = http.createServer(serveStatic);
}

// --- WebSocket ---
const wss = new WebSocketServer({ server, path: '/ws' });
const lobby = new Lobby();

wss.on('connection', (ws, req) => {
  lobby.handleConnection(ws);
  // 进入后把可用游戏列表推一份，便于大厅页渲染
  ws.send(JSON.stringify({ type: S2C.GAMES, games: listGames() }));
  ws.on('message', (m) => lobby.handleMessage(ws, m.toString()));
  ws.on('close', () => lobby.handleDisconnect(ws));
});

const scheme = useTLS ? 'https' : 'http';
server.listen(PORT, HOST, () => {
  console.log(`游戏服务已启动:`);
  console.log(`  地址:   ${scheme}://localhost:${PORT}`);
  console.log(`  监听:   ${HOST}:${PORT}（${useTLS ? 'HTTPS 模式，已暴露到公网' : '仅本机，未暴露公网'}）`);
  console.log(`  可用游戏: ${listGames().map((g) => g.name).join(', ')}`);
  if (!useTLS) {
    console.log(`提示: 设置 TLS_CERT / TLS_KEY 环境变量可启用 HTTPS 直接部署`);
    console.log(`      或用 Cloudflare Tunnel 转发 http://localhost:${PORT}（见 README）`);
  }
});
