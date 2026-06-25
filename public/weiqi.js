// 围棋渲染器（Canvas）—— 实现 SPA 渲染器契约。
// mount(container, ctx) / onState(public, private, turnIndex) / onOver(result, public)
// 阶段：play(落子/Pass) -> scoring(死子标记/确认/继续) -> over
// ctx: { client, playerId, yourIndex }  yourIndex: 0=黑, 1=白

const BLACK = 1, WHITE = 2, EMPTY = 0;

function starPoints(size) {
  if (size === 19) return [3, 9, 15];
  if (size === 13) return [3, 6, 9];
  if (size === 9) return [2, 4, 6];
  return [];
}

export const WeiqiRenderer = {
  mount(container, ctx) {
    container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'weiqi';
    this._info = document.createElement('div');
    this._info.className = 'weiqi-info';
    const canvas = document.createElement('canvas');
    canvas.width = 660; canvas.height = 660;
    this._canvas = canvas;
    // 操作栏
    const bar = document.createElement('div');
    bar.className = 'weiqi-bar';
    this._passBtn = this._mkBtn('停手 (Pass)', () => ctx.client.action({ pass: true }));
    this._confirmBtn = this._mkBtn('确认终局', () => ctx.client.action({ confirm: true }), true);
    this._resumeBtn = this._mkBtn('继续对局', () => ctx.client.action({ resume: true }));
    bar.append(this._passBtn, this._confirmBtn, this._resumeBtn);
    wrap.append(this._info, canvas, bar);
    container.appendChild(wrap);

    canvas.addEventListener('click', (e) => this._handleClick(e));
    this._ctx = ctx;
    this._render(ctx.publicState);
  },

  _mkBtn(text, fn, primary = false) {
    const b = document.createElement('button');
    b.textContent = text;
    if (primary) b.className = 'primary';
    b.classList.add('hidden');
    b.addEventListener('click', fn);
    return b;
  },

  onState(publicState) { this._render(publicState); },

  onOver(result, publicState) {
    this._render(publicState);
    const s = result.scores || {};
    const won = result.winnerId === this._ctx.playerId;
    let line;
    if (result.draw) line = '🤝 和棋';
    else if (result.reason === 'forfeit') line = won ? '🎉 对方认输，你赢了！' : '😢 你已认输';
    else if (result.scores) line = `黑 ${s.black} : 白 ${s.white}(含贴目${s.komi}) —— ${won ? '🎉 你赢' : '😢 你输'}${result.margin != null ? `（差${result.margin}目）` : ''}`;
    else line = won ? '🎉 你赢了！' : '😢 你输了';
    this._info.textContent = line;
    this._info.classList.add('over');
    this._passBtn.classList.add('hidden');
    this._confirmBtn.classList.add('hidden');
    this._resumeBtn.classList.add('hidden');
  },

  _render(state) {
    if (!state) return;
    this._state = state;
    const { size, board, lastMove, phase, turnIndex, prisoners, consecutivePasses, deadStones, confirmed } = state;
    this._size = size;
    const canvas = this._canvas;
    const ctx = canvas.getContext('2d');
    const pad = 24;
    const step = (canvas.width - pad * 2) / (size - 1);

    // 木色背景
    ctx.fillStyle = '#e8b96b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#5a3d18';
    ctx.lineWidth = 1;
    for (let i = 0; i < size; i++) {
      ctx.beginPath(); ctx.moveTo(pad, pad + i * step);
      ctx.lineTo(pad + (size - 1) * step, pad + i * step); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(pad + i * step, pad);
      ctx.lineTo(pad + i * step, pad + (size - 1) * step); ctx.stroke();
    }
    // 星位
    ctx.fillStyle = '#5a3d18';
    for (const p of starPoints(size)) for (const q of starPoints(size)) {
      ctx.beginPath(); ctx.arc(pad + p * step, pad + q * step, 3, 0, Math.PI * 2); ctx.fill();
    }

    const dead = new Set(deadStones || []);
    const radius = step * 0.46;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (board[r][c] === EMPTY) continue;
        const x = pad + c * step, y = pad + r * step;
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = board[r][c] === BLACK ? '#111' : '#f5f5f5';
        ctx.fill();
        ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
        if (dead.has(`${r},${c}`)) {
          ctx.strokeStyle = '#e02929'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(x - radius * 0.5, y - radius * 0.5);
          ctx.lineTo(x + radius * 0.5, y + radius * 0.5);
          ctx.moveTo(x + radius * 0.5, y - radius * 0.5);
          ctx.lineTo(x - radius * 0.5, y + radius * 0.5); ctx.stroke();
        }
      }
    }
    // 最后一手标记
    if (lastMove && lastMove.row != null) {
      const { row, col } = lastMove;
      const x = pad + col * step, y = pad + row * step;
      ctx.strokeStyle = '#e02929'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, radius * 0.35, 0, Math.PI * 2); ctx.stroke();
    }

    this._pad = pad; this._step = step;

    // 信息与按钮
    this._info.classList.remove('over');
    const myColor = this._ctx.yourIndex === 0 ? '黑' : '白';
    const pris = `（提子 黑${prisoners.black} 白${prisoners.white}）`;
    if (phase === 'play') {
      const myTurn = turnIndex === this._ctx.yourIndex;
      this._info.textContent = (myTurn ? `轮到你下（${myColor}）` : '对方思考中…') + pris +
        (consecutivePasses > 0 ? '  对方已停手' : '');
      this._passBtn.classList.toggle('hidden', !myTurn);
      this._confirmBtn.classList.add('hidden');
      this._resumeBtn.classList.add('hidden');
    } else if (phase === 'scoring') {
      const meConfirmed = !!confirmed[this._ctx.playerId];
      this._info.textContent = '终局死子标记：点击棋子切换死/活' + pris + (meConfirmed ? '（已确认，等对方）' : '');
      this._passBtn.classList.add('hidden');
      this._confirmBtn.classList.toggle('hidden', !meConfirmed);
      this._resumeBtn.classList.remove('hidden');
    }
  },

  _handleClick(e) {
    const s = this._state;
    if (!s) return;
    const rect = this._canvas.getBoundingClientRect();
    const scale = this._canvas.width / rect.width;
    const x = (e.clientX - rect.left) * scale;
    const y = (e.clientY - rect.top) * scale;
    const col = Math.round((x - this._pad) / this._step);
    const row = Math.round((y - this._pad) / this._step);
    if (row < 0 || row >= this._size || col < 0 || col >= this._size) return;

    if (s.phase === 'play') {
      if (s.turnIndex !== this._ctx.yourIndex) return;
      this._ctx.client.action({ row, col });
    } else if (s.phase === 'scoring') {
      if (s.board[row][col] === EMPTY) return;
      this._ctx.client.action({ toggle: { row, col } });
    }
  },
};
