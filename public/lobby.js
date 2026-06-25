// 大厅 / 房间编排：单页应用，全程复用一个 WebSocket 连接。
// 视图：lobbyView -> roomView(等待) -> gameView(由游戏渲染器挂载)。
// 扩展点：renderers 映射表 —— 新游戏加一个渲染器模块并在此注册即可。

import { GameClient } from './client.js';
import { GomokuRenderer } from './gomoku.js';
import { WeiqiRenderer } from './weiqi.js';
import { XiangqiRenderer } from './xiangqi.js';

const renderers = { gomoku: GomokuRenderer, weiqi: WeiqiRenderer, xiangqi: XiangqiRenderer }; // 新增游戏在此登记

const client = new GameClient();
const $ = (id) => document.getElementById(id);

// 断线重连时把当前 session 交给 client 去 RESUME 旧座位
client.resumeFn = () => session
  ? { playerId: session.playerId, roomCode: session.roomCode }
  : null;

let session = null;       // { roomCode, playerId, yourIndex, gameType, isHost }
let currentRenderer = null;
let readyData = null;
let gamePhase = 'play';   // 当前游戏阶段（用于按钮可用性）
let inGame = false;       // 是否在对局中（未结束）
let reqCountdown = null;  // 横幅倒计时 interval

const VIEWS = ['homeView', 'createView', 'joinView', 'aboutView', 'roomView', 'gameView'];
function setStatus(t) { $('status').textContent = t; }
function show(view) {
  for (const v of VIEWS) $(v).classList.toggle('hidden', v !== view);
}
function goHome() { show('homeView'); setStatus(''); }

// ---- 控制按钮可用性 ----
function updateControls() {
  const over = !inGame;
  $('undoBtn').classList.toggle('hidden', over || gamePhase !== 'play');
  $('drawBtn').classList.toggle('hidden', over);
  $('resignBtn').classList.toggle('hidden', over);
}

// ---- 请求横幅 ----
function clearReqBanner() {
  if (reqCountdown) { clearInterval(reqCountdown); reqCountdown = null; }
  $('reqBanner').classList.add('hidden');
  $('reqBanner').innerHTML = '';
}
function showReqBanner(html) {
  clearReqBanner();
  $('reqBanner').innerHTML = html;
  $('reqBanner').classList.remove('hidden');
}
function startCountdown(seconds, onTick) {
  if (reqCountdown) clearInterval(reqCountdown);
  let left = seconds;
  onTick(left);
  reqCountdown = setInterval(() => {
    left -= 1;
    if (left <= 0) { clearInterval(reqCountdown); reqCountdown = null; onTick(0); }
    else onTick(left);
  }, 1000);
}

// ---- 首页入口 ----
$('homeCreateBtn').addEventListener('click', () => { show('createView'); setStatus(''); });
$('homeJoinBtn').addEventListener('click', () => { show('joinView'); setStatus(''); });
$('homeAboutBtn').addEventListener('click', () => { show('aboutView'); setStatus(''); });
$('brandHome').addEventListener('click', goHome);
$('brandHome2').addEventListener('click', goHome);
$('createBackBtn').addEventListener('click', goHome);
$('joinBackBtn').addEventListener('click', goHome);
$('aboutBackBtn').addEventListener('click', goHome);

// ---- 大厅：创建 / 加入 ----
client.onGames = (games) => {
  const sel = $('gameSelect');
  sel.innerHTML = '';
  for (const g of games) {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = `${g.name}（${g.minPlayers}-${g.maxPlayers} 人）`;
    sel.appendChild(opt);
  }
};

$('createBtn').addEventListener('click', () => {
  const name = $('createName').value.trim();
  if (!name) return setStatus('请填写昵称');
  client.create($('gameSelect').value, name, $('createPwd').value || undefined);
});

$('joinBtn').addEventListener('click', () => {
  const name = $('joinName').value.trim();
  const code = $('joinCode').value.trim().toUpperCase();
  if (!name) return setStatus('请填写昵称');
  if (!code) return setStatus('请输入房间码');
  client.join(code, name, $('joinPwd').value || undefined);
});

// ---- 房间：CREATE/JOIN 响应 + READY 广播 ----
client.onCreated = (data) => {
  session = { roomCode: data.roomCode, playerId: data.playerId, yourIndex: data.yourIndex, isHost: true };
  setStatus('房间已创建，把房间码发给朋友');
  show('roomView');
};

client.onJoined = (data) => {
  session = { roomCode: data.roomCode, playerId: data.playerId, yourIndex: data.yourIndex, isHost: false };
  setStatus('已加入房间');
  show('roomView');
};

function renderRoom(data) {
  readyData = data;
  $('roomCodeDisplay').textContent = session?.roomCode || '';
  $('playerList').innerHTML = '';
  for (const p of data.players) {
    const li = document.createElement('li');
    const you = p.id === session?.playerId ? '（你）' : '';
    const host = p.id === data.hostId ? ' 👑' : '';
    li.textContent = `${p.name}${you}${host}`;
    $('playerList').appendChild(li);
  }
  const need = data.minPlayers - data.playerCount;
  $('roomInfo').textContent = data.started
    ? '游戏进行中…'
    : (need > 0 ? `还差 ${need} 人即可开始` : '人已到齐，房主可开始游戏');
  // 仅房主、未开始、人齐时显示开始按钮
  const canStart = session?.isHost && data.canStart && !data.started;
  $('startBtn').classList.toggle('hidden', !canStart);
}

client.onReady = (data) => {
  if (!session) return; // 忽略无关广播
  renderRoom(data);
  // 未开始（含一局结束后的重置）-> 回到房间等待视图
  if (!data.started) {
    show('roomView');
    inGame = false;
    clearReqBanner();
    $('rematchBtn').classList.add('hidden');
    updateControls();
  }
};

// ---- 游戏开始 ----
client.onStarted = (data) => {
  session = { ...session, yourIndex: data.yourIndex, gameType: readyData?.gameType };
  const renderer = renderers[readyData?.gameType];
  if (!renderer) { setStatus('找不到该游戏的渲染器'); return; }
  show('gameView');
  currentRenderer = renderer;
  inGame = true; gamePhase = data.publicState.phase || 'play';
  clearReqBanner();
  $('rematchBtn').classList.add('hidden'); // 新一局开始，隐藏返回房间按钮
  updateControls();
  renderer.mount($('gameMount'), {
    client,
    playerId: session.playerId,
    yourIndex: data.yourIndex,
    publicState: data.publicState,
    privateState: data.privateState,
  });
};

client.onState = (data) => {
  gamePhase = data.publicState.phase || gamePhase;
  currentRenderer?.onState?.(data.publicState, data.privateState, data.turnIndex);
  updateControls();
};

client.onOver = (data) => {
  inGame = false;
  gamePhase = 'over';
  clearReqBanner();
  currentRenderer?.onOver?.(data.result, data.publicState, data.privateState);
  updateControls();
  // 只有房主能重开，非房主只显示提示
  if (session?.isHost) {
    $('rematchBtn').classList.remove('hidden');
  } else {
    setStatus('一局结束，等待房主返回房间开新局');
  }
};

client.onLeft = ({ playerName }) => setStatus(`${playerName} 离开了房间`);

client.onError = (msg) => {
  setStatus('❌ ' + msg);
  // 重连续局失败（房间/座位已失效）-> 回大厅
  if (msg === '会话已失效') resetToLobby('连接已断开，请重新加入房间');
};

// ---- 对手掉线宽限期 ----
client.onPlayerDc = (data) => {
  const span = document.createElement('span');
  span.textContent = `${data.playerName} 掉线，${data.grace} 秒内未重连将判你赢`;
  showReqBanner('');
  $('reqBanner').appendChild(span);
  startCountdown(data.grace, (left) => {
    span.textContent = left > 0
      ? `${data.playerName} 掉线，${left} 秒内未重连将判你赢`
      : `${data.playerName} 宽限期满，等待结算…`;
  });
};
client.onPlayerRc = (data) => {
  clearReqBanner();
  setStatus(`${data.playerName} 已重连`);
};

// ---- 悔棋 / 和棋 / 认输 请求 ----
const REQ_LABEL = { undo: '悔棋', draw: '和棋' };

client.onReq = (data) => {
  // 对方发起，需我方决策
  const label = REQ_LABEL[data.reqType] || data.reqType;
  const span = document.createElement('span');
  span.textContent = `${data.fromName} 申请${label}，10 秒内无响应自动拒绝`;
  const accept = document.createElement('button');
  accept.className = 'primary'; accept.textContent = '同意';
  accept.addEventListener('click', () => { client.respond(true); clearReqBanner(); });
  const reject = document.createElement('button');
  reject.textContent = '拒绝';
  reject.addEventListener('click', () => { client.respond(false); clearReqBanner(); });
  const wrap = document.createElement('div');
  wrap.append(span, accept, reject);
  showReqBanner('');
  $('reqBanner').appendChild(wrap);
  startCountdown(10, (left) => {
    if (left > 0) span.textContent = `${data.fromName} 申请${label}，${left} 秒内无响应自动拒绝`;
    else span.textContent = `${label} 请求超时处理中…`;
  });
};

client.onReqSent = (data) => {
  // 我方发起，等待对方
  const label = REQ_LABEL[data.reqType] || data.reqType;
  const span = document.createElement('span');
  span.textContent = `已申请${label}，等待对方应答… 10`;
  showReqBanner('');
  $('reqBanner').appendChild(span);
  startCountdown(10, (left) => {
    span.textContent = left > 0
      ? `已申请${label}，等待对方应答… ${left}`
      : `已申请${label}，超时处理中…`;
  });
};

client.onReqResolved = (data) => {
  clearReqBanner();
  const label = REQ_LABEL[data.reqType] || data.reqType;
  if (!data.accepted) {
    setStatus(data.reason === 'timeout' ? `${label}请求超时已自动拒绝` : `${label}请求被拒绝`);
  } else if (data.reqType === 'undo') {
    setStatus(`${label}成功，已回退一手`);
  } else if (data.reqType === 'draw') {
    setStatus('对方同意和棋');
  }
};

// ---- 房间操作按钮 ----
$('startBtn').addEventListener('click', () => client.start());
$('copyBtn').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(session?.roomCode || ''); setStatus('房间码已复制'); }
  catch { setStatus('房间码: ' + (session?.roomCode || '')); }
});
$('leaveBtn').addEventListener('click', () => {
  client.leave();
  resetToLobby('已离开房间');
});
$('rematchBtn').addEventListener('click', () => client.rematch());
$('undoBtn').addEventListener('click', () => client.reqUndo());
$('drawBtn').addEventListener('click', () => client.reqDraw());
$('resignBtn').addEventListener('click', () => {
  if (confirm('确定认输？')) client.resign();
});
$('backBtn').addEventListener('click', () => {
  // 对局中返回大厅视为认输，需确认
  if (inGame && !confirm('对局中离开将视为认输，确定返回大厅？')) return;
  client.leave();
  resetToLobby('已返回大厅');
});

function resetToLobby(msg) {
  session = null; readyData = null; currentRenderer = null;
  inGame = false; gamePhase = 'play';
  clearReqBanner();
  $('gameMount').innerHTML = '';
  $('rematchBtn').classList.add('hidden');
  updateControls();
  show('homeView');
  setStatus(msg || '');
}

// 启动
client.connect();
setStatus('连接中…');
