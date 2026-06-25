// 五子棋渲染器（Canvas）—— 实现 SPA 里的渲染器契约。
// 契约：mount(container, ctx) / onState(public, private, turnIndex) / onOver(result, public, private)
// ctx: { client, yourIndex, publicState, privateState }
// yourIndex: 0=黑, 1=白

const BLACK = 1, WHITE = 2, EMPTY = 0;

export const GomokuRenderer = {
  _state: null,
  _ctx: null,
  _canvas: null,
  _info: null,

  mount(container, ctx) {
    this._ctx = ctx;
    container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'gomoku';
    this._info = document.createElement('div');
    this._info.className = 'gomoku-info';
    const canvas = document.createElement('canvas');
    canvas.width = 600; canvas.height = 600;
    this._canvas = canvas;
    wrap.appendChild(this._info);
    wrap.appendChild(canvas);
    container.appendChild(wrap);

    canvas.addEventListener('click', (e) => this._handleClick(e));
    this._render(ctx.publicState);
  },

  onState(publicState, _privateState, _turnIndex) {
    this._render(publicState);
  },

  onOver(result, publicState) {
    this._render(publicState);
    let text;
    const won = result.winnerId === this._ctx.playerId;
    if (result.draw) text = '🤝 平局！';
    else if (result.reason === 'forfeit') text = won ? '🎉 对方认输，你赢了！' : '😢 你已认输';
    else text = won ? '🎉 你赢了！' : '😢 你输了';
    this._info.textContent = text;
    this._info.classList.add('over');
  },

  _render(state) {
    if (!state) return;
    this._state = state;
    const { size, board, currentColor, turnIndex, lastMove } = state;
    const canvas = this._canvas;
    const ctx = canvas.getContext('2d');
    const padding = 20;
    const step = (canvas.width - padding * 2) / (size - 1);

    // 背景木色
    ctx.fillStyle = '#e8b96b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 网格线
    ctx.strokeStyle = '#6b4a1f';
    ctx.lineWidth = 1;
    for (let i = 0; i < size; i++) {
      ctx.beginPath(); ctx.moveTo(padding, padding + i * step);
      ctx.lineTo(padding + (size - 1) * step, padding + i * step); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(padding + i * step, padding);
      ctx.lineTo(padding + i * step, padding + (size - 1) * step); ctx.stroke();
    }

    // 棋子
    const radius = step * 0.42;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (board[r][c] === EMPTY) continue;
        const x = padding + c * step, y = padding + r * step;
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = board[r][c] === BLACK ? '#111' : '#fff';
        ctx.fill();
        ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
      }
    }

    // 最近一手高亮
    if (lastMove) {
      const { row, col } = lastMove;
      const x = padding + col * step, y = padding + row * step;
      ctx.strokeStyle = '#e02929'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, radius * 0.4, 0, Math.PI * 2); ctx.stroke();
    }

    // 提示轮次
    this._info.classList.remove('over');
    const myTurn = turnIndex === this._ctx.yourIndex;
    const myColor = this._ctx.yourIndex === 0 ? '黑' : '白';
    if (turnIndex < 0) {
      // 等待 onOver 显示结果，这里先留空
    } else if (myTurn) {
      this._info.textContent = `轮到你下（${myColor}棋）`;
    } else {
      this._info.textContent = `对手思考中…（对方执${currentColor === BLACK ? '黑' : '白'}）`;
    }
    this._step = step; this._padding = padding; this._size = size;
  },

  _handleClick(e) {
    const state = this._state;
    if (!state || state.turnIndex < 0) return;
    if (state.turnIndex !== this._ctx.yourIndex) return;
    const rect = this._canvas.getBoundingClientRect();
    const scale = this._canvas.width / rect.width;
    const x = (e.clientX - rect.left) * scale;
    const y = (e.clientY - rect.top) * scale;
    const col = Math.round((x - this._padding) / this._step);
    const row = Math.round((y - this._padding) / this._step);
    if (row < 0 || row >= this._size || col < 0 || col >= this._size) return;
    this._ctx.client.action({ row, col });
  },
};
