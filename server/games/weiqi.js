// 围棋 —— BaseGame 契约实现。
// 规则要点：
//   - 19x19（可用 options.size 改 9/13/19），黑1先手白2
//   - 提子：无气棋群被提
//   - 禁着：自杀(落子后己方无气且未提子)非法；超级劫(禁止重现任何历史盘面)非法
//   - 终局：连续两次停手(pass)进入「死子标记」阶段；双方确认后按中国规则数目
//   - 数目：area scoring = 棋子数 + 纯属该方围住的空点；白方加贴目 komi(默认 6.5)
//
// 阶段：'play' -> 'scoring'(死子标记) -> 'over'
// action 形态：
//   play:    {row,col} 落子 | {pass:true} 停手
//   scoring: {toggle:{row,col}} 切换死子 | {confirm:true} 确认 | {resume:true} 继续对局

import { BaseGame } from './baseGame.js';

const EMPTY = 0, BLACK = 1, WHITE = 2;

export default class Weiqi extends BaseGame {
  static metadata = {
    id: 'weiqi',
    name: '围棋',
    minPlayers: 2,
    maxPlayers: 2,
  };

  constructor(players, options = {}) {
    super(players, options);
    this.size = options.size || 19;
    this.board = Array.from({ length: this.size }, () => Array(this.size).fill(EMPTY));
    this.colorByIndex = { 0: BLACK, 1: WHITE };
    this.indexByColor = { [BLACK]: 0, [WHITE]: 1 };
    this.currentColor = BLACK;
    this.lastMove = null;          // {row,col} | {pass:true}
    this.lastMoverColor = null;
    this.consecutivePasses = 0;
    this.captured = { [BLACK]: 0, [WHITE]: 0 }; // captured[c] = c 提走的对方子数
    this.phase = 'play';
    this.deadStones = new Set();   // 'r,c'
    this.confirmed = {};           // playerId -> bool
    this.history = new Set([this.hashBoard(this.board)]); // 超级劫
    this.undoStack = []; // play 阶段每手前的快照，供悔棋
    this.komi = options.komi ?? 6.5;
    this.over = false;
    this.result = null;
  }

  // ---- 工具 ----
  inBounds(r, c) { return r >= 0 && r < this.size && c >= 0 && c < this.size; }
  neighbors(r, c) {
    const out = [];
    if (r > 0) out.push([r - 1, c]);
    if (r < this.size - 1) out.push([r + 1, c]);
    if (c > 0) out.push([r, c - 1]);
    if (c < this.size - 1) out.push([r, c + 1]);
    return out;
  }
  hashBoard(board) { return board.map((row) => row.join('')).join('|'); }

  /** 从 (r,c) 洪泛得到同色棋群及其气数 */
  groupAt(board, r, c) {
    const color = board[r][c];
    if (color === EMPTY) return null;
    const members = [];
    const libs = new Set();
    const seen = new Set([`${r},${c}`]);
    const stack = [[r, c]];
    while (stack.length) {
      const [cr, cc] = stack.pop();
      members.push([cr, cc]);
      for (const [nr, nc] of this.neighbors(cr, cc)) {
        const k = `${nr},${nc}`;
        if (board[nr][nc] === EMPTY) libs.add(k);
        else if (board[nr][nc] === color && !seen.has(k)) { seen.add(k); stack.push([nr, nc]); }
      }
    }
    return { members, liberties: libs.size };
  }

  cloneBoard(board) { return board.map((row) => row.slice()); }

  /** 记录 play 阶段每手前的状态快照，供悔棋 */
  _pushSnapshot() {
    this.undoStack.push({
      board: this.cloneBoard(this.board),
      currentColor: this.currentColor,
      lastMove: this.lastMove ? { ...this.lastMove } : null,
      lastMoverColor: this.lastMoverColor,
      consecutivePasses: this.consecutivePasses,
      captured: { ...this.captured },
      history: new Set(this.history),
    });
  }

  undo() {
    if (this.phase !== 'play') return { ok: false, error: '当前不可悔棋' };
    if (this.undoStack.length === 0) return { ok: false, error: '没有可悔的棋' };
    const s = this.undoStack.pop();
    this.board = s.board;
    this.currentColor = s.currentColor;
    this.lastMove = s.lastMove;
    this.lastMoverColor = s.lastMoverColor;
    this.consecutivePasses = s.consecutivePasses;
    this.captured = s.captured;
    this.history = s.history; // 恢复超级劫历史
    return { ok: true };
  }

  // ---- 状态查询 ----
  currentPlayerId() {
    if (this.over || this.phase !== 'play') return null;
    const idx = this.indexByColor[this.currentColor];
    return this.players.find((p) => p.index === idx)?.id ?? null;
  }
  getCurrentPlayerId() { return this.currentPlayerId(); }
  isOver() { return this.over; }
  getResult() { return this.result || {}; }

  getPublicState() {
    return {
      size: this.size,
      board: this.board,
      currentColor: this.currentColor,
      turnIndex: this.phase === 'play' && !this.over ? this.indexByColor[this.currentColor] : -1,
      lastMove: this.lastMove,
      prisoners: { black: this.captured[BLACK], white: this.captured[WHITE] },
      phase: this.phase,
      consecutivePasses: this.consecutivePasses,
      deadStones: [...this.deadStones],
      confirmed: { ...this.confirmed },
      komi: this.komi,
    };
  }
  getPrivateState() { return this.getPublicState(); }

  // ---- 动作 ----
  applyAction(playerId, action) {
    action = action || {};
    const myColor = this.colorByIndex[this.players.find((p) => p.id === playerId)?.index];
    if (myColor === undefined) return { ok: false, error: '非本局玩家' };

    if (this.phase === 'play') return this._playAction(playerId, myColor, action);
    if (this.phase === 'scoring') return this._scoreAction(playerId, action);
    return { ok: false, error: '游戏已结束' };
  }

  _playAction(playerId, myColor, action) {
    if (this.currentPlayerId() !== playerId) return { ok: false, error: '还没轮到你' };
    this._pushSnapshot(); // 供悔棋回退（pass/落子都记）

    // 停手
    if (action.pass) {
      this.consecutivePasses += 1;
      this.lastMoverColor = myColor;
      this.lastMove = { pass: true };
      if (this.consecutivePasses >= 2) {
        this.phase = 'scoring';
        this.deadStones = new Set();
        this.confirmed = {};
      } else {
        this.currentColor = myColor === BLACK ? WHITE : BLACK;
      }
      return { ok: true };
    }

    // 落子
    const { row, col } = action;
    if (!Number.isInteger(row) || !Number.isInteger(col) || !this.inBounds(row, col)) {
      return { ok: false, error: '坐标非法' };
    }
    if (this.board[row][col] !== EMPTY) return { ok: false, error: '该位置已有棋子' };

    const snapshot = this.cloneBoard(this.board); // 失败时回滚
    const opp = myColor === BLACK ? WHITE : BLACK;
    this.board[row][col] = myColor;

    // 提子：检查相邻对方无气棋群
    let capturedNow = 0;
    const checked = new Set();
    for (const [nr, nc] of this.neighbors(row, col)) {
      if (this.board[nr][nc] !== opp) continue;
      const g = this.groupAt(this.board, nr, nc);
      const key = g.members.map(([r, c]) => `${r},${c}`).sort().join(';');
      if (checked.has(key)) continue;
      checked.add(key);
      if (g.liberties === 0) {
        for (const [r, c] of g.members) this.board[r][c] = EMPTY;
        capturedNow += g.members.length;
      }
    }
    this.captured[myColor] += capturedNow;

    // 自杀判定：提子后己方该群仍无气则非法
    const myGroup = this.groupAt(this.board, row, col);
    if (myGroup.liberties === 0) {
      this.board = snapshot;
      this.captured[myColor] -= capturedNow;
      return { ok: false, error: '禁着：自杀手' };
    }

    // 超级劫：盘面不可重现历史
    const h = this.hashBoard(this.board);
    if (this.history.has(h)) {
      this.board = snapshot;
      this.captured[myColor] -= capturedNow;
      return { ok: false, error: '禁着：劫（重现历史盘面）' };
    }

    // 提交
    this.history.add(h);
    this.consecutivePasses = 0;
    this.lastMoverColor = myColor;
    this.lastMove = { row, col };
    this.currentColor = opp;
    return { ok: true };
  }

  _scoreAction(playerId, action) {
    // 继续对局
    if (action.resume) {
      this.phase = 'play';
      this.consecutivePasses = 0;
      this.deadStones = new Set();
      this.confirmed = {};
      // 下一手轮到上次停手者的对方
      this.currentColor = this.lastMoverColor === BLACK ? WHITE : BLACK;
      return { ok: true };
    }
    // 切换死子标记
    if (action.toggle) {
      const { row, col } = action.toggle;
      if (!this.inBounds(row, col) || this.board[row][col] === EMPTY) {
        return { ok: false, error: '只能标记有棋子的点' };
      }
      const k = `${row},${col}`;
      if (this.deadStones.has(k)) this.deadStones.delete(k); else this.deadStones.add(k);
      this.confirmed = {}; // 任何改动都需重新确认
      return { ok: true };
    }
    // 确认
    if (action.confirm) {
      this.confirmed[playerId] = true;
      const allConfirmed = this.players.every((p) => this.confirmed[p.id]);
      if (allConfirmed) this._finalize();
      return { ok: true };
    }
    return { ok: false, error: '终局阶段未知动作' };
  }

  _finalize() {
    // 死子视为被提，构建有效盘面
    const eff = this.cloneBoard(this.board);
    for (const k of this.deadStones) {
      const [r, c] = k.split(',').map(Number);
      eff[r][c] = EMPTY;
    }
    let blackStones = 0, whiteStones = 0;
    for (let r = 0; r < this.size; r++)
      for (let c = 0; c < this.size; c++) {
        if (eff[r][c] === BLACK) blackStones++;
        else if (eff[r][c] === WHITE) whiteStones++;
      }

    // 数空：纯被一方围住的空点归该方
    const visited = Array.from({ length: this.size }, () => Array(this.size).fill(false));
    let blackTerr = 0, whiteTerr = 0;
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        if (eff[r][c] !== EMPTY || visited[r][c]) continue;
        // 洪泛这块空区域，记录相邻颜色
        const region = [];
        const borders = new Set();
        const stack = [[r, c]];
        visited[r][c] = true;
        while (stack.length) {
          const [cr, cc] = stack.pop();
          region.push([cr, cc]);
          for (const [nr, nc] of this.neighbors(cr, cc)) {
            if (eff[nr][nc] === EMPTY) {
              if (!visited[nr][nc]) { visited[nr][nc] = true; stack.push([nr, nc]); }
            } else borders.add(eff[nr][nc]);
          }
        }
        if (borders.size === 1) {
          const only = [...borders][0];
          if (only === BLACK) blackTerr += region.length;
          else whiteTerr += region.length;
        } // borders 含两色或为空 => 公气/dame，不计
      }
    }

    const blackArea = blackStones + blackTerr;
    const whiteArea = whiteStones + whiteTerr;
    const whiteFinal = whiteArea + this.komi;
    const blackFinal = blackArea;
    const winnerColor = blackFinal > whiteFinal ? BLACK : WHITE;
    const winnerIdx = this.indexByColor[winnerColor];
    const winnerId = this.players.find((p) => p.index === winnerIdx)?.id ?? null;

    this.over = true;
    this.phase = 'over';
    this.result = {
      scores: { black: blackFinal, white: whiteFinal, komi: this.komi,
        blackArea, whiteArea, blackTerr, whiteTerr },
      winnerId,
      margin: Math.abs(blackFinal - whiteFinal),
    };
  }
}
