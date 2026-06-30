// 斗地主（欢乐斗地主）—— BaseGame 契约实现。
// 3 人，54 张牌，叫地主 → 出牌 → 结算。
// 规则：三带一对、四带二、四带两对；炸弹/火箭可压一切。

import { BaseGame } from './baseGame.js';

// ── 牌面常量 ──
const RANK_3 = 3, RANK_2 = 15, SMALL_JOKER = 16, BIG_JOKER = 17;
const SUIT_SPADE = 0, SUIT_HEART = 1, SUIT_DIAMOND = 2, SUIT_CLUB = 3;
const SUIT_NAMES = ['♠', '♥', '♦', '♣'];
const RANK_DISPLAY = { 3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'J',12:'Q',13:'K',14:'A',15:'2',16:'小王',17:'大王' };

// 牌型常量
const TYPE = {
  SINGLE: 'single', PAIR: 'pair', TRIPLE: 'triple',
  TRIPLE_ONE: 'triple_one', TRIPLE_PAIR: 'triple_pair',
  STRAIGHT: 'straight', STRAIGHT_PAIR: 'straight_pair', PLANE: 'plane',
  PLANE_SINGLE: 'plane_single', PLANE_PAIR: 'plane_pair',
  FOUR_TWO: 'four_two', FOUR_TWO_PAIR: 'four_two_pair',
  BOMB: 'bomb', ROCKET: 'rocket',
};

// ── 工具函数 ──
function makeDeck() {
  const deck = [];
  for (let s = 0; s < 4; s++) {
    for (let r = RANK_3; r <= RANK_2; r++) {
      deck.push({ rank: r, suit: s });
    }
  }
  deck.push({ rank: SMALL_JOKER, suit: -1 });
  deck.push({ rank: BIG_JOKER, suit: -1 });
  return deck;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function cardKey(c) { return c.rank * 4 + (c.suit >= 0 ? c.suit : 0); }

function sameCard(a, b) { return a.rank === b.rank && a.suit === b.suit; }

/** 统计每个 rank 出现次数 */
function rankCounts(cards) {
  const m = new Map();
  for (const c of cards) m.set(c.rank, (m.get(c.rank) || 0) + 1);
  return m;
}

/** 按 rank 排序 */
function sortCards(cards) {
  return [...cards].sort((a, b) => a.rank - b.rank || a.suit - b.suit);
}

/** 从手牌中按 rank 移除指定张数 */
function removeByRank(hand, rank, count) {
  const result = [];
  let removed = 0;
  for (const c of hand) {
    if (c.rank === rank && removed < count) { removed++; }
    else { result.push(c); }
  }
  return result;
}

// ── 牌型识别 ──
function identifyType(cards) {
  const n = cards.length;
  if (n === 0) return null;

  const counts = rankCounts(cards);
  const ranks = [...counts.keys()].sort((a, b) => a - b);
  const size = ranks.length;

  // 火箭
  if (n === 2 && counts.has(SMALL_JOKER) && counts.has(BIG_JOKER)) {
    return { type: TYPE.ROCKET, rank: BIG_JOKER };
  }

  // 单张
  if (n === 1) return { type: TYPE.SINGLE, rank: cards[0].rank };

  // 对子
  if (n === 2 && size === 1 && counts.get(ranks[0]) === 2) {
    return { type: TYPE.PAIR, rank: ranks[0] };
  }

  // 三条
  if (n === 3 && size === 1 && counts.get(ranks[0]) === 3) {
    return { type: TYPE.TRIPLE, rank: ranks[0] };
  }

  // 炸弹
  if (n === 4 && size === 1 && counts.get(ranks[0]) === 4) {
    return { type: TYPE.BOMB, rank: ranks[0] };
  }

  // 三带一
  if (n === 4 && size === 2) {
    for (const r of ranks) {
      if (counts.get(r) === 3) return { type: TYPE.TRIPLE_ONE, rank: r };
    }
  }

  // 三带一对
  if (n === 5 && size === 2) {
    let tripleRank = -1;
    for (const r of ranks) {
      const c = counts.get(r);
      if (c === 3) tripleRank = r;
      if (c !== 3 && c !== 2) return null;
    }
    if (tripleRank >= 0) return { type: TYPE.TRIPLE_PAIR, rank: tripleRank };
  }

  // 顺子 (≥5 张连续单牌，3-A)
  if (n >= 5 && size === n) {
    const allSingle = [...counts.values()].every(c => c === 1);
    if (allSingle && ranks[size - 1] <= 14) {
      if (ranks[size - 1] - ranks[0] === size - 1) {
        return { type: TYPE.STRAIGHT, rank: ranks[size - 1], length: size };
      }
    }
  }

  // 连对 (≥3 对连续)
  if (n >= 6 && n % 2 === 0) {
    const pairCount = n / 2;
    if (size === pairCount && [...counts.values()].every(c => c === 2)) {
      if (ranks[pairCount - 1] <= 14 && ranks[pairCount - 1] - ranks[0] === pairCount - 1) {
        return { type: TYPE.STRAIGHT_PAIR, rank: ranks[pairCount - 1], length: pairCount };
      }
    }
  }

  // 飞机 (≥2 个连续三条)
  const triples = ranks.filter(r => counts.get(r) === 3).sort((a, b) => a - b);
  if (triples.length >= 2) {
    // 找最长连续三条
    let bestStart = 0, bestLen = 1, curStart = 0, curLen = 1;
    for (let i = 1; i < triples.length; i++) {
      if (triples[i] === triples[i - 1] + 1 && triples[i] <= 14) {
        curLen++;
        if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }
      } else {
        curStart = i; curLen = 1;
      }
    }
    if (bestLen >= 2) {
      const planeRanks = triples.slice(bestStart, bestStart + bestLen);
      const planeCards = bestLen * 3;
      const kickers = n - planeCards;

      if (kickers === 0) {
        return { type: TYPE.PLANE, rank: planeRanks[planeRanks.length - 1], length: bestLen };
      }
      if (kickers === bestLen) {
        // 飞机带单
        return { type: TYPE.PLANE_SINGLE, rank: planeRanks[planeRanks.length - 1], length: bestLen };
      }
      if (kickers === bestLen * 2) {
        // 检查翅膀是否全是对子
        const remain = new Map(counts);
        for (const r of planeRanks) remain.delete(r);
        if ([...remain.values()].every(c => c === 2 || c === 4)) {
          return { type: TYPE.PLANE_PAIR, rank: planeRanks[planeRanks.length - 1], length: bestLen };
        }
      }
    }
  }

  // 四带二 (单)
  if (n === 6) {
    for (const r of ranks) {
      if (counts.get(r) === 4) {
        return { type: TYPE.FOUR_TWO, rank: r };
      }
    }
  }

  // 四带两对
  if (n === 8) {
    for (const r of ranks) {
      if (counts.get(r) === 4) {
        const remain = new Map(counts);
        remain.delete(r);
        if ([...remain.values()].every(c => c === 2)) {
          return { type: TYPE.FOUR_TWO_PAIR, rank: r };
        }
      }
    }
  }

  return null; // 不合法牌型
}

/** 判断 a 能否压过 b */
function canBeat(a, b) {
  if (!a || !b) return false;
  // 火箭最大
  if (a.type === TYPE.ROCKET) return true;
  if (b.type === TYPE.ROCKET) return false;
  // 炸弹可压非炸弹
  if (a.type === TYPE.BOMB && b.type !== TYPE.BOMB) return true;
  if (b.type === TYPE.BOMB && a.type !== TYPE.BOMB) return false;
  // 同类型比较
  if (a.type !== b.type) return false;
  if (a.length !== undefined && b.length !== undefined && a.length !== b.length) return false;
  return a.rank > b.rank;
}

// ── 主类 ──
export default class Doudizhu extends BaseGame {
  static metadata = {
    id: 'doudizhu',
    name: '斗地主',
    minPlayers: 3,
    maxPlayers: 3,
  };

  constructor(players, options = {}) {
    super(players, options);
    this.phase = 'dealing';
    this.baseScore = 2;

    // 发牌
    const deck = shuffle(makeDeck());
    this.hands = [[], [], []];
    for (let i = 0; i < 51; i++) this.hands[i % 3].push(deck[i]);
    this.dizhuCards = [deck[51], deck[52], deck[53]];
    for (let i = 0; i < 3; i++) this.hands[i] = sortCards(this.hands[i]);

    // 叫地主
    this.bidStarter = Math.floor(Math.random() * 3);
    this.bidCurrent = this.bidStarter;
    this.bidHistory = [];
    this.bidPassCount = 0;
    this.lastBidder = -1;
    this.landlordIndex = -1;

    // 出牌
    this.currentTurn = -1;
    this.lastPlay = null;       // { cards, playerIndex, type }
    this.lastPlayPlayer = -1;
    this.passCount = 0;
    this.bombCount = 0;

    // 积分
    this.scores = [0, 0, 0];

    this.phase = 'bidding';
    this.over = false;
    this.result = null;
  }

  supportsUndoDraw() { return false; }

  getCurrentPlayerId() {
    if (this.over) return null;
    const idx = this.phase === 'bidding' ? this.bidCurrent : this.currentTurn;
    if (idx < 0) return null;
    const p = this.players.find(p => p.index === idx);
    return p ? p.id : null;
  }

  applyAction(playerId, action) {
    if (this.over) return { ok: false, error: '游戏已结束' };
    const p = this.players.find(p => p.id === playerId);
    if (!p) return { ok: false, error: '玩家不存在' };

    if (this.phase === 'bidding') return this._doBid(p, action);
    if (this.phase === 'play') return this._doPlay(p, action);
    return { ok: false, error: '当前阶段不能操作' };
  }

  _doBid(player, action) {
    if (player.index !== this.bidCurrent) return { ok: false, error: '还没轮到你叫地主' };
    const { bid } = action;
    if (typeof bid !== 'boolean') return { ok: false, error: '请选"叫地主"或"不叫"' };

    this.bidHistory.push({ index: player.index, bid });
    const nextIdx = (this.bidCurrent + 1) % 3;

    if (bid) this.lastBidder = player.index;
    else this.bidPassCount++;

    // 所有 3 人各叫/抢一次
    if (this.bidHistory.length >= 3) {
      this._resolveBid();
    } else {
      this.bidCurrent = nextIdx;
    }
    return { ok: true };
  }

  _resolveBid() {
    if (this.lastBidder >= 0) {
      this.landlordIndex = this.lastBidder;
    } else {
      // 都不叫，第一个叫的人自动当地主
      this.landlordIndex = this.bidStarter;
    }
    // 地主拿底牌
    this.hands[this.landlordIndex].push(...this.dizhuCards);
    this.hands[this.landlordIndex] = sortCards(this.hands[this.landlordIndex]);
    this.currentTurn = this.landlordIndex;
    this.phase = 'play';
  }

  _doPlay(player, action) {
    if (player.index !== this.currentTurn) return { ok: false, error: '还没轮到你出牌' };

    const { cards, pass } = action;

    // 不出 (pass)
    if (pass) {
      // 自由出牌时不能 pass
      if (this.lastPlay === null || this.lastPlayPlayer === player.index) {
        return { ok: false, error: '你必须出牌' };
      }
      this.passCount++;
      // 连续 2 人不出 → 当前出牌者自由出
      if (this.passCount >= 2) {
        this.lastPlay = null;
        this.lastPlayPlayer = -1;
        this.passCount = 0;
      }
      this._nextTurn();
      return { ok: true };
    }

    // 出牌
    if (!Array.isArray(cards) || cards.length === 0) {
      return { ok: false, error: '请选择要出的牌' };
    }

    // 验证手牌中有这些牌
    const hand = this.hands[player.index];
    const handCopy = [...hand];
    for (const c of cards) {
      const idx = handCopy.findIndex(h => sameCard(h, c));
      if (idx < 0) return { ok: false, error: '你没有这些牌' };
      handCopy.splice(idx, 1);
    }

    // 识别牌型
    const playType = identifyType(cards);
    if (!playType) return { ok: false, error: '不合法的牌型' };

    // 验证能否压过上一手
    if (this.lastPlay && this.lastPlayPlayer !== player.index) {
      const lastType = identifyType(this.lastPlay.cards);
      if (!canBeat(playType, lastType)) {
        return { ok: false, error: '管不上' };
      }
    }

    // 出牌成功
    this.hands[player.index] = handCopy;
    this.lastPlay = { cards: sortCards(cards), playerIndex: player.index, type: playType.type };
    this.lastPlayPlayer = player.index;
    this.passCount = 0;

    // 记录炸弹/火箭
    if (playType.type === TYPE.BOMB || playType.type === TYPE.ROCKET) {
      this.bombCount++;
    }

    // 检查是否出完
    if (handCopy.length === 0) {
      this._endGame(player.index);
      return { ok: true };
    }

    this._nextTurn();
    return { ok: true };
  }

  _nextTurn() {
    this.currentTurn = (this.currentTurn + 1) % 3;
  }

  _endGame(winnerIndex) {
    this.over = true;
    this.phase = 'over';
    const multiplier = Math.pow(2, this.bombCount);
    const isLandlordWin = winnerIndex === this.landlordIndex;
    const delta = this.baseScore * multiplier;

    if (isLandlordWin) {
      this.scores[this.landlordIndex] += delta * 2;
      for (let i = 0; i < 3; i++) {
        if (i !== this.landlordIndex) this.scores[i] -= delta;
      }
    } else {
      this.scores[this.landlordIndex] -= delta * 2;
      for (let i = 0; i < 3; i++) {
        if (i !== this.landlordIndex) this.scores[i] += delta;
      }
    }

    const landlordId = this.players[this.landlordIndex].id;
    const winnerIds = isLandlordWin
      ? [landlordId]
      : this.players.filter((_, i) => i !== this.landlordIndex).map(p => p.id);

    this.result = {
      winnerIds,
      winnerIndex,
      landlordIndex: this.landlordIndex,
      isLandlordWin,
      scores: [...this.scores],
      delta,
      multiplier,
      bombCount: this.bombCount,
      reason: 'doudizhu',
    };
  }

  forfeit(playerId) {
    const loser = this.players.find(p => p.id === playerId);
    if (!loser) return;
    this.landlordIndex = this.landlordIndex >= 0 ? this.landlordIndex : 0;
    this._endGame(loser.index === this.landlordIndex
      ? (loser.index + 1) % 3  // 地主认输 → 农民赢
      : this.landlordIndex);    // 农民认输 → 地主赢
    this.result.reason = 'forfeit';
  }

  // ── 状态暴露 ──

  getPublicState() {
    return {
      phase: this.phase,
      turnIndex: this.over ? -1 : (this.phase === 'bidding' ? this.bidCurrent : this.currentTurn),
      landlordIndex: this.landlordIndex,
      // 叫地主
      bidStarter: this.bidStarter,
      bidCurrent: this.bidCurrent,
      bidHistory: this.bidHistory,
      // 出牌
      handsCount: this.hands.map(h => h.length),
      lastPlay: this.lastPlay,
      dizhuCards: this.landlordIndex >= 0 ? this.dizhuCards : null,
      bombCount: this.bombCount,
      passCount: this.passCount,
      lastPlayPlayer: this.lastPlayPlayer,
      // 积分
      scores: this.scores,
      baseScore: this.baseScore,
      multiplier: Math.pow(2, this.bombCount),
      // 附加
      players: this.players.map(p => ({ name: p.name, index: p.index })),
    };
  }

  getPrivateState(playerId) {
    const p = this.players.find(p => p.id === playerId);
    const idx = p ? p.index : -1;
    return {
      ...this.getPublicState(),
      yourIndex: idx,
      hand: idx >= 0 ? this.hands[idx] : [],
    };
  }

  isOver() { return this.over; }
}
