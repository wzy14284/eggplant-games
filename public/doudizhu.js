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

  mount(container, ctx) {
    this._ctx = ctx;
    this._container = container;
    this._selected = new Set();
    container.innerHTML = '';

    const root = document.createElement('div');
    root.className = 'ddz';
    root.innerHTML = `
      <div class="ddz-info" id="ddzInfo"></div>
      <div class="ddz-table">
        <div class="ddz-opponent ddz-opponent-top" id="ddzOppTop">
          <div class="ddz-opp-name" id="ddzOppTopName"></div>
          <div class="ddz-opp-cards" id="ddzOppTopCards"></div>
        </div>
        <div class="ddz-middle-row">
          <div class="ddz-opponent ddz-opponent-left" id="ddzOppLeft">
            <div class="ddz-opp-name" id="ddzOppLeftName"></div>
            <div class="ddz-opp-cards" id="ddzOppLeftCards"></div>
          </div>
          <div class="ddz-center">
            <div class="ddz-dizhu-cards" id="ddzDizhuCards"></div>
            <div class="ddz-play-area" id="ddzPlayArea"></div>
            <div class="ddz-bid-area hidden" id="ddzBidArea"></div>
          </div>
          <div class="ddz-spacer"></div>
        </div>
        <div class="ddz-play-info" id="ddzPlayInfo"></div>
        <div class="ddz-hand-area">
          <div class="ddz-hand" id="ddzHand"></div>
          <div class="ddz-actions" id="ddzActions"></div>
        </div>
      </div>
    `;
    container.appendChild(root);

    // 缓存元素引用
    const ids = ['ddzInfo','ddzOppTop','ddzOppTopName','ddzOppTopCards',
      'ddzOppLeft','ddzOppLeftName','ddzOppLeftCards',
      'ddzDizhuCards','ddzPlayArea','ddzBidArea','ddzPlayInfo','ddzHand','ddzActions'];
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
    this._state = pub;
    this._private = priv;

    const myIdx = priv?.yourIndex ?? -1;

    this._renderInfo(pub, myIdx);
    this._renderOpponents(pub, myIdx);
    this._renderDizhuCards(pub);
    this._renderPlayArea(pub, myIdx);
    this._renderHand(priv);
    this._renderActions(pub, myIdx);
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
    // 上方对手
    if (opps[0]) {
      this._elements.ddzOppTopName.textContent = opps[0].name + (opps[0].index === pub.landlordIndex ? ' 🃏' : '');
      this._renderOppCards(this._elements.ddzOppTopCards, opps[0].count);
    }
    // 左方对手
    if (opps[1]) {
      this._elements.ddzOppLeftName.textContent = opps[1].name + (opps[1].index === pub.landlordIndex ? ' 🃏' : '');
      this._renderOppCards(this._elements.ddzOppLeftCards, opps[1].count);
    }
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
    for (let i = 0; i < Math.min(count, 20); i++) {
      const card = document.createElement('div');
      card.className = 'ddz-card-back';
      container.appendChild(card);
    }
    if (count > 20) {
      const more = document.createElement('span');
      more.className = 'ddz-card-more';
      more.textContent = `+${count - 20}`;
      container.appendChild(more);
    }
  },

  // ── 底牌 ──
  _renderDizhuCards(pub) {
    const el = this._elements.ddzDizhuCards;
    if (!pub.dizhuCards || pub.landlordIndex < 0) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = '<div class="ddz-dizhu-label">底牌</div>';
    const row = document.createElement('div');
    row.className = 'ddz-dizhu-row';
    for (const c of pub.dizhuCards) {
      row.appendChild(this._createCardEl(c, false));
    }
    el.appendChild(row);
  },

  // ── 出牌区域 ──
  _renderPlayArea(pub, myIdx) {
    const el = this._elements.ddzPlayArea;
    const infoEl = this._elements.ddzPlayInfo;
    el.innerHTML = '';

    infoEl.classList.remove('ddz-bomb-effect');
    if (pub.phase === 'bidding') {
      infoEl.textContent = '';
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
    if (pub.phase !== 'bidding') {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    el.innerHTML = '';

    // 叫地主历史
    if (pub.bidHistory && pub.bidHistory.length > 0) {
      const hist = document.createElement('div');
      hist.className = 'ddz-bid-history';
      for (const h of pub.bidHistory) {
        const name = pub.players?.[h.index]?.name || `玩家${h.index + 1}`;
        const span = document.createElement('span');
        span.textContent = `${name}: ${h.bid ? '叫地主' : '不叫'}`;
        span.className = h.bid ? 'ddz-bid-yes' : 'ddz-bid-no';
        hist.appendChild(span);
      }
      el.appendChild(hist);
    }
  },

  // ── 手牌 ──
  _renderHand(priv) {
    const el = this._elements.ddzHand;
    if (!priv || !priv.hand) { el.innerHTML = ''; return; }

    el.innerHTML = '';
    for (let i = 0; i < priv.hand.length; i++) {
      const c = priv.hand[i];
      const key = this._cardKey(c);
      const cardEl = this._createCardEl(c, true);
      if (this._selected.has(key)) cardEl.classList.add('ddz-card-selected');
      cardEl.addEventListener('click', () => this._toggleSelect(key, cardEl));
      el.appendChild(cardEl);
    }
  },

  // ── 操作按钮 ──
  _renderActions(pub, myIdx) {
    const el = this._elements.ddzActions;
    el.innerHTML = '';

    if (pub.phase === 'bidding' && pub.bidCurrent === myIdx && pub.turnIndex === myIdx) {
      const btnBid = document.createElement('button');
      btnBid.className = 'primary';
      btnBid.textContent = '叫地主';
      btnBid.addEventListener('click', () => this._ctx.client.action({ bid: true }));
      const btnPass = document.createElement('button');
      btnPass.textContent = '不叫';
      btnPass.addEventListener('click', () => this._ctx.client.action({ bid: false }));
      el.appendChild(btnBid);
      el.appendChild(btnPass);
      return;
    }

    if (pub.phase === 'play' && pub.turnIndex === myIdx) {
      const canPass = pub.lastPlay !== null && pub.lastPlayPlayer !== myIdx;

      const btnPlay = document.createElement('button');
      btnPlay.className = 'primary';
      btnPlay.textContent = '出牌';
      btnPlay.addEventListener('click', () => this._doPlay());

      el.appendChild(btnPlay);

      if (canPass) {
        const btnPass = document.createElement('button');
        btnPass.textContent = '不出';
        btnPass.addEventListener('click', () => this._ctx.client.action({ pass: true }));
        el.appendChild(btnPass);
      }

      const btnHint = document.createElement('button');
      btnHint.textContent = '提示';
      btnHint.className = 'ghost';
      btnHint.addEventListener('click', () => this._showHint());
      el.appendChild(btnHint);
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

  // ── 提示（简单版：找第一个能管上的牌） ──
  _showHint() {
    const priv = this._private;
    const pub = this._state;
    if (!priv || !priv.hand || !pub) return;

    this._selected.clear();
    // 如果没有上一手，提示出最小的单牌
    if (!pub.lastPlay || pub.lastPlayPlayer === priv.yourIndex) {
      if (priv.hand.length > 0) {
        const c = priv.hand[0];
        this._selected.add(this._cardKey(c));
      }
    } else {
      // 简单提示：找第一个能管上的组合
      const hint = this._findBeat(priv.hand, pub.lastPlay);
      if (hint) {
        for (const c of hint) this._selected.add(this._cardKey(c));
      }
    }
    this._renderHand(priv);
    this._renderActions(pub, priv.yourIndex);
  },

  _findBeat(hand, lastPlay) {
    // 简化版提示：只处理单张、对子、三条、炸弹
    const lastCards = lastPlay.cards;
    const lastRank = lastCards[0]?.rank;
    if (!lastRank) return null;

    // 找能管上的单张
    if (lastCards.length === 1) {
      for (const c of hand) {
        if (c.rank > lastRank) return [c];
      }
      // 找炸弹
      return this._findBomb(hand);
    }

    // 找能管上的对子
    if (lastCards.length === 2) {
      const counts = new Map();
      for (const c of hand) counts.set(c.rank, (counts.get(c.rank) || 0) + 1);
      for (const [r, cnt] of counts) {
        if (cnt >= 2 && r > lastRank) {
          return hand.filter(c => c.rank === r).slice(0, 2);
        }
      }
      return this._findBomb(hand);
    }

    // 更复杂的牌型：直接找炸弹
    return this._findBomb(hand);
  },

  _findBomb(hand) {
    const counts = new Map();
    for (const c of hand) counts.set(c.rank, (counts.get(c.rank) || 0) + 1);
    for (const [r, cnt] of counts) {
      if (cnt === 4) return hand.filter(c => c.rank === r);
    }
    // 火箭
    const sj = hand.find(c => c.rank === 16);
    const bj = hand.find(c => c.rank === 17);
    if (sj && bj) return [sj, bj];
    return null;
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
      el.innerHTML = `<div class="ddz-card-rank" style="color:${JOKER_COLOR[c.rank]}">${JOKER_TEXT[c.rank]}</div>`;
    } else {
      const color = SUIT_COLOR[c.suit] || '#1a1a2e';
      el.innerHTML = `
        <div class="ddz-card-rank" style="color:${color}">${RANK_TEXT[c.rank] || c.rank}</div>
        <div class="ddz-card-suit" style="color:${color}">${SUIT_SYMBOL[c.suit] || ''}</div>
      `;
    }
    return el;
  },
};
