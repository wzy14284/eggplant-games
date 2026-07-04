// 斗地主渲染器 —— 实现 SPA 里的渲染器契约。
// 契约：mount(container, ctx) / onState(public, private, turnIndex) / onOver(result, public, private)

// ── 常量 ──
const SUIT_SYMBOL = { 0: '♠', 1: '♥', 2: '♦', 3: '♣' };
const SUIT_COLOR = { 0: '#1a1a2e', 1: '#e02929', 2: '#e02929', 3: '#1a1a2e' };
const RANK_TEXT = { 3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'J',12:'Q',13:'K',14:'A',15:'2' };
const JOKER_TEXT = { 16: '小王', 17: '大王' };
const JOKER_COLOR = { 16: '#2ea043', 17: '#e02929' };

export const DoudizhuRenderer = {
  _ctx: null,
  _container: null,
  _state: null,
  _private: null,
  _selected: new Set(),   // cardKey set
  _elements: {},
  _dealingRendered: false,   // 发牌动画只播一次
  _countdownInterval: null,

  mount(container, ctx) {
    this._ctx = ctx;
    this._container = container;
    this._selected = new Set();
    this._dealingRendered = false;
    this._stopCountdown();
    container.innerHTML = '';

    const root = document.createElement('div');
    root.className = 'ddz';
    root.innerHTML = `
      <div class="ddz-info" id="ddzInfo"></div>
      <div class="ddz-table">
        <div class="ddz-dizhu-cards" id="ddzDizhuCards"></div>
        <div class="ddz-opponents">
          <div class="ddz-opp ddz-opp-left" id="ddzOppLeft">
            <div class="ddz-opp-avatarwrap">
              <div class="ddz-opp-avatar" id="ddzOppLeftAvatar"></div>
              <div class="ddz-countdown-badge" id="ddzOppLeftCountdown"></div>
            </div>
            <div class="ddz-opp-name" id="ddzOppLeftName"></div>
            <div class="ddz-opp-count" id="ddzOppLeftCount"></div>
            <div class="ddz-opp-cards" id="ddzOppLeftCards"></div>
          </div>
          <div class="ddz-opp ddz-opp-right" id="ddzOppRight">
            <div class="ddz-opp-avatarwrap">
              <div class="ddz-opp-avatar" id="ddzOppRightAvatar"></div>
              <div class="ddz-countdown-badge" id="ddzOppRightCountdown"></div>
            </div>
            <div class="ddz-opp-name" id="ddzOppRightName"></div>
            <div class="ddz-opp-count" id="ddzOppRightCount"></div>
            <div class="ddz-opp-cards" id="ddzOppRightCards"></div>
          </div>
        </div>
        <div class="ddz-center">
          <div class="ddz-play-area" id="ddzPlayArea"></div>
          <div class="ddz-bid-area hidden" id="ddzBidArea"></div>
          <div class="ddz-play-info" id="ddzPlayInfo"></div>
        </div>
        <div class="ddz-hand-area">
          <div class="ddz-hand-bar">
            <div class="ddz-my-countdown" id="ddzMyCountdown"></div>
            <div class="ddz-actions" id="ddzActions"></div>
          </div>
          <div class="ddz-hand" id="ddzHand"></div>
        </div>
      </div>
    `;
    container.appendChild(root);

    // 缓存元素引用
    const ids = ['ddzInfo',
      'ddzOppLeft','ddzOppLeftAvatar','ddzOppLeftName','ddzOppLeftCount','ddzOppLeftCards','ddzOppLeftCountdown',
      'ddzOppRight','ddzOppRightAvatar','ddzOppRightName','ddzOppRightCount','ddzOppRightCards','ddzOppRightCountdown',
      'ddzDizhuCards','ddzPlayArea','ddzBidArea','ddzPlayInfo','ddzHand','ddzActions','ddzMyCountdown'];
    for (const id of ids) this._elements[id] = root.querySelector('#' + id);

    this._render(ctx.publicState, ctx.privateState);
  },

  onState(publicState, privateState, _turnIndex) {
    this._render(publicState, privateState);
  },

  onOver(result, publicState, privateState) {
    this._render(publicState, privateState);
    this._showResult(result);
  },

  // ── 主渲染 ──
  _render(pub, priv) {
    if (!pub) return;
    // 发牌阶段只渲染一次，驱动 CSS 逐张出现动画；重连重播无妨但不重复
    if (pub.phase === 'dealing' && this._dealingRendered) return;
    const isDealing = pub.phase === 'dealing';
    if (isDealing) this._dealingRendered = true;
    else this._dealingRendered = false;

    this._state = pub;
    this._private = priv;

    const myIdx = priv?.yourIndex ?? -1;

    this._renderInfo(pub, myIdx);
    this._renderOpponents(pub, myIdx);
    this._renderDizhuCards(pub);
    this._renderPlayArea(pub, myIdx);
    this._renderHand(priv, isDealing);
    this._renderActions(pub, myIdx);

    // 倒计时放到当前决策玩家所在位置
    this._placeCountdown(pub, myIdx);
    const deadline = pub.phase === 'bidding' ? pub.bidDeadline
      : pub.phase === 'play' ? pub.playDeadline : null;
    if (deadline) this._startCountdown(deadline);
    else this._stopCountdown();
  },

  // 把倒计时徽章挂到当前决策者（自己 / 左上 / 右上）的槽位
  _placeCountdown(pub, myIdx) {
    const keys = ['ddzMyCountdown', 'ddzOppLeftCountdown', 'ddzOppRightCountdown'];
    for (const k of keys) {
      const el = this._elements[k];
      if (el) { el.textContent = ''; el.classList.remove('active'); }
    }
    const cur = pub.turnIndex;
    let deadline;
    if (pub.phase === 'bidding') deadline = pub.bidDeadline;
    else if (pub.phase === 'play') deadline = pub.playDeadline;
    else deadline = null;
    if (deadline == null || myIdx < 0 || cur == null || cur < 0) {
      this._elements.ddzCountdown = null;
      return;
    }
    let slot;
    if (cur === myIdx) slot = this._elements.ddzMyCountdown;
    else if (cur === (myIdx + 1) % 3) slot = this._elements.ddzOppLeftCountdown;
    else if (cur === (myIdx + 2) % 3) slot = this._elements.ddzOppRightCountdown;
    if (slot) { slot.classList.add('active'); this._elements.ddzCountdown = slot; }
    else this._elements.ddzCountdown = null;
  },

  // ── 信息栏 ──
  _renderInfo(pub, myIdx) {
    const el = this._elements.ddzInfo;
    const landlord = pub.landlordIndex >= 0
      ? (pub.players?.[pub.landlordIndex]?.name || `玩家${pub.landlordIndex + 1}`)
      : '待定';
    const role = pub.landlordIndex >= 0
      ? (myIdx === pub.landlordIndex ? '🃏 地主' : '🌾 农民')
      : '';
    el.innerHTML = `<span>底分: ${pub.baseScore}</span>　<span>倍数: ×${pub.multiplier}</span>　<span>地主: ${landlord}</span>${role ? '　<span>' + role + '</span>' : ''}`;
  },

  // ── 对手 ──
  _renderOpponents(pub, myIdx) {
    const opps = this._getOpponents(pub, myIdx);
    const slots = [
      { avatar: this._elements.ddzOppLeftAvatar, name: this._elements.ddzOppLeftName, count: this._elements.ddzOppLeftCount, cards: this._elements.ddzOppLeftCards },
      { avatar: this._elements.ddzOppRightAvatar, name: this._elements.ddzOppRightName, count: this._elements.ddzOppRightCount, cards: this._elements.ddzOppRightCards },
    ];
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i], o = opps[i];
      if (!o) continue;
      const isLandlord = pub.landlordIndex >= 0 && o.index === pub.landlordIndex;
      s.avatar.textContent = this._avatarText(o.name);
      s.avatar.classList.toggle('ddz-landlord', isLandlord);
      s.name.textContent = o.name;
      s.count.textContent = `剩 ${o.count} 张`;
      this._renderOppCards(s.cards, o.count);
    }
  },

  _avatarText(name) {
    if (!name) return '👤';
    const ch = name.trim()[0];
    return ch ? ch.toUpperCase() : '👤';
  },

  _getOpponents(pub, myIdx) {
    if (myIdx < 0 || !pub.players) return [];
    const result = [];
    for (let offset = 1; offset <= 2; offset++) {
      const idx = (myIdx + offset) % 3;
      const p = pub.players[idx];
      result.push({
        name: p?.name || `玩家${idx + 1}`,
        index: idx,
        count: pub.handsCount?.[idx] ?? 17,
      });
    }
    return result;
  },

  _renderOppCards(container, count) {
    container.innerHTML = '';
    const show = Math.min(count, 10);
    for (let i = 0; i < show; i++) {
      const card = document.createElement('div');
      card.className = 'ddz-card-back';
      container.appendChild(card);
    }
  },

  // ── 底牌 ──
  _renderDizhuCards(pub) {
    const el = this._elements.ddzDizhuCards;
    // 地主确定后：翻开全员可见
    if (pub.dizhuRevealed && pub.dizhuCards) {
      el.innerHTML = '<div class="ddz-dizhu-label">底牌</div>';
      const row = document.createElement('div');
      row.className = 'ddz-dizhu-row';
      for (const c of pub.dizhuCards) {
        row.appendChild(this._createCardEl(c, false));
      }
      el.appendChild(row);
      return;
    }
    // 发牌/叫地主阶段：3 张倒扣底牌
    if (pub.phase === 'dealing' || pub.phase === 'bidding') {
      el.innerHTML = '<div class="ddz-dizhu-label">底牌</div>';
      const row = document.createElement('div');
      row.className = 'ddz-dizhu-row';
      for (let i = 0; i < 3; i++) {
        const back = document.createElement('div');
        back.className = 'ddz-card-back ddz-dizhu-back';
        row.appendChild(back);
      }
      el.appendChild(row);
      return;
    }
    el.innerHTML = '';
  },

  // ── 出牌区域 ──
  _renderPlayArea(pub, myIdx) {
    const el = this._elements.ddzPlayArea;
    const infoEl = this._elements.ddzPlayInfo;
    el.innerHTML = '';

    infoEl.classList.remove('ddz-bomb-effect');
    if (pub.phase === 'bidding') {
      infoEl.textContent = '';
      this._renderBidArea(pub, myIdx);
      return;
    }

    // 显示最近一手
    if (pub.lastPlay) {
      const pName = pub.players?.[pub.lastPlay.playerIndex]?.name || `玩家${pub.lastPlay.playerIndex + 1}`;
      const isMe = pub.lastPlay.playerIndex === myIdx;
      const label = document.createElement('div');
      label.className = 'ddz-play-label';
      label.textContent = isMe ? '你出的' : `${pName} 出的`;
      el.appendChild(label);

      const row = document.createElement('div');
      row.className = 'ddz-play-cards';
      for (const c of pub.lastPlay.cards) {
        row.appendChild(this._createCardEl(c, false));
      }
      el.appendChild(row);

      infoEl.textContent = this._typeName(pub.lastPlay.type);
      if (pub.lastPlay.type === 'bomb' || pub.lastPlay.type === 'rocket') {
        infoEl.classList.add('ddz-bomb-effect');
      } else {
        infoEl.classList.remove('ddz-bomb-effect');
      }
    } else if (pub.passCount > 0) {
      infoEl.textContent = '—';
    } else {
      infoEl.textContent = '';
    }

    // 叫地主区域
    this._renderBidArea(pub, myIdx);
  },

  _renderBidArea(pub, myIdx) {
    const el = this._elements.ddzBidArea;
    this._elements.ddzCountdown = null;

    // 发牌阶段：显示提示
    if (pub.phase === 'dealing') {
      el.classList.remove('hidden');
      el.innerHTML = '<div class="ddz-bid-phase">发牌中…</div>';
      return;
    }
    if (pub.phase !== 'bidding') {
      el.classList.add('hidden');
      el.innerHTML = '';
      return;
    }
    el.classList.remove('hidden');
    el.innerHTML = '';

    // 阶段标题（含当前决策者）
    const curName = pub.players?.[pub.bidCurrent]?.name || `玩家${(pub.bidCurrent ?? 0) + 1}`;
    const phaseLabel = document.createElement('div');
    phaseLabel.className = 'ddz-bid-phase';
    phaseLabel.textContent = (pub.bidPhase === 'grab' ? '抢地主' : '叫地主') + ' · ' + curName;
    el.appendChild(phaseLabel);

    // 叫/抢地主历史
    const ACTION_TEXT = { call: '叫地主', pass: '不叫', grab: '抢地主', giveup: '不抢' };
    if (pub.bidHistory && pub.bidHistory.length > 0) {
      const hist = document.createElement('div');
      hist.className = 'ddz-bid-history';
      for (const h of pub.bidHistory) {
        const name = pub.players?.[h.index]?.name || `玩家${h.index + 1}`;
        const act = h.action || (h.bid ? 'call' : 'pass'); // 兼容旧布尔格式
        const span = document.createElement('span');
        span.textContent = `${name}: ${ACTION_TEXT[act] || act}`;
        span.className = (act === 'call' || act === 'grab') ? 'ddz-bid-yes' : 'ddz-bid-no';
        hist.appendChild(span);
      }
      el.appendChild(hist);
    }
  },

  // ── 手牌 ──
  _renderHand(priv, isDealing = false) {
    const el = this._elements.ddzHand;
    if (!priv || !priv.hand) { el.innerHTML = ''; return; }

    el.innerHTML = '';
    // 手牌已按 rank 升序，左→右即小→大；发牌时逐张出现
    for (let i = 0; i < priv.hand.length; i++) {
      const c = priv.hand[i];
      const key = this._cardKey(c);
      const cardEl = this._createCardEl(c, true);
      if (isDealing) {
        cardEl.classList.add('ddz-card-dealing');
        cardEl.style.animationDelay = (i * 0.2) + 's';
      }
      if (this._selected.has(key)) cardEl.classList.add('ddz-card-selected');
      cardEl.addEventListener('click', () => this._toggleSelect(key, cardEl));
      el.appendChild(cardEl);
    }
  },

  // ── 叫/抢倒计时 ──
  _startCountdown(deadline) {
    this._stopCountdown();
    const el = this._elements.ddzCountdown;
    if (!el || !deadline) return;
    const tick = () => {
      const rem = Math.max(0, deadline - Date.now());
      el.textContent = Math.ceil(rem / 1000) + 's';
      if (rem <= 0) this._stopCountdown();
    };
    tick();
    this._countdownInterval = setInterval(tick, 200);
  },

  _stopCountdown() {
    if (this._countdownInterval) {
      clearInterval(this._countdownInterval);
      this._countdownInterval = null;
    }
    const el = this._elements.ddzCountdown;
    if (el) el.textContent = '';
  },

  // ── 操作按钮 ──
  _renderActions(pub, myIdx) {
    const el = this._elements.ddzActions;
    el.innerHTML = '';

    if (pub.phase === 'bidding' && pub.bidCurrent === myIdx && pub.turnIndex === myIdx) {
      if (pub.bidPhase === 'grab') {
        // 抢地主阶段
        const canGrab = !(pub.bidGrabbed && pub.bidGrabbed[myIdx]);
        if (canGrab) {
          const btnGrab = document.createElement('button');
          btnGrab.className = 'ddz-btn-bid';
          btnGrab.textContent = '抢地主';
          btnGrab.addEventListener('click', () => this._ctx.client.action({ grab: true }));
          el.appendChild(btnGrab);
        }
        const btnNo = document.createElement('button');
        btnNo.className = 'ddz-btn-nobid';
        btnNo.textContent = '不抢';
        btnNo.addEventListener('click', () => this._ctx.client.action({ grab: false }));
        el.appendChild(btnNo);
      } else {
        // 叫地主阶段
        const btnBid = document.createElement('button');
        btnBid.className = 'ddz-btn-bid';
        btnBid.textContent = '叫地主';
        btnBid.addEventListener('click', () => this._ctx.client.action({ bid: true }));
        const btnPass = document.createElement('button');
        btnPass.className = 'ddz-btn-nobid';
        btnPass.textContent = '不叫';
        btnPass.addEventListener('click', () => this._ctx.client.action({ bid: false }));
        el.appendChild(btnBid);
        el.appendChild(btnPass);
      }
      return;
    }

    if (pub.phase === 'play' && pub.turnIndex === myIdx) {
      const canPass = pub.lastPlay !== null && pub.lastPlayPlayer !== myIdx;

      const btnPlay = document.createElement('button');
      btnPlay.className = 'ddz-btn-play';
      btnPlay.textContent = '出牌';
      btnPlay.addEventListener('click', () => this._doPlay());

      el.appendChild(btnPlay);

      if (canPass) {
        const btnPass = document.createElement('button');
        btnPass.className = 'ddz-btn-pass';
        btnPass.textContent = '不出';
        btnPass.addEventListener('click', () => this._ctx.client.action({ pass: true }));
        el.appendChild(btnPass);
      }

      const btnHint = document.createElement('button');
      btnHint.textContent = '提示';
      btnHint.className = 'ddz-btn-hint';
      btnHint.addEventListener('click', () => this._showHint());
      el.appendChild(btnHint);
    }
  },

  // ── 提示：用服务端给出的 hint 选牌；无牌可出时自动不出 ──
  _showHint() {
    const priv = this._private;
    const pub = this._state;
    if (!priv || !priv.hand || !pub) return;
    if (pub.phase !== 'play' || pub.turnIndex !== priv.yourIndex) return;

    // 自由出牌：提示最小单张
    if (!pub.lastPlay || pub.lastPlayPlayer === priv.yourIndex) {
      this._selected.clear();
      if (priv.hand.length > 0) this._selected.add(this._cardKey(priv.hand[0]));
      this._renderHand(priv);
      this._renderActions(pub, priv.yourIndex);
      return;
    }

    // 接上家牌：用服务端 hint
    if (priv.hint && priv.hint.length > 0) {
      this._selected.clear();
      for (const c of priv.hint) this._selected.add(this._cardKey(c));
      this._renderHand(priv);
      this._renderActions(pub, priv.yourIndex);
    } else {
      // 无牌可出 → 自动不出
      this._ctx.client.action({ pass: true });
    }
  },

  // ── 出牌 ──
  _doPlay() {
    if (this._selected.size === 0) return;
    const priv = this._private;
    if (!priv || !priv.hand) return;
    const cards = priv.hand.filter(c => this._selected.has(this._cardKey(c)));
    this._ctx.client.action({ cards });
    this._selected.clear();
  },

  // ── 选牌切换 ──
  _toggleSelect(key, el) {
    if (this._selected.has(key)) {
      this._selected.delete(key);
      el.classList.remove('ddz-card-selected');
    } else {
      this._selected.add(key);
      el.classList.add('ddz-card-selected');
    }
  },

  // ── 游戏结果 ──
  _showResult(result) {
    if (!result) return;
    const myIdx = this._private?.yourIndex ?? -1;
    const isWinner = result.winnerIds?.includes(this._ctx.playerId);
    const isLandlord = myIdx === result.landlordIndex;

    let text = '';
    if (result.reason === 'forfeit') {
      text = isWinner ? '🎉 对方认输，你赢了！' : '😢 你已认输';
    } else {
      const role = isLandlord ? '地主' : '农民';
      text = isWinner ? `🎉 ${role}获胜！你赢了！` : `😢 ${role}获胜，你输了`;
    }

    const scoreText = result.scores
      ? result.scores.map((s, i) => {
        const name = this._state?.players?.[i]?.name || `玩家${i + 1}`;
        const delta = i === result.landlordIndex
          ? (result.isLandlordWin ? `+${result.delta * 2}` : `-${result.delta * 2}`)
          : (result.isLandlordWin ? `-${result.delta}` : `+${result.delta}`);
        return `${name}: ${s} (${delta})`;
      }).join('　')
      : '';

    const infoEl = this._elements.ddzInfo;
    infoEl.innerHTML = `<span class="ddz-result">${text}</span>${scoreText ? '<br><span class="ddz-scores">' + scoreText + '</span>' : ''}`;
  },

  // ── 工具 ──
  _cardKey(c) {
    return `${c.rank}_${c.suit}`;
  },

  _typeName(type) {
    const names = {
      single: '单张', pair: '对子', triple: '三条',
      triple_one: '三带一', triple_pair: '三带一对',
      straight: '顺子', straight_pair: '连对', plane: '飞机',
      plane_single: '飞机带单', plane_pair: '飞机带对',
      four_two: '四带二', four_two_pair: '四带两对',
      bomb: '💣 炸弹', rocket: '🚀 火箭',
    };
    return names[type] || type;
  },

  _createCardEl(c, clickable) {
    const el = document.createElement('div');
    el.className = 'ddz-card' + (clickable ? ' ddz-card-clickable' : '');

    const isJoker = c.rank >= 16;
    if (isJoker) {
      el.classList.add(c.rank === 17 ? 'ddz-card-bigjoker' : 'ddz-card-smalljoker');
      const col = JOKER_COLOR[c.rank];
      const label = c.rank === 17 ? '大王' : '小王';
      const corner = c.rank === 17 ? '大' : '小';
      el.innerHTML = `
        <div class="ddz-card-corner" style="color:${col}">
          <span class="ddz-card-rank">JOKER</span>
          <span class="ddz-card-suit">${corner}</span>
        </div>
        <div class="ddz-card-center" style="color:${col}">${label}</div>
      `;
    } else {
      const color = SUIT_COLOR[c.suit] || '#1a1a2e';
      const sym = SUIT_SYMBOL[c.suit] || '';
      const rank = RANK_TEXT[c.rank] || c.rank;
      el.innerHTML = `
        <div class="ddz-card-corner" style="color:${color}">
          <span class="ddz-card-rank">${rank}</span>
          <span class="ddz-card-suit">${sym}</span>
        </div>
        <div class="ddz-card-center" style="color:${color}">${sym}</div>
      `;
    }
    return el;
  },
};
