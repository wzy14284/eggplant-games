// 游戏注册表 —— 扩展点。
// 新增游戏只需：写一个继承 BaseGame 的类 -> 在 app.js 里 registerGame(YourGame)
// 前端列表自动从 listGames() 暴露，无需改动框架代码。

import Gomoku from './games/gomoku.js';
import Weiqi from './games/weiqi.js';
import Xiangqi from './games/xiangqi.js';

const registry = new Map(); // id -> GameClass

export function registerGame(GameClass) {
  const meta = GameClass.metadata;
  if (!meta || !meta.id) throw new Error(`游戏缺少 metadata.id: ${GameClass.name}`);
  if (registry.has(meta.id)) throw new Error(`游戏 id 重复: ${meta.id}`);
  registry.set(meta.id, GameClass);
}

export function getGame(id) {
  return registry.get(id);
}

export function listGames() {
  return [...registry.values()].map((g) => ({ ...g.metadata }));
}

// 预注册内置游戏。未来在 app.js 也可再追加。
export function registerBuiltins() {
  registerGame(Gomoku);
  registerGame(Weiqi);
  registerGame(Xiangqi);
}
