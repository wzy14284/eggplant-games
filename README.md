# 多人浏览器小游戏服务端

用自己的 Mac 当服务器，让朋友通过浏览器一起玩。当前内置 **五子棋** 和 **围棋**，框架按可扩展游戏设计，未来可加斗地主等。

## 运行（本地）

```bash
cd games
npm install
npm start
```

默认监听 `http://127.0.0.1:8080`（仅本机可达）。本机开两个浏览器窗口访问 `http://localhost:8080` 即可对局测试：一个创建房间拿到房间码，另一个输入房间码加入，房主点「开始游戏」。

环境变量：
- `PORT`：端口，默认 8080
- `HOST`：监听地址，默认 `127.0.0.1`。**不要**轻易改成 `0.0.0.0`，那样局域网/公网（若做了端口映射）就能直接访问。

## 玩法

1. 窗口 A：填昵称 → 选「五子棋」→ 创建房间 → 拿到 6 位房间码
2. 把房间码发给朋友（窗口 B）：填昵称 → 输入房间码 → 加入
3. 窗口 A（房主）点「开始游戏」，双方轮流点击棋盘落子，连成五子者胜

## 让朋友（外网）也能玩 —— Cloudflare Tunnel（部署步骤，按需执行）

服务只监听 127.0.0.1，外网无法直连。用 Cloudflare Tunnel 把本地 8080 转发出去即可，**无需公网 IP、无需在路由器开端口**。

```bash
# 安装（macOS）
brew install cloudflared

# 临时隧道：给你一个公网 https 域名（关掉即失效）
cloudflared tunnel --url http://localhost:8080
```

终端会打印一个 `https://xxx-xxx.trycloudflare.com` 域名，把这个域名发给朋友用浏览器打开即可。**不玩时按 Ctrl+C 关掉隧道，入口立即失效。**

> 想要固定域名：`cloudflared tunnel login` → `cloudflared tunnel create mygame` → 配置 CNAME，详见 https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/

### 安全提示

- 服务只监听 localhost，cloudflared 主动出站连接，路由器不开任何入站端口，外网扫不到你的 Mac。
- 房间码 6 位随机，作为基础访问控制；想要更严格可给房间设密码（创建时填写）。
- 保持 macOS 防火墙开启、cloudflared 及时更新。
- 五子棋服务端不执行任何用户传入的命令/字符串，仅做棋盘状态计算。

## 项目结构

```
games/
  package.json
  server/
    app.js              # HTTP 静态托管 + WebSocket，入口，监听 127.0.0.1
    protocol.js         # 通信协议消息常量
    lobby.js            # 房间/会话管理、动作路由、状态广播
    gameRegistry.js     # 游戏注册表（扩展点）
    games/
      baseGame.js       # BaseGame 契约基类
      gomoku.js         # 五子棋实现
      weiqi.js          # 围棋实现（提子/禁着/劫/死子标记终局/数目）
  public/               # 前端（原生 HTML/JS，无构建）
    index.html          # 单页应用：大厅+房间+游戏
    client.js           # 通用 WebSocket 客户端（所有游戏复用）
    lobby.js            # 视图编排 + 渲染器注册
    gomoku.js           # 五子棋 Canvas 渲染器
    style.css
```

## 扩展一个新游戏（例如斗地主）

后端：
1. 新建 `server/games/doudizhu.js`，继承 `BaseGame`，实现 `metadata` / `constructor` / `applyAction` / `getPublicState` / `getPrivateState` / `isOver` / `getResult`。
   - 非完全信息游戏：`getPrivateState(playerId)` 返回该玩家自己的手牌；`getPublicState` 返回公共牌桌（出牌历史、各家剩余张数等）。
2. 在 `server/gameRegistry.js` 的 `registerBuiltins()` 里 `registerGame(Doudizhu)`。

前端：
3. 新建 `public/doudizhu.js`，实现渲染器契约：`mount(container, ctx)` / `onState(public, private, turnIndex)` / `onOver(result, public, private)`。
4. 在 `public/lobby.js` 的 `renderers` 映射里登记：`{ ..., doudizhu: DoudizhuRenderer }`。

无需改动框架其余部分，房间/协议/广播机制都是通用的。

## 不在本次范围

- 部署执行（本文档只给步骤）
- 用户系统/数据库/持久化（房间存内存，重启即清，符合给朋友玩场景）
- 斗地主实现（仅预留接口）

