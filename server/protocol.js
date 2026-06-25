// 通信协议：客户端 ↔ 服务端消息类型常量。
// 所有消息均为 JSON：{ type: <C2S.* | S2C.*>, ...payload }

export const C2S = {
  CREATE: 'create', // { gameType, playerName, password? } -> 创建房间
  JOIN: 'join',     // { roomCode, playerName, password? } -> 加入房间
  START: 'start',   // {} 房主开始游戏
  REMATCH: 'rematch', // {} 一局结束后重置房间到等待态（保留玩家与房间码）
  ACTION: 'action', // { action: {...} } 游戏内动作，交给对应 Game 处理
  RESIGN: 'resign',   // {} 认输，立即判负
  REQ_UNDO: 'req_undo', // {} 申请悔棋（需对方同意，10s 超时自动拒绝）
  REQ_DRAW: 'req_draw', // {} 申请和棋（需对方同意，10s 超时自动拒绝）
  RESPOND: 'respond', // { accept: bool } 对待处理请求作答（仅对手有效）
  RESUME: 'resume',   // { playerId, roomCode } 断线重连，认领旧座位
  LEAVE: 'leave',   // {} 离开房间（游戏中离开视为认输）
};

export const S2C = {
  GAMES: 'games',       // { games: [{id,name,minPlayers,maxPlayers}] } 可用游戏列表
  CREATED: 'created',   // { roomCode, playerId, yourIndex }
  JOINED: 'joined',     // { playerId, yourIndex, players:[{name,index}], host }
  READY: 'ready',       // { canStart, playerCount, minPlayers } 房间状态变化
  STARTED: 'started',   // { yourIndex, publicState, privateState } 游戏开始
  STATE: 'state',       // { publicState, privateState, turnIndex } 状态更新
  OVER: 'over',         // { result, publicState, privateState } 游戏结束
  REQ: 'req',           // { reqType:'undo'|'draw', fromId, fromName } 对方发起请求（发给决策方）
  REQ_SENT: 'req_sent', // { reqType } 你的请求已发出，等待对方应答
  REQ_RESOLVED: 'req_resolved', // { reqType, accepted, reason } 请求了结（双方）
  PLAYER_DC: 'player_dc',   // { playerName, grace } 对手掉线，宽限 grace 秒
  PLAYER_RC: 'player_rc',   // { playerName } 对手已重连
  LEFT: 'left',         // { playerName } 有人离开
  ERROR: 'error',       // { message }
};
