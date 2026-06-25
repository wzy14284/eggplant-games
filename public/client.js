// 通用 WebSocket 客户端 —— 所有游戏页复用。
// 职责：连接、自动重连、JSON 收发、把 S2C 消息分发到 onXxx 回调。
// 用法：
//   const client = new GameClient();
//   client.onCreate = (payload) => {...};
//   client.connect();
//   client.send('action', { action: {row, col} });

// 消息类型（与服务端 server/protocol.js 保持一致，浏览器无法直接 import 后端目录）
const C2S = {
  CREATE: 'create', JOIN: 'join', START: 'start', REMATCH: 'rematch',
  ACTION: 'action', RESIGN: 'resign', REQ_UNDO: 'req_undo', REQ_DRAW: 'req_draw',
  RESPOND: 'respond', RESUME: 'resume', LEAVE: 'leave',
};
const S2C = {
  GAMES: 'games', CREATED: 'created', JOINED: 'joined', READY: 'ready',
  STARTED: 'started', STATE: 'state', OVER: 'over',
  REQ: 'req', REQ_SENT: 'req_sent', REQ_RESOLVED: 'req_resolved',
  PLAYER_DC: 'player_dc', PLAYER_RC: 'player_rc',
  LEFT: 'left', ERROR: 'error',
};

export class GameClient {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.onOpen = null;
    this.onClose = null;
    // 回调钩子（按需在页面里赋值）
    this.onGames = null;
    this.onCreated = null;
    this.onJoined = null;
    this.onReady = null;
    this.onStarted = null;
    this.onState = null;
    this.onOver = null;
    this.onReq = null;       // 对方发起请求（悔棋/和棋），需我方决策
    this.onReqSent = null;   // 我的请求已发出，等待对方应答
    this.onReqResolved = null; // 请求了结
    this.onPlayerDc = null;    // 对手掉线（宽限期）
    this.onPlayerRc = null;    // 对手重连
    this.onLeft = null;
    this.onError = null;
    this.resumeFn = null;      // 重连时调用，返回 {playerId, roomCode} 或 null
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/ws`;
    this.ws = new WebSocket(url);
    this.ws.onopen = () => {
      this.connected = true;
      // 断线重连：若上层提供 resume 信息，立即认领旧座位
      if (this.resumeFn) {
        const r = this.resumeFn();
        if (r && r.playerId && r.roomCode) this.resume(r.playerId, r.roomCode);
      }
      this.onOpen && this.onOpen();
    };
    this.ws.onclose = () => {
      this.connected = false;
      this.onClose && this.onClose();
      // 简单断线重连
      setTimeout(() => this.connect(), 1500);
    };
    this.ws.onerror = () => { /* 留给 onclose 处理重连 */ };
    this.ws.onmessage = (ev) => {
      let data;
      try { data = JSON.parse(ev.data); } catch { return; }
      switch (data.type) {
        case S2C.GAMES: this.onGames && this.onGames(data.games); break;
        case S2C.CREATED: this.onCreated && this.onCreated(data); break;
        case S2C.JOINED: this.onJoined && this.onJoined(data); break;
        case S2C.READY: this.onReady && this.onReady(data); break;
        case S2C.STARTED: this.onStarted && this.onStarted(data); break;
        case S2C.STATE: this.onState && this.onState(data); break;
        case S2C.OVER: this.onOver && this.onOver(data); break;
        case S2C.REQ: this.onReq && this.onReq(data); break;
        case S2C.REQ_SENT: this.onReqSent && this.onReqSent(data); break;
        case S2C.REQ_RESOLVED: this.onReqResolved && this.onReqResolved(data); break;
        case S2C.PLAYER_DC: this.onPlayerDc && this.onPlayerDc(data); break;
        case S2C.PLAYER_RC: this.onPlayerRc && this.onPlayerRc(data); break;
        case S2C.LEFT: this.onLeft && this.onLeft(data); break;
        case S2C.ERROR: this.onError && this.onError(data.message); break;
      }
    };
  }

  send(type, payload = {}) {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify({ type, ...payload }));
    }
  }

  create(gameType, playerName, password) { this.send(C2S.CREATE, { gameType, playerName, password }); }
  join(roomCode, playerName, password) { this.send(C2S.JOIN, { roomCode, playerName, password }); }
  start() { this.send(C2S.START); }
  rematch() { this.send(C2S.REMATCH); }
  resign() { this.send(C2S.RESIGN); }
  reqUndo() { this.send(C2S.REQ_UNDO); }
  reqDraw() { this.send(C2S.REQ_DRAW); }
  respond(accept) { this.send(C2S.RESPOND, { accept }); }
  resume(playerId, roomCode) { this.send(C2S.RESUME, { playerId, roomCode }); }
  action(action) { this.send(C2S.ACTION, { action }); }
  leave() { this.send(C2S.LEAVE); }
}
