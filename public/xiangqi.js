// 中国象棋渲染器（Canvas）—— 实现 SPA 渲染器契约。
// mount(container, ctx) / onState(public, private, turnIndex) / onOver(result, public)
// ctx: { client, playerId, yourIndex }  yourIndex: 0=红, 1=黑
// 棋盘 9 列×10 行；row0=黑方(上), row9=红方(下)。红子红色，黑子墨色。

const RED = 'r', BLACK = 'b';
// 棋子文字
const CHAR = {
  r: { K: '帥', A: '仕', E: '相', N: '傌', R: '俥', C: '炮', P: '兵' },
  b: { K: '將', A: '士', E: '象', N: '馬', R: '車', C: '砲', P: '卒' },
};

export const XiangqiRenderer = {
  mount(container, ctx) {
    container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'xiangqi';
    this._info = document.createElement('div');
    this._info.className = 'gomoku-info'; // 复用样式
    const canvas = document.createElement('canvas');
    canvas.width = 540; canvas.height = 600;
    this._canvas = canvas;
    wrap.append(this._info, canvas);
    container.appendChild(wrap);
    canvas.addEventListener('click', (e) => this._handleClick(e));
    this._ctx = ctx;
    this._selected = null; // [r,c]
    this._render(ctx.publicState);
  },

  onState(publicState) { this._render(publicState); },

  onOver(result, publicState) {
    this._render(publicState);
    const won = result.winnerId === this._ctx.playerId;
    let line;
    if (result.draw) line = '🤝 和棋';
    else if (result.reason === 'forfeit') line = won ? '🎉 对方认输，你赢了！' : '😢 你已认输';
    else line = won ? '🎉 你赢了！' : '😢 你输了';
    this._info.textContent = line;
    this._info.classList.add('over');
    this._selected = null;
  },

  _render(state) {
    if (!state) return;
    this._state = state;
    const { board, lastMove, turnIndex, legalMoves, inCheckSide, phase } = state;
    const canvas = this._canvas;
    const ctx = canvas.getContext('2d');
    const pad = 30;
    const stepX = (canvas.width - pad * 2) / (9 - 1);
    const stepY = (canvas.height - pad * 2) / (10 - 1);
    this._pad = pad; this._stepX = stepX; this._stepY = stepY;

    // 木质底
    ctx.fillStyle = '#e8c98a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 横线 10 条
    ctx.strokeStyle = '#5a3d18'; ctx.lineWidth = 1.2;
    for (let r = 0; r < 10; r++) {
      ctx.beginPath();
      ctx.moveTo(pad, pad + r * stepY);
      ctx.lineTo(pad + 8 * stepX, pad + r * stepY);
      ctx.stroke();
    }
    // 竖线 9 条：两端贯通，中间在河界断开
    for (let c = 0; c < 9; c++) {
      if (c === 0 || c === 8) {
        ctx.beginPath();
        ctx.moveTo(pad + c * stepX, pad);
        ctx.lineTo(pad + c * stepX, pad + 9 * stepY);
        ctx.stroke();
      } else {
        // 上半 0..4
        ctx.beginPath();
        ctx.moveTo(pad + c * stepX, pad);
        ctx.lineTo(pad + c * stepX, pad + 4 * stepY);
        ctx.stroke();
        // 下半 5..9
        ctx.beginPath();
        ctx.moveTo(pad + c * stepX, pad + 5 * stepY);
        ctx.lineTo(pad + c * stepX, pad + 9 * stepY);
        ctx.stroke();
      }
    }
    // 九宫斜线
    const palace = (top) => {
      const r0 = top ? 0 : 7;
      const cy = pad + (r0 + 0) * stepY, cy2 = pad + (r0 + 2) * stepY;
      const cx3 = pad + 3 * stepX, cx5 = pad + 5 * stepX;
      ctx.beginPath(); ctx.moveTo(cx3, cy); ctx.lineTo(cx5, cy2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx5, cy); ctx.lineTo(cx3, cy2); ctx.stroke();
    };
    palace(true); palace(false);

    // 楚河汉界
    ctx.fillStyle = '#5a3d18';
    ctx.font = '22px serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const midY = pad + 4.5 * stepY;
    ctx.fillText('楚 河', pad + 2 * stepX, midY);
    ctx.fillText('漢 界', pad + 6 * stepX, midY);

    // 末手起止标记
    if (lastMove) {
      const { fr, fc, tr, tc } = lastMove;
      ctx.strokeStyle = '#1e90ff'; ctx.lineWidth = 2;
      for (const [r, c] of [[fr, fc], [tr, tc]]) {
        const x = pad + c * stepX, y = pad + r * stepY;
        ctx.strokeRect(x - stepX * 0.42, y - stepY * 0.42, stepX * 0.84, stepY * 0.84);
      }
    }

    // 选中子的可走点提示
    if (this._selected) {
      const [sr, sc] = this._selected;
      const mine = (legalMoves || []).filter((m) => m[0] === sr && m[1] === sc);
      ctx.fillStyle = 'rgba(46,160,67,0.5)';
      for (const [, , tr, tc] of mine) {
        const x = pad + tc * stepX, y = pad + tr * stepY;
        ctx.beginPath(); ctx.arc(x, y, stepX * 0.16, 0, Math.PI * 2); ctx.fill();
      }
      // 选中框
      const x = pad + sc * stepX, y = pad + sr * stepY;
      ctx.strokeStyle = '#2ea043'; ctx.lineWidth = 2.5;
      ctx.strokeRect(x - stepX * 0.46, y - stepY * 0.46, stepX * 0.92, stepY * 0.92);
    }

    // 棋子
    const radius = Math.min(stepX, stepY) * 0.42;
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        const p = board[r][c];
        if (!p) continue;
        const x = pad + c * stepX, y = pad + r * stepY;
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = p.s === RED ? '#f4d3d3' : '#3a3a3a';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = p.s === RED ? '#c0392b' : '#000';
        ctx.stroke();
        // 内圈
        ctx.beginPath(); ctx.arc(x, y, radius * 0.82, 0, Math.PI * 2);
        ctx.lineWidth = 1; ctx.stroke();
        // 文字
        ctx.fillStyle = p.s === RED ? '#c0392b' : '#e8e8e8';
        ctx.font = `${radius * 1.1}px serif`;
        ctx.fillText(CHAR[p.s][p.t], x, y);
      }
    }

    // 信息
    this._info.classList.remove('over');
    const myColor = this._ctx.yourIndex === 0 ? '红' : '黑';
    const mySide = this._ctx.yourIndex === 0 ? RED : BLACK;
    if (phase === 'over') {
      // onOver 会显示结果，这里留空
    } else {
      const myTurn = turnIndex === this._ctx.yourIndex;
      let t = myTurn ? `轮到你走（${myColor}）` : '对方思考中…';
      if (inCheckSide === mySide) t = '⚠️ 你被将军！';
      else if (inCheckSide) t = '将军！' + (myTurn ? `轮到你走（${myColor}）` : '');
      this._info.textContent = t;
    }
  },

  _handleClick(e) {
    const s = this._state;
    if (!s || s.phase === 'over') return;
    const rect = this._canvas.getBoundingClientRect();
    const sx = this._canvas.width / rect.width;
    const sy = this._canvas.height / rect.height;
    const x = (e.clientX - rect.left) * sx;
    const y = (e.clientY - rect.top) * sy;
    const c = Math.round((x - this._pad) / this._stepX);
    const r = Math.round((y - this._pad) / this._stepY);
    if (r < 0 || r > 9 || c < 0 || c > 8) return;

    const myTurn = s.turnIndex === this._ctx.yourIndex;
    if (!myTurn) return;
    const mySide = this._ctx.yourIndex === 0 ? RED : BLACK;
    const piece = s.board[r][c];

    // 已选中 -> 尝试走到 (r,c)
    if (this._selected) {
      const [sr, sc] = this._selected;
      const legal = (s.legalMoves || []).some((m) => m[0] === sr && m[1] === sc && m[2] === r && m[3] === c);
      if (legal) {
        this._ctx.client.action({ fr: sr, fc: sc, tr: r, tc: c });
        this._selected = null;
        return;
      }
      // 点了己方另一子 -> 改选
      if (piece && piece.s === mySide) { this._selected = [r, c]; this._render(s); return; }
      // 否则取消
      this._selected = null; this._render(s); return;
    }
    // 未选中 -> 选己方子
    if (piece && piece.s === mySide) {
      this._selected = [r, c];
      this._render(s);
    }
  },
};
