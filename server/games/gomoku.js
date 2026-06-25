// 五子棋 —— BaseGame 契约实现。
// 15x15 棋盘，黑(1)先手白(2)，任一方横/竖/斜连成五子即胜。

import { BaseGame } from './baseGame.js';

const SIZE = 15;
const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;

export default class Gomoku extends BaseGame {
  static metadata = {
    id: 'gomoku',
    name: '五子棋',
    minPlayers: 2,
    maxPlayers: 2,
  };

  constructor(players, options = {}) {
    super(players, options);
    this.size = options.size || SIZE;
    // 棋盘：二维数组 [row][col]，值 EMPTY/BLACK/WHITE
    this.board = Array.from({ length: this.size }, () =>
      Array(this.size).fill(EMPTY)
    );
    // 按座位号映射：index 0 -> 黑, index 1 -> 白
    this.colorByIndex = { 0: BLACK, 1: WHITE };
    this.indexByColor = { [BLACK]: 0, [WHITE]: 1 };
    this.currentColor = BLACK; // 黑先
    this.moves = []; // [{row,col,color,playerId}]
    this.winner = null; // playerId 或 'draw'
    this.over = false;
    this.lastMove = null;
    this.phase = 'play';
    this.result = null;
  }

  currentPlayerId() {
    if (this.over) return null;
    const idx = this.indexByColor[this.currentColor];
    const p = this.players.find((p) => p.index === idx);
    return p ? p.id : null;
  }

  getCurrentPlayerId() {
    return this.currentPlayerId();
  }

  inBounds(r, c) {
    return r >= 0 && r < this.size && c >= 0 && c < this.size;
  }

  /** 从 (r,c) 沿 4 个方向数同色连续棋子，>=5 即胜 */
  checkWin(r, c) {
    const color = this.board[r][c];
    if (color === EMPTY) return false;
    const dirs = [
      [0, 1], // 横
      [1, 0], // 竖
      [1, 1], // 主对角
      [1, -1], // 副对角
    ];
    for (const [dr, dc] of dirs) {
      let count = 1;
      // 正向
      for (let i = 1; i < 5; i++) {
        const nr = r + dr * i, nc = c + dc * i;
        if (this.inBounds(nr, nc) && this.board[nr][nc] === color) count++;
        else break;
      }
      // 反向
      for (let i = 1; i < 5; i++) {
        const nr = r - dr * i, nc = c - dc * i;
        if (this.inBounds(nr, nc) && this.board[nr][nc] === color) count++;
        else break;
      }
      if (count >= 5) return true;
    }
    return false;
  }

  applyAction(playerId, action) {
    if (this.over) return { ok: false, error: '游戏已结束' };
    if (this.currentPlayerId() !== playerId) return { ok: false, error: '还没轮到你' };

    const { row, col } = action || {};
    if (
      !Number.isInteger(row) || !Number.isInteger(col) ||
      !this.inBounds(row, col)
    ) {
      return { ok: false, error: '坐标非法' };
    }
    if (this.board[row][col] !== EMPTY) return { ok: false, error: '该位置已有棋子' };

    const color = this.currentColor;
    this.board[row][col] = color;
    this.moves.push({ row, col, color, playerId });
    this.lastMove = { row, col };

    if (this.checkWin(row, col)) {
      this.over = true;
      this.winner = playerId;
      this.phase = 'over';
      this.result = { winnerId: playerId, reason: 'five' };
    } else if (this.moves.length === this.size * this.size) {
      this.over = true;
      this.winner = 'draw';
      this.phase = 'over';
      this.result = { draw: true, reason: 'full' };
    } else {
      // 换手
      this.currentColor = color === BLACK ? WHITE : BLACK;
    }
    return { ok: true };
  }

  getPublicState() {
    return {
      size: this.size,
      board: this.board,
      currentColor: this.currentColor, // 当前应落子颜色
      turnIndex: this.over ? -1 : this.indexByColor[this.currentColor],
      lastMove: this.lastMove,
      moves: this.moves.length,
      phase: this.phase,
    };
  }

  // 悔棋：回退最后一手，轮次回到该手作者
  undo() {
    if (this.over) return { ok: false, error: '游戏已结束，无法悔棋' };
    if (this.moves.length === 0) return { ok: false, error: '没有可悔的棋' };
    const last = this.moves.pop();
    this.board[last.row][last.col] = EMPTY;
    this.currentColor = last.color; // 轮回到该手作者
    this.lastMove = this.moves.length ? {
      row: this.moves[this.moves.length - 1].row,
      col: this.moves[this.moves.length - 1].col,
    } : null;
    return { ok: true };
  }

  // 完全信息游戏：私有视角等同公共视角
  getPrivateState() {
    return this.getPublicState();
  }

  isOver() {
    return this.over;
  }
}
