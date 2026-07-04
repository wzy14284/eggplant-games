// 斗地主（欢乐斗地主）—— BaseGame 契约实现。
// 3 人，54 张牌，叫地主 → 出牌 → 结算。
// 规则：三带一对、四带二、四带两对；炸弹/火箭可压一切。

import { BaseGame } from './baseGame.js';

// ── 牌面常量 ──
const RANK_3 = 3, RANK_2 = 15, SMALL_JOKER = 16, BIG_JOKER = 17;
const SUIT_SPADE = 0, SUIT_HEART = 1, SUIT_DIAMOND = 2, SUIT_CLUB = 3;
const SUIT_NAMES = ['♠', '♥', '♦', '♣'];
const RANK_DISPLAY = { 3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'J',12:'Q',13:'K',14:'A',15:'2',16:'小王',17:'大王' };

// ── 时序常量 ──
const DEAL_LOOK_MS = 5400;  // 发牌动画 17×0.2s ≈ 3.4s + 看牌 2s
const BID_CALL_MS = 5000;   // 叫地主倒计时
const BID_GRAB_MS = 3000;   // 抢地主倒计时
const PLAY_MS = 30000;      // 出牌倒计时
const NO_PLAY_MS = 3000;    // 无牌可出时倒计时

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

/**
 * 找一手能压过 last 的牌（用于「提示」与「无牌可出」判定）。
 * 优先同类型更大；找不到则尝试炸弹/火箭。返回牌数组或 null。
 */
function findHint(hand, last) {
  if (!last || hand.length === 0) return null;
  const counts = rankCounts(hand);
  const ranksSorted = [...counts.keys()].sort((a, b) => a - b);
  const cardOf = r => hand.find(c => c.rank === r);
  const cardsOf = (r, n) => hand.filter(c => c.rank === r).slice(0, n);

  // 火箭压一切，无解
  if (last.type === TYPE.ROCKET) return null;

  const hasRocket = counts.has(SMALL_JOKER) && counts.has(BIG_JOKER);
  const rocket = () => [cardOf(SMALL_JOKER), cardOf(BIG_JOKER)];

  // 炸弹：压更小炸弹
  if (last.type === TYPE.BOMB) {
    for (const r of ranksSorted) {
      if (counts.get(r) === 4 && r > last.rank) return cardsOf(r, 4);
    }
    return hasRocket ? rocket() : null;
  }

  // 非炸弹：先试同类型更大
  const same = findSameTypeBeat(hand, counts, ranksSorted, cardOf, cardsOf, last);
  if (same) return same;

  // 再试炸弹（压非炸弹）/ 火箭
  for (const r of ranksSorted) {
    if (counts.get(r) === 4) return cardsOf(r, 4);
  }
  return hasRocket ? rocket() : null;
}

/** 同类型压牌：返回一手同类型且更大的牌，或 null。 */
function findSameTypeBeat(hand, counts, ranksSorted, cardOf, cardsOf, last) {
  switch (last.type) {
    case TYPE.SINGLE:
      for (const r of ranksSorted) if (r > last.rank) return [cardOf(r)];
      return null;
    case TYPE.PAIR:
      for (const r of ranksSorted) if (counts.get(r) >= 2 && r > last.rank) return cardsOf(r, 2);
      return null;
    case TYPE.TRIPLE:
      for (const r of ranksSorted) if (counts.get(r) >= 3 && r > last.rank) return cardsOf(r, 3);
      return null;
    case TYPE.TRIPLE_ONE: {
      for (const r of ranksSorted) {
        if (counts.get(r) >= 3 && r > last.rank) {
          const kicker = hand.find(c => c.rank !== r);
          if (kicker) return [...cardsOf(r, 3), kicker];
        }
      }
      return null;
    }
    case TYPE.TRIPLE_PAIR: {
      for (const r of ranksSorted) {
        if (counts.get(r) >= 3 && r > last.rank) {
          for (const r2 of ranksSorted) {
            if (r2 !== r && counts.get(r2) >= 2) return [...cardsOf(r, 3), ...cardsOf(r2, 2)];
          }
        }
      }
      return null;
    }
    case TYPE.STRAIGHT: {
      const L = last.length;
      for (let s = Math.max(RANK_3, last.rank - L + 2); s + L - 1 <= 14; s++) {
        if ([...Array(L).keys()].every(k => counts.has(s + k))) {
          return [...Array(L).keys()].map(k => cardOf(s + k));
        }
      }
      return null;
    }
    case TYPE.STRAIGHT_PAIR: {
      const L = last.length;
      for (let s = Math.max(RANK_3, last.rank - L + 2); s + L - 1 <= 14; s++) {
        if ([...Array(L).keys()].every(k => (counts.get(s + k) || 0) >= 2)) {
          const out = [];
          for (let k = 0; k < L; k++) out.push(...cardsOf(s + k, 2));
          return out;
        }
      }
      return null;
    }
    case TYPE.PLANE: {
      const L = last.length;
      for (let s = Math.max(RANK_3, last.rank - L + 2); s + L - 1 <= 14; s++) {
        if ([...Array(L).keys()].every(k => (counts.get(s + k) || 0) >= 3)) {
          const out = [];
          for (let k = 0; k < L; k++) out.push(...cardsOf(s + k, 3));
          return out;
        }
      }
      return null;
    }
    case TYPE.PLANE_SINGLE: {
      const L = last.length;
      for (let s = Math.max(RANK_3, last.rank - L + 2); s + L - 1 <= 14; s++) {
        const planeRanks = [...Array(L).keys()].map(k => s + k);
        if (!planeRanks.every(r => (counts.get(r) || 0) >= 3)) continue;
        // 找 L 张单张翅膀（非飞机 rank）
        const kickers = [];
        for (const r of ranksSorted) {
          if (planeRanks.includes(r)) continue;
          kickers.push(cardOf(r));
          if (kickers.length >= L) break;
        }
        if (kickers.length >= L) {
          const out = [];
          for (const r of planeRanks) out.push(...cardsOf(r, 3));
          out.push(...kickers.slice(0, L));
          return out;
        }
      }
      return null;
    }
    case TYPE.PLANE_PAIR: {
      const L = last.length;
      for (let s = Math.max(RANK_3, last.rank - L + 2); s + L - 1 <= 14; s++) {
        const planeRanks = [...Array(L).keys()].map(k => s + k);
        if (!planeRanks.every(r => (counts.get(r) || 0) >= 3)) continue;
        const pairRanks = [];
        for (const r of ranksSorted) {
          if (planeRanks.includes(r)) continue;
          if (counts.get(r) >= 2) { pairRanks.push(r); if (pairRanks.length >= L) break; }
        }
        if (pairRanks.length >= L) {
          const out = [];
          for (const r of planeRanks) out.push(...cardsOf(r, 3));
          for (const r of pairRanks.slice(0, L)) out.push(...cardsOf(r, 2));
          return out;
        }
      }
      return null;
    }
    case TYPE.FOUR_TWO: {
      for (const r of ranksSorted) {
        if (counts.get(r) === 4 && r > last.rank) {
          const kickers = [];
          for (const r2 of ranksSorted) {
            if (r2 === r) continue;
            kickers.push(cardOf(r2));
            if (kickers.length >= 2) break;
          }
          if (kickers.length >= 2) return [...cardsOf(r, 4), ...kickers.slice(0, 2)];
        }
      }
      return null;
    }
    case TYPE.FOUR_TWO_PAIR: {
      for (const r of ranksSorted) {
        if (counts.get(r) === 4 && r > last.rank) {
          const pairRanks = [];
          for (const r2 of ranksSorted) {
            if (r2 === r) continue;
            if (counts.get(r2) >= 2) { pairRanks.push(r2); if (pairRanks.length >= 2) break; }
          }
          if (pairRanks.length >= 2) {
            const out = cardsOf(r, 4);
            for (const r2 of pairRanks.slice(0, 2)) out.push(...cardsOf(r2, 2));
            return out;
          }
        }
      }
      return null;
    }
    default:
      return null;
  }
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

    // 叫地主 / 抢地主
    this.bidStarter = Math.floor(Math.random() * 3); // 随机首发
    this.bidCurrent = this.bidStarter;
    this.bidHistory = [];          // { index, action: 'call'|'pass'|'grab'|'giveup' }
    this.bidPhase = 'call';        // 'call'（叫地主）| 'grab'（抢地主）
    this.lastGrabber = -1;         // 最后一个叫/抢的人（地主候选人）
    this.grabbedSet = new Set();   // 已抢过地主的玩家（每人最多抢一次）
    this.grabCount = 0;            // 抢地主次数（每次 ×2）
    this.redealCount = 0;          // 流局重发次数
    this.landlordIndex = -1;

    // 出牌
    this.currentTurn = -1;
    this.lastPlay = null;       // { cards, playerIndex, type }
    this.lastPlayPlayer = -1;
    this.passCount = 0;
    this.bombCount = 0;

    // 积分
    this.scores = [0, 0, 0];

    // 时序：发牌 → 看牌 → 叫地主
    this._dealTimer = null;
    this._bidTimer = null;
    this.bidDeadline = null;   // 当前叫/抢回合截止时刻（ms epoch），null=无倒计时
    this._playTimer = null;
    this.playDeadline = null;  // 当前出牌回合截止时刻（ms epoch），null=无倒计时

    this.phase = 'dealing';
    this.over = false;
    this.result = null;
  }

  /** 宿主实例化并广播首帧后调用：延时 DEAL_LOOK_MS 后进入叫地主 */
  start() {
    this._dealTimer = this._schedule(() => {
      this._dealTimer = null;
      if (this.over) return;
      this.phase = 'bidding';
      this._setBidTimer();
      this._notify();
    }, DEAL_LOOK_MS);
  }

  supportsUndoDraw() { return false; }

  getCurrentPlayerId() {
    if (this.over || this.phase === 'dealing') return null;
    const idx = this.phase === 'bidding' ? this.bidCurrent : this.currentTurn;
    if (idx < 0) return null;
    const p = this.players.find(p => p.index === idx);
    return p ? p.id : null;
  }

  applyAction(playerId, action) {
    if (this.over) return { ok: false, error: '游戏已结束' };
    const p = this.players.find(p => p.id === playerId);
    if (!p) return { ok: false, error: '玩家不存在' };

    if (this.phase === 'dealing') return { ok: false, error: '发牌中，请稍候' };
    if (this.phase === 'bidding') return this._doBid(p, action);
    if (this.phase === 'play') return this._doPlay(p, action);
    return { ok: false, error: '当前阶段不能操作' };
  }

  _doBid(player, action) {
    if (player.index !== this.bidCurrent) return { ok: false, error: '还没轮到你' };

    // ── 叫地主阶段 ──
    if (this.bidPhase === 'call') {
      const { bid } = action;
      if (typeof bid !== 'boolean') return { ok: false, error: '请选"叫地主"或"不叫"' };
      this._clearBidTimer();
      this.bidHistory.push({ index: player.index, action: bid ? 'call' : 'pass' });

      if (bid) {
        // 有人叫地主 → 进入抢地主阶段，由其下家开始抢
        this.lastGrabber = player.index;
        this.bidPhase = 'grab';
        this.grabbedSet = new Set();
        this.bidCurrent = (player.index + 1) % 3;
        this._bidAutoAdvance();
      } else {
        // 不叫 → 下一个
        this.bidCurrent = (player.index + 1) % 3;
        // 三人都不叫 → 流局重发
        const passes = this.bidHistory.filter(h => h.action === 'pass').length;
        if (passes >= 3) this._redeal();
      }
      this._setBidTimer();
      return { ok: true };
    }

    // ── 抢地主阶段 ──
    const { grab } = action;
    if (typeof grab !== 'boolean') return { ok: false, error: '请选"抢地主"或"不抢"' };
    if (grab && this.grabbedSet.has(player.index)) {
      return { ok: false, error: '你已经抢过地主了' };
    }
    this._clearBidTimer();

    if (grab) {
      this.bidHistory.push({ index: player.index, action: 'grab' });
      this.grabbedSet.add(player.index);
      this.grabCount++;
      this.lastGrabber = player.index;
    } else {
      this.bidHistory.push({ index: player.index, action: 'giveup' });
    }

    this.bidCurrent = (player.index + 1) % 3;
    this._bidAutoAdvance();
    this._setBidTimer();
    return { ok: true };
  }

  // 倒计时回调：超时自动「不叫」/「不抢」
  _applyAutoBid() {
    if (this.over || this.phase !== 'bidding') return;
    const p = this.players.find(pp => pp.index === this.bidCurrent);
    if (!p) return;
    const action = this.bidPhase === 'call' ? { bid: false } : { grab: false };
    this._doBid(p, action);   // 内部清旧定时器并为下一轮设置新定时器
    this._notify();
  }

  // 为当前叫/抢回合设置倒计时（phase 非 bidding 则清空）
  _setBidTimer() {
    this._clearBidTimer();
    if (this.over || this.phase !== 'bidding') return;
    const ms = this.bidPhase === 'call' ? BID_CALL_MS : BID_GRAB_MS;
    this.bidDeadline = Date.now() + ms;
    this._bidTimer = this._schedule(() => this._applyAutoBid(), ms);
  }

  _clearBidTimer() {
    if (this._bidTimer) {
      this._clearTimer(this._bidTimer);
      this._bidTimer = null;
    }
    this.bidDeadline = null;
  }

  // 为当前出牌回合设置倒计时；接上家牌且无牌可出时用 3s，否则 30s
  _setPlayTimer() {
    this._clearPlayTimer();
    if (this.over || this.phase !== 'play') return;
    let ms = PLAY_MS;
    if (this.lastPlay !== null && this.lastPlayPlayer !== this.currentTurn) {
      const lastInfo = identifyType(this.lastPlay.cards);
      if (lastInfo && !findHint(this.hands[this.currentTurn], lastInfo)) ms = NO_PLAY_MS;
    }
    this.playDeadline = Date.now() + ms;
    this._playTimer = this._schedule(() => this._applyAutoPlay(), ms);
  }

  _clearPlayTimer() {
    if (this._playTimer) {
      this._clearTimer(this._playTimer);
      this._playTimer = null;
    }
    this.playDeadline = null;
  }

  // 出牌超时：接上家牌→自动不出；自由出牌→自动出最小一张
  _applyAutoPlay() {
    if (this.over || this.phase !== 'play') return;
    const p = this.players.find(pp => pp.index === this.currentTurn);
    if (!p) return;
    if (this.lastPlay === null || this.lastPlayPlayer === this.currentTurn) {
      // 自由出牌：出最小一张单牌
      const hand = this.hands[this.currentTurn];
      if (hand.length === 0) return;
      this._doPlay(p, { cards: [hand[0]] });
    } else {
      // 接上家牌：不出
      this._doPlay(p, { pass: true });
    }
    this._notify();
  }

  // 已抢过地主的玩家轮到时自动「不抢」，直到轮到可决策者或回到 lastGrabber
  _bidAutoAdvance() {
    while (this.bidPhase === 'grab'
           && this.bidCurrent !== this.lastGrabber
           && this.grabbedSet.has(this.bidCurrent)) {
      this.bidHistory.push({ index: this.bidCurrent, action: 'giveup' });
      this.bidCurrent = (this.bidCurrent + 1) % 3;
    }
    // 回到最后一个叫/抢的人 → 抢地主结束
    if (this.bidPhase === 'grab' && this.bidCurrent === this.lastGrabber) {
      this._resolveBid();
    }
  }

  // 流局：重新发牌并重新开始叫地主
  _redeal() {
    this.redealCount++;
    if (this.redealCount > 5) {
      // 极端兜底：重发太多次仍无人叫，强制首发当地主
      this.lastGrabber = this.bidStarter;
      this._resolveBid();
      return;
    }
    const deck = shuffle(makeDeck());
    this.hands = [[], [], []];
    for (let i = 0; i < 51; i++) this.hands[i % 3].push(deck[i]);
    this.dizhuCards = [deck[51], deck[52], deck[53]];
    for (let i = 0; i < 3; i++) this.hands[i] = sortCards(this.hands[i]);
    this.bidStarter = Math.floor(Math.random() * 3);
    this.bidCurrent = this.bidStarter;
    this.bidHistory = [];
    this.bidPhase = 'call';
    this.lastGrabber = -1;
    this.grabbedSet = new Set();
    this.grabCount = 0;
  }

  _resolveBid() {
    this.landlordIndex = this.lastGrabber;
    // 地主拿底牌
    this.hands[this.landlordIndex].push(...this.dizhuCards);
    this.hands[this.landlordIndex] = sortCards(this.hands[this.landlordIndex]);
    this.currentTurn = this.landlordIndex;
    this.phase = 'play';
    this._setPlayTimer();   // 地主首手 30s 倒计时
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
      this._clearPlayTimer();
      this.passCount++;
      // 连续 2 人不出 → 当前出牌者自由出
      if (this.passCount >= 2) {
        this.lastPlay = null;
        this.lastPlayPlayer = -1;
        this.passCount = 0;
      }
      this._nextTurn();
      this._setPlayTimer();
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
    this._clearPlayTimer();
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
    this._setPlayTimer();
    return { ok: true };
  }

  _nextTurn() {
    this.currentTurn = (this.currentTurn + 1) % 3;
  }

  _endGame(winnerIndex) {
    this._clearBidTimer();
    this._clearPlayTimer();
    if (this._dealTimer) { this._clearTimer(this._dealTimer); this._dealTimer = null; }
    this.over = true;
    this.phase = 'over';
    const multiplier = Math.pow(2, this.bombCount + this.grabCount);
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
      turnIndex: this.over || this.phase === 'dealing' ? -1
        : (this.phase === 'bidding' ? this.bidCurrent : this.currentTurn),
      landlordIndex: this.landlordIndex,
      // 叫地主 / 抢地主
      bidStarter: this.bidStarter,
      bidCurrent: this.bidCurrent,
      bidPhase: this.bidPhase,                 // 'call' | 'grab'
      bidDeadline: this.bidDeadline,           // 当前叫/抢回合截止时刻（ms epoch），null=无
      bidHistory: this.bidHistory,             // { index, action: 'call'|'pass'|'grab'|'giveup' }
      bidGrabbed: [0, 1, 2].map(i => this.grabbedSet.has(i)),
      lastGrabber: this.lastGrabber,
      grabCount: this.grabCount,
      // 底牌
      dizhuCards: this.landlordIndex >= 0 ? this.dizhuCards : null,
      dizhuRevealed: this.landlordIndex >= 0,
      // 出牌
      handsCount: this.hands.map(h => h.length),
      lastPlay: this.lastPlay,
      bombCount: this.bombCount,
      passCount: this.passCount,
      lastPlayPlayer: this.lastPlayPlayer,
      playDeadline: this.playDeadline,    // 出牌回合截止时刻（ms epoch），null=无
      // 积分
      scores: this.scores,
      baseScore: this.baseScore,
      multiplier: Math.pow(2, this.bombCount + this.grabCount),
      // 附加
      players: this.players.map(p => ({ name: p.name, index: p.index })),
    };
  }

  getPrivateState(playerId) {
    const p = this.players.find(p => p.id === playerId);
    const idx = p ? p.index : -1;
    // 当前轮到此人且需接上家牌时，给出一手提示（找不到=无牌可出，前端点"提示"自动不出）
    let hint = null;
    if (idx >= 0 && this.phase === 'play' && idx === this.currentTurn
        && this.lastPlay !== null && this.lastPlayPlayer !== idx) {
      const lastInfo = identifyType(this.lastPlay.cards);
      if (lastInfo) {
        const h = findHint(this.hands[idx], lastInfo);
        hint = h ? h.map(c => ({ rank: c.rank, suit: c.suit })) : null;
      }
    }
    return {
      ...this.getPublicState(),
      yourIndex: idx,
      hand: idx >= 0 ? this.hands[idx] : [],
      hint,
    };
  }

  isOver() { return this.over; }
}
