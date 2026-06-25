// 房间 / 大厅管理。
// 职责：玩家会话、房间创建与加入、动作路由、按玩家视角广播状态。
// 设计上不耦合具体游戏 —— 通过 gameRegistry 拿到 GameClass 实例化。

import { C2S, S2C } from './protocol.js';
import { getGame } from './gameRegistry.js';

// 生成 6 位房间码（大写字母+数字，去除易混字符）
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
// 掉线宽限期（默认 30s；可用 GRACE_MS 环境变量覆盖以便测试）
const GRACE_MS = Number(process.env.GRACE_MS) || 30000;
export function genRoomCode(len = 6) {
  let s = '';
  for (let i = 0; i < len; i++) {
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return s;
}

let pidSeq = 0;
function newPlayerId() {
  pidSeq += 1;
  return `p${pidSeq}`;
}

// roomId -> Room
const rooms = new Map();

class Room {
  constructor({ gameType, hostId, password }) {
    this.id = genRoomCode();
    this.gameType = gameType;
    this.hostId = hostId;
    this.password = password || null;
    this.players = []; // { id, name, ws, index, connected }
    this.game = null; // BaseGame 实例，开始后才有
    this.started = false;
    this.closed = false;
    this.pendingReq = null; // { reqType, fromId, timer } 待处理请求（悔棋/和棋）
    this.grace = null;     // { playerId, timer } 掉线宽限期
  }

  gameActive() {
    return this.started && this.game && !this.game.isOver();
  }

  /** 清除待处理请求及其倒计时 */
  clearPendingReq() {
    if (this.pendingReq) {
      clearTimeout(this.pendingReq.timer);
      this.pendingReq = null;
    }
  }

  /** 清除掉线宽限期计时器 */
  clearGrace() {
    if (this.grace) {
      clearTimeout(this.grace.timer);
      this.grace = null;
    }
  }

  /** 清理所有临时计时器（终局/重开/离开时调用） */
  clearTransient() {
    this.clearPendingReq();
    this.clearGrace();
  }

  /** READY 消息载荷 */
  readyPayload() {
    const m = this.meta();
    return {
      type: S2C.READY,
      playerCount: this.players.length,
      minPlayers: m.minPlayers,
      maxPlayers: m.maxPlayers,
      canStart: this.players.length >= m.minPlayers && !this.started,
      hostId: this.hostId,
      started: this.started,
      players: this.players.map((p) => ({ name: p.name, index: p.index, id: p.id })),
      gameType: this.gameType,
    };
  }

  /** 给单个玩家补发当前视图（重连后） */
  sendFullState(player) {
    if (!player || !player.ws || player.ws.readyState !== 1) return;
    if (this.started && this.game) {
      const over = this.game.isOver();
      this.send(player, {
        type: over ? S2C.OVER : S2C.STATE,
        publicState: this.game.getPublicState(),
        privateState: this.game.getPrivateState(player.id),
        turnIndex: this.game.getPublicState().turnIndex ?? -1,
        ...(over ? { result: this.game.getResult() } : {}),
      });
    } else {
      this.send(player, this.readyPayload());
    }
  }

  /** 是否有待处理请求或掉线宽限 */
  hasTransient() {
    return !!this.pendingReq || !!this.grace;
  }

  /** 当前对手（相对 fromId） */
  opponentOf(playerId) {
    return this.players.find((p) => p.id !== playerId);
  }

  /** 发起悔棋/和棋请求 */
  request(playerId, reqType) {
    if (!this.gameActive()) return { ok: false, error: '当前无法申请' };
    if (this.pendingReq) return { ok: false, error: '已有待处理请求' };
    const opp = this.opponentOf(playerId);
    if (!opp) return { ok: false, error: '找不到对手' };
    if (!opp.connected) return { ok: false, error: '对方掉线中，暂不能申请' };
    this.pendingReq = { reqType, fromId: playerId };
    // 给申请方确认
    this.send(this.playerById(playerId), { type: S2C.REQ_SENT, reqType });
    // 给决策方（对手）
    this.send(opp, { type: S2C.REQ, reqType, fromId: playerId, fromName: this.playerById(playerId).name });
    // 10s 超时自动拒绝
    this.pendingReq.timer = setTimeout(() => {
      if (this.pendingReq && this.pendingReq.fromId === playerId) {
        this.resolveReq(false, 'timeout');
      }
    }, 10000);
    return { ok: true };
  }

  /** 决策方应答 */
  respond(playerId, accept) {
    if (!this.pendingReq) return { ok: false, error: '没有待处理请求' };
    if (this.pendingReq.fromId === playerId) return { ok: false, error: '不能应答自己的请求' };
    const opp = this.opponentOf(this.pendingReq.fromId);
    if (playerId !== (opp && opp.id)) return { ok: false, error: '只有对手可以应答' };
    this.resolveReq(accept, accept ? 'accepted' : 'rejected');
    return { ok: true };
  }

  /** 了结待处理请求：发 REQ_RESOLVED，accept 时执行 undo/draw */
  resolveReq(accepted, reason) {
    if (!this.pendingReq) return;
    const { reqType, fromId, timer } = this.pendingReq;
    clearTimeout(timer);
    this.pendingReq = null;
    this.broadcast({
      type: S2C.REQ_RESOLVED, reqType, accepted, reason,
    });
    if (accepted) {
      if (reqType === 'undo') {
        const r = this.game.undo();
        if (r.ok) this.broadcastState();
      } else if (reqType === 'draw') {
        this.clearTransient();
        this.game.draw();
        this.broadcastState();
      }
    }
  }

  /** 认输：立即判负 */
  resign(playerId) {
    if (!this.gameActive()) return { ok: false, error: '当前无法认输' };
    this.clearTransient();
    this.game.forfeit(playerId);
    this.broadcastState();
    return { ok: true };
  }

  /** 离场即弃权：若游戏进行中，判离场者负并通知剩余玩家；返回是否触发了弃权 */
  forfeitIfActive(playerId) {
    if (!this.gameActive()) return false;
    this.clearTransient();
    this.game.forfeit(playerId);
    this.broadcastState(); // 给剩余玩家发 OVER（离场者 ws 已关/将离，send 自然 no-op）
    return true;
  }

  size() {
    return this.players.length;
  }

  meta() {
    const GameClass = getGame(this.gameType);
    return GameClass ? GameClass.metadata : null;
  }

  addPlayer({ id, name, ws }) {
    const m = this.meta();
    if (!m) throw new Error('游戏不存在');
    if (this.players.length >= m.maxPlayers) throw new Error('房间已满');
    if (this.started) throw new Error('游戏已开始，无法加入');
    const index = this.players.length;
    const player = { id, name, ws, index, connected: true };
    this.players.push(player);
    return player;
  }

  removePlayer(playerId) {
    const i = this.players.findIndex((p) => p.id === playerId);
    if (i < 0) return null;
    const [removed] = this.players.splice(i, 1);
    // 重排座位号 index
    this.players.forEach((p, idx) => (p.index = idx));
    // 房主转移
    if (this.hostId === playerId && this.players.length > 0) {
      this.hostId = this.players[0].id;
    }
    return removed;
  }

  playerByWs(ws) {
    return this.players.find((p) => p.ws === ws);
  }

  playerById(id) {
    return this.players.find((p) => p.id === id);
  }

  send(player, msg) {
    if (player && player.ws && player.ws.readyState === 1 /* OPEN */) {
      player.ws.send(JSON.stringify(msg));
    }
  }

  broadcast(msg) {
    for (const p of this.players) this.send(p, msg);
  }

  // 广播当前游戏状态（每人各自私有视角）
  broadcastState() {
    if (!this.game) return;
    const over = this.game.isOver();
    const baseMsg = { type: over ? S2C.OVER : S2C.STATE };
    for (const p of this.players) {
      const msg = {
        ...baseMsg,
        publicState: this.game.getPublicState(),
        privateState: this.game.getPrivateState(p.id),
        turnIndex: this.game.getPublicState().turnIndex ?? -1,
      };
      if (over) msg.result = this.game.getResult();
      this.send(p, msg);
    }
  }

  start(hostId) {
    if (this.hostId !== hostId) throw new Error('只有房主可以开始');
    const m = this.meta();
    if (this.players.length < m.minPlayers) throw new Error(`至少需要 ${m.minPlayers} 人`);
    if (this.started) throw new Error('已开始');
    this.started = true;
    this.clearTransient();
    const GameClass = getGame(this.gameType);
    const players = this.players.map((p) => ({ id: p.id, name: p.name, index: p.index }));
    this.game = new GameClass(players, {});
    // 先发 STARTED（每人各自私有视角），再发首帧状态
    for (const p of this.players) {
      this.send(p, {
        type: S2C.STARTED,
        yourIndex: p.index,
        publicState: this.game.getPublicState(),
        privateState: this.game.getPrivateState(p.id),
      });
    }
    this.broadcastState();
  }
}

export class Lobby {
  constructor() {
    this.sessions = new Map(); // ws -> { playerId, name, roomId }
  }

  handleConnection(ws) {
    this.sessions.set(ws, { playerId: newPlayerId(), roomId: null });
    // 等待客户端的 create/join
  }

  handleDisconnect(ws) {
    const sess = this.sessions.get(ws);
    if (!sess) return;
    if (sess.roomId) {
      const room = rooms.get(sess.roomId);
      if (room) {
        if (room.gameActive()) {
          // 游戏中掉线：保留座位，进入 30s 宽限期，不立即弃权
          const p = room.playerById(sess.playerId);
          if (p) {
            p.connected = false;
            p.ws = null;
            room.clearTransient();
            const pid = sess.playerId;
            room.grace = {
              playerId: pid,
              timer: setTimeout(() => {
                if (room.grace && room.grace.playerId === pid) {
                  room.grace = null;
                  room.forfeitIfActive(pid); // 宽限期满判负
                }
              }, GRACE_MS),
            };
            room.broadcast({ type: S2C.PLAYER_DC, playerName: p.name, grace: Math.round(GRACE_MS / 1000) });
          }
        } else {
          // 非游戏中：直接移除
          const removed = room.removePlayer(sess.playerId);
          if (removed) {
            room.broadcast({ type: S2C.LEFT, playerName: removed.name });
            if (room.players.length > 0) {
              this.broadcastReady(room);
            } else {
              rooms.delete(room.id);
            }
          }
        }
      }
    }
    this.sessions.delete(ws);
  }

  broadcastReady(room) {
    room.broadcast(room.readyPayload());
  }

  async handleMessage(ws, msg) {
    const sess = this.sessions.get(ws);
    if (!sess) return;
    let data;
    try { data = JSON.parse(msg); } catch {
      return ws.send(JSON.stringify({ type: S2C.ERROR, message: '非法 JSON' }));
    }

    switch (data.type) {
      case C2S.CREATE: {
        try {
          const room = new Room({
            gameType: data.gameType,
            hostId: sess.playerId,
            password: data.password,
          });
          const m = room.meta();
          if (!m) return this.err(ws, '游戏类型不存在');
          const player = room.addPlayer({ id: sess.playerId, name: data.playerName || '玩家', ws });
          sess.roomId = room.id;
          rooms.set(room.id, room);
          this.send(ws, {
            type: S2C.CREATED,
            roomCode: room.id,
            playerId: sess.playerId,
            yourIndex: player.index,
          });
          this.broadcastReady(room);
        } catch (e) { this.err(ws, e.message); }
        return;
      }
      case C2S.JOIN: {
        try {
          const room = rooms.get((data.roomCode || '').toUpperCase());
          if (!room) return this.err(ws, '房间不存在');
          if (room.password && room.password !== data.password) {
            return this.err(ws, '房间密码错误');
          }
          const player = room.addPlayer({ id: sess.playerId, name: data.playerName || '玩家', ws });
          sess.roomId = room.id;
          this.send(ws, {
            type: S2C.JOINED,
            playerId: sess.playerId,
            yourIndex: player.index,
            roomCode: room.id,
          });
          this.broadcastReady(room);
        } catch (e) { this.err(ws, e.message); }
        return;
      }
      case C2S.START: {
        const room = rooms.get(sess.roomId);
        if (!room) return this.err(ws, '不在房间中');
        try {
          room.start(sess.playerId);
        } catch (e) { this.err(ws, e.message); }
        return;
      }
      case C2S.REMATCH: {
        const room = rooms.get(sess.roomId);
        if (!room) return this.err(ws, '不在房间中');
        if (room.hostId !== sess.playerId) return this.err(ws, '只有房主可以重开');
        if (!room.started) return this.err(ws, '当前未在游戏中');
        room.clearTransient();
        room.started = false;
        room.game = null;
        this.broadcastReady(room);
        return;
      }
      case C2S.ACTION: {
        const room = rooms.get(sess.roomId);
        if (!room || !room.game) return this.err(ws, '游戏未开始');
        if (room.pendingReq) return this.err(ws, '有待处理请求，暂不能操作');
        const res = room.game.applyAction(sess.playerId, data.action || {});
        if (!res.ok) { this.err(ws, res.error); return; }
        room.broadcastState();
        // 游戏结束后保留房间以便查看终局；不自动删除。
        return;
      }
      case C2S.RESIGN: {
        const room = rooms.get(sess.roomId);
        if (!room) return this.err(ws, '不在房间中');
        const res = room.resign(sess.playerId);
        if (!res.ok) this.err(ws, res.error);
        return;
      }
      case C2S.REQ_UNDO:
      case C2S.REQ_DRAW: {
        const room = rooms.get(sess.roomId);
        if (!room) return this.err(ws, '不在房间中');
        const reqType = data.type === C2S.REQ_UNDO ? 'undo' : 'draw';
        const res = room.request(sess.playerId, reqType);
        if (!res.ok) this.err(ws, res.error);
        return;
      }
      case C2S.RESPOND: {
        const room = rooms.get(sess.roomId);
        if (!room) return this.err(ws, '不在房间中');
        const res = room.respond(sess.playerId, !!data.accept);
        if (!res.ok) this.err(ws, res.error);
        return;
      }
      case C2S.RESUME: {
        // 断线重连：按旧 playerId+roomCode 认领宽限期内的座位
        const room = rooms.get((data.roomCode || '').toUpperCase());
        if (!room) return this.err(ws, '会话已失效');
        const slot = room.players.find((p) => p.id === data.playerId);
        if (!slot) return this.err(ws, '会话已失效');
        slot.ws = ws;
        slot.connected = true;
        sess.playerId = slot.id;
        sess.roomId = room.id;
        room.clearGrace();
        const opp = room.opponentOf(slot.id);
        if (opp) room.send(opp, { type: S2C.PLAYER_RC, playerName: slot.name });
        room.sendFullState(slot);
        return;
      }
      case C2S.LEAVE: {
        const room = rooms.get(sess.roomId);
        if (room) {
          room.forfeitIfActive(sess.playerId); // 游戏中离开 = 弃权
          room.removePlayer(sess.playerId);
          sess.roomId = null;
          const anyConnected = room.players.some((p) => p.connected);
          if (room.players.length > 0 && anyConnected) this.broadcastReady(room);
          else rooms.delete(room.id);
          this.err(ws, '已离开房间');
        }
        return;
      }
      default:
        this.err(ws, '未知消息类型: ' + data.type);
    }
  }

  send(ws, msg) { ws.send(JSON.stringify(msg)); }
  err(ws, message) { ws.send(JSON.stringify({ type: S2C.ERROR, message })); }
}
