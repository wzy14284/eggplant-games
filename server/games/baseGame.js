// BaseGame —— 所有游戏的契约基类。
// 设计目标：同时兼容「完全信息游戏」（五子棋，所有人看到相同棋盘）
// 和「非完全信息游戏」（斗地主，各自手牌隐藏）。
//
// 子类必须覆盖带 * 的方法。metadata 为静态属性。
//
// 生命周期：
//   new Game(players, options)
//   -> getPublicState() / getPrivateState(playerId)   广播初始状态
//   -> applyAction(playerId, action) 循环            每次后重新广播状态
//   -> isOver() == true  -> getResult()

export class BaseGame {
  /**
   * @static
   * @returns {{ id: string, name: string, minPlayers: number, maxPlayers: number }}
   */
  static metadata = {
    id: 'base',
    name: 'Base Game',
    minPlayers: 2,
    maxPlayers: 2,
  };

  /**
   * @param {Array<{id:string,name:string,index:number}>} players  参与玩家，index 为座位号
   * @param {object} [options]  可选规则参数（如棋盘大小、可选房间密码等）
   */
  constructor(players, options = {}) {
    this.players = players; // [{id, name, index}]
    this.options = options;
    this.phase = 'play'; // 'play' | 'over'（部分游戏如围棋另有 'scoring'）
    this.over = false;
    this.result = null;
  }

  /** 强制结束并设定结果（认输/和棋/弃权通用入口） */
  forceOver(result) {
    this.over = true;
    this.phase = 'over';
    this.result = result;
  }

  /** 弃权/认输：playerId 判负，对手获胜 */
  forfeit(playerId) {
    const opp = this.players.find((p) => p.id !== playerId);
    this.forceOver({ winnerId: opp ? opp.id : null, reason: 'forfeit' });
  }

  /** 和棋 */
  draw() {
    this.forceOver({ draw: true, reason: 'draw' });
  }

  /**
   * 悔棋：回退最后一手，轮次回到该手作者。
   * 子类按需实现；默认不支持。
   * @returns {{ ok: boolean, error?: string }}
   */
  undo() {
    return { ok: false, error: '当前不支持悔棋' };
  }

  /** 所有人可见的状态。子类实现。 */
  getPublicState() {
    throw new Error('getPublicState 未实现');
  }

  /**
   * 仅该 playerId 可见的状态。
   * 完全信息游戏可直接 return this.getPublicState()；
   * 非完全信息游戏返回该玩家私有视角（如自己的手牌）。
   */
  getPrivateState(_playerId) {
    return this.getPublicState();
  }

  /**
   * 执行玩家动作。必须校验：是否轮到该玩家、动作是否合法。
   * @returns {{ ok: boolean, error?: string }}
   */
  applyAction(_playerId, _action) {
    throw new Error('applyAction 未实现');
  }

  /** 当前轮到的玩家 id；非回合制游戏可固定返回 null。 */
  getCurrentPlayerId() {
    return null;
  }

  isOver() {
    return false;
  }

  /** 返回 { winnerId?: string, draw?: boolean, reason?: string, detail?: any } */
  getResult() {
    return this.result || {};
  }
}
