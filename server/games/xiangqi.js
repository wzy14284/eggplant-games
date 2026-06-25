// 中国象棋 —— BaseGame 契约实现。
// 9 列 × 10 行，row0=黑方、row9=红方，楚河在 4/5 行间。红先（index0=红）。
// 棋子 { s:'r'|'b', t:'K'|'A'|'E'|'N'|'R'|'C'|'P' } 或 null。
//   K 将/帥 A 士/仕 E 象/相 N 馬 R 車 C 炮 P 兵/卒
// 胜负：吃将即胜；对方无合法走法（被将=将死，否则困毙）判负。不可走成己方被将/飞将。
// 限制：不实现「禁长打/重复局面」规则。

import { BaseGame } from './baseGame.js';

const RED = 'r', BLACK = 'b';
const ROWS = 10, COLS = 9;

function initialBoard() {
  const b = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  // 后排：車馬象士將士象馬車
  const back = ['R', 'N', 'E', 'A', 'K', 'A', 'E', 'N', 'R'];
  for (let c = 0; c < COLS; c++) {
    b[0][c] = { s: BLACK, t: back[c] };
    b[ROWS - 1][c] = { s: RED, t: back[c] };
  }
  // 炮：黑 row2 col1/7；红 row7 col1/7
  b[2][1] = { s: BLACK, t: 'C' }; b[2][7] = { s: BLACK, t: 'C' };
  b[7][1] = { s: RED, t: 'C' }; b[7][7] = { s: RED, t: 'C' };
  // 兵/卒：黑 row3、红 row6，col 0/2/4/6/8
  for (const c of [0, 2, 4, 6, 8]) {
    b[3][c] = { s: BLACK, t: 'P' };
    b[6][c] = { s: RED, t: 'P' };
  }
  return b;
}

export default class Xiangqi extends BaseGame {
  static metadata = {
    id: 'xiangqi',
    name: '中国象棋',
    minPlayers: 2,
    maxPlayers: 2,
  };

  constructor(players, options = {}) {
    super(players, options);
    this.board = initialBoard();
    this.colorByIndex = { 0: RED, 1: BLACK };
    this.indexByColor = { [RED]: 0, [BLACK]: 1 };
    this.currentSide = RED; // 红先
    this.lastMove = null;    // { fr, fc, tr, tc }
    this.captured = [];      // [{ s, t }]
    this.undoStack = [];
    this.legalMovesCache = null;
    this.inCheckSide = null; // 当前被将军方
    this.over = false;
    this.result = null;
    this.phase = 'play';
  }

  // ---- 工具 ----
  inBoard(r, c) { return r >= 0 && r < ROWS && c >= 0 && c < COLS; }
  inPalace(r, c, side) {
    if (c < 3 || c > 5) return false;
    return side === RED ? (r >= 7 && r <= 9) : (r >= 0 && r <= 2);
  }
  crossedRiver(r, side) {
    return side === RED ? r <= 4 : r >= 5;
  }
  enemy(side) { return side === RED ? BLACK : RED; }
  cloneBoard(b) { return b.map((row) => row.map((p) => (p ? { ...p } : null))); }
  findGeneral(b, side) {
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const p = b[r][c];
        if (p && p.s === side && p.t === 'K') return [r, c];
      }
    return null;
  }

  /** 两将是否同列且中间无子（飞将） */
  generalsFace(b) {
    const rk = this.findGeneral(b, RED), bk = this.findGeneral(b, BLACK);
    if (!rk || !bk || rk[1] !== bk[1]) return false;
    const col = rk[1];
    const [lo, hi] = rk[0] < bk[0] ? [rk[0], bk[0]] : [bk[0], rk[0]];
    for (let r = lo + 1; r < hi; r++) if (b[r][col]) return false;
    return true;
  }

  // ---- 单子伪合法走法（不含己方被将判定） ----
  pieceMoves(b, r, c) {
    const p = b[r][c];
    if (!p) return [];
    const side = p.s;
    const out = [];
    const push = (tr, tc) => {
      if (!this.inBoard(tr, tc)) return;
      const t = b[tr][tc];
      if (!t || t.s !== side) out.push([tr, tc]);
    };
    const ray = (dr, dc) => {
      let nr = r + dr, nc = c + dc;
      while (this.inBoard(nr, nc)) {
        const t = b[nr][nc];
        if (!t) out.push([nr, nc]);
        else { if (t.s !== side) out.push([nr, nc]); break; }
        nr += dr; nc += dc;
      }
    };

    switch (p.t) {
      case 'K': { // 将/帥：正交 1 步，不出九宫
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nr = r + dr, nc = c + dc;
          if (this.inPalace(nr, nc, side)) push(nr, nc);
        }
        break;
      }
      case 'A': { // 士：斜 1 步，不出九宫
        for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
          const nr = r + dr, nc = c + dc;
          if (this.inPalace(nr, nc, side)) push(nr, nc);
        }
        break;
      }
      case 'E': { // 象：田字，象眼须空，不过河
        for (const [dr, dc] of [[-2, -2], [-2, 2], [2, -2], [2, 2]]) {
          const nr = r + dr, nc = c + dc;
          if (!this.inBoard(nr, nc)) continue;
          if (side === RED && nr <= 4) continue;   // 红象不过河（红侧 r>=5）
          if (side === BLACK && nr >= 5) continue;  // 黑象不过河（黑侧 r<=4）
          if (b[r + dr / 2][c + dc / 2]) continue;   // 塞象眼
          push(nr, nc);
        }
        break;
      }
      case 'N': { // 馬：蹩马腿
        const cand = [
          [-2, -1, -1, 0], [-2, 1, -1, 0],
          [2, -1, 1, 0], [2, 1, 1, 0],
          [-1, -2, 0, -1], [1, -2, 0, -1],
          [-1, 2, 0, 1], [1, 2, 0, 1],
        ];
        for (const [dr, dc, lr, lc] of cand) {
          const nr = r + dr, nc = c + dc;
          if (!this.inBoard(nr, nc)) continue;
          if (b[r + lr][c + lc]) continue; // 蹩腿
          push(nr, nc);
        }
        break;
      }
      case 'R': { // 車：直线
        ray(-1, 0); ray(1, 0); ray(0, -1); ray(0, 1);
        break;
      }
      case 'C': { // 炮：平移同車落点空；吃子须翻越一个炮架
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          let nr = r + dr, nc = c + dc;
          let screen = false;
          while (this.inBoard(nr, nc)) {
            const t = b[nr][nc];
            if (!screen) {
              if (!t) out.push([nr, nc]); // 平移到空点
              else screen = true;          // 找到炮架
            } else if (t) {
              if (t.s !== side) out.push([nr, nc]); // 翻架吃子
              break;
            }
            nr += dr; nc += dc;
          }
        }
        break;
      }
      case 'P': { // 兵/卒
        const fwd = side === RED ? -1 : 1;
        push(r + fwd, c);
        if (this.crossedRiver(r, side)) {
          push(r, c - 1); push(r, c + 1);
        }
        break;
      }
    }
    return out;
  }

  /** side 的所有伪合法走法 */
  pseudoMoves(b, side) {
    const moves = [];
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const p = b[r][c];
        if (p && p.s === side)
          for (const [tr, tc] of this.pieceMoves(b, r, c)) moves.push([r, c, tr, tc]);
      }
    return moves;
  }

  /** side 是否被将军（含飞将互照） */
  inCheck(b, side) {
    if (this.generalsFace(b)) return true;
    const g = this.findGeneral(b, side);
    if (!g) return false;
    const enemy = this.enemy(side);
    // 任何敌子能走到将的位置 = 被将
    for (const [fr, fc, tr, tc] of this.pseudoMoves(b, enemy)) {
      if (tr === g[0] && tc === g[1]) return true;
    }
    return false;
  }

  /** side 的合法走法（走后己方不被将、不飞将） */
  legalMoves(side) {
    const res = [];
    for (const [fr, fc, tr, tc] of this.pseudoMoves(this.board, side)) {
      const snap = this.cloneBoard(this.board);
      this.board[tr][tc] = this.board[fr][fc];
      this.board[fr][fc] = null;
      const safe = !this.inCheck(this.board, side);
      this.board = snap;
      if (safe) res.push([fr, fc, tr, tc]);
    }
    return res;
  }

  // ---- 状态查询 ----
  currentPlayerId() {
    if (this.over) return null;
    const idx = this.indexByColor[this.currentSide];
    return this.players.find((p) => p.index === idx)?.id ?? null;
  }
  getCurrentPlayerId() { return this.currentPlayerId(); }
  isOver() { return this.over; }
  getResult() { return this.result || {}; }

  getPublicState() {
    if (!this.legalMovesCache && !this.over) {
      this.legalMovesCache = this.legalMoves(this.currentSide);
    }
    return {
      board: this.board,
      turnIndex: this.over ? -1 : this.indexByColor[this.currentSide],
      currentSide: this.currentSide,
      lastMove: this.lastMove,
      captured: this.captured,
      legalMoves: this.over ? [] : (this.legalMovesCache || []),
      inCheckSide: this.inCheckSide,
      phase: this.phase,
    };
  }
  getPrivateState() { return this.getPublicState(); }

  // ---- 动作 ----
  applyAction(playerId, action) {
    if (this.over) return { ok: false, error: '游戏已结束' };
    if (this.currentPlayerId() !== playerId) return { ok: false, error: '还没轮到你' };
    const { fr, fc, tr, tc } = action || {};
    if (![fr, fc, tr, tc].every((v) => Number.isInteger(v))) return { ok: false, error: '坐标非法' };
    if (!this.inBoard(fr, fc) || !this.inBoard(tr, tc)) return { ok: false, error: '坐标非法' };
    const piece = this.board[fr][fc];
    if (!piece || piece.s !== this.currentSide) return { ok: false, error: '只能移动己方棋子' };

    const legal = this.legalMoves(this.currentSide);
    const ok = legal.some(([a, b, c, d]) => a === fr && b === fc && c === tr && d === tc);
    if (!ok) return { ok: false, error: '不合走法' };

    // 快照供悔棋
    this.undoStack.push({
      board: this.cloneBoard(this.board),
      currentSide: this.currentSide,
      lastMove: this.lastMove,
      captured: this.captured.slice(),
    });

    const target = this.board[tr][tc];
    if (target) this.captured.push(target);
    this.board[tr][tc] = piece;
    this.board[fr][fc] = null;
    this.lastMove = { fr, fc, tr, tc };

    // 吃将即胜
    if (target && target.t === 'K') {
      this.over = true; this.phase = 'over';
      this.result = { winnerId: playerId, reason: 'capture-king' };
      this.legalMovesCache = null;
      return { ok: true };
    }

    // 换手
    const moverSide = this.currentSide;
    this.currentSide = this.enemy(moverSide);
    this.legalMovesCache = null;
    const oppLegal = this.legalMoves(this.currentSide);
    this.inCheckSide = this.inCheck(this.board, this.currentSide) ? this.currentSide : null;
    if (oppLegal.length === 0) {
      // 对方无走法：被将=将死，否则困毙；均判对方负
      this.over = true; this.phase = 'over';
      this.result = {
        winnerId: playerId,
        reason: this.inCheckSide ? 'checkmate' : 'stalemate',
      };
    }
    return { ok: true };
  }

  undo() {
    if (this.over) return { ok: false, error: '游戏已结束，无法悔棋' };
    if (this.undoStack.length === 0) return { ok: false, error: '没有可悔的棋' };
    const s = this.undoStack.pop();
    this.board = s.board;
    this.currentSide = s.currentSide;
    this.lastMove = s.lastMove;
    this.captured = s.captured;
    this.legalMovesCache = null;
    this.inCheckSide = this.inCheck(this.board, this.currentSide) ? this.currentSide : null;
    return { ok: true };
  }
}
