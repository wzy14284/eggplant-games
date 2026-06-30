# 多人浏览器小游戏服务端

用自己的 Mac 当服务器，让朋友通过浏览器一起玩。当前内置 **五子棋** 和 **围棋**，框架按可扩展游戏设计，未来可加斗地主等。

## 运行（本地）

```bash
cd games
npm install
npm start
```

默认监听 `http://127.0.0.1:23456`（仅本机可达）。本机开两个浏览器窗口访问 `http://localhost:23456` 即可对局测试：一个创建房间拿到房间码，另一个输入房间码加入，房主点「开始游戏」。

环境变量：
- `PORT`：端口，默认 23456
- `HOST`：监听地址（HTTP 默认 `127.0.0.1`，HTTPS 默认 `0.0.0.0`）
- `TLS_CERT`：TLS 证书路径（设置后启用 HTTPS）
- `TLS_KEY`：TLS 私钥路径（设置后启用 HTTPS）

也可以在项目根目录创建 `.env` 文件配置以上变量。

## 玩法

1. 窗口 A：填昵称 → 选「五子棋」→ 创建房间 → 拿到 6 位房间码
2. 把房间码发给朋友（窗口 B）：填昵称 → 输入房间码 → 加入
3. 窗口 A（房主）点「开始游戏」，双方轮流点击棋盘落子，连成五子者胜

## 让朋友（外网）也能玩

有两种方式，根据你的情况选择：

### 方式一：直接部署（有公网 IP 时推荐）

如果你的服务器有公网 IP，可以直接启用 HTTPS 对外服务，无需 Cloudflare Tunnel。

**1. 准备 TLS 证书**

可以使用 Let's Encrypt 免费申请：

```bash
# 安装 certbot
apt install certbot          # Ubuntu/Debian
# 或
brew install certbot         # macOS

# 申请证书（需要域名已解析到你的服务器 IP）
certbot certonly --standalone -d your-domain.com
```

证书文件路径（Let's Encrypt 默认）：
- 证书：`/etc/letsencrypt/live/your-domain.com/fullchain.pem`
- 私钥：`/etc/letsencrypt/live/your-domain.com/privkey.pem`

**2. 启动服务**

```bash
# 方式 A：环境变量
TLS_CERT=/etc/letsencrypt/live/your-domain.com/fullchain.pem \
TLS_KEY=/etc/letsencrypt/live/your-domain.com/privkey.pem \
./deploy.sh

# 方式 B：写入 .env 文件（推荐）
cat > .env << 'EOF'
TLS_CERT=/etc/letsencrypt/live/your-domain.com/fullchain.pem
TLS_KEY=/etc/letsencrypt/live/your-domain.com/privkey.pem
EOF
./deploy.sh
```

服务默认监听 `0.0.0.0:443`（HTTPS）。朋友通过 `https://your-domain.com` 即可访问。

自定义端口/地址：

```bash
# .env
TLS_CERT=...
TLS_KEY=...
PORT=8443
HOST=0.0.0.0
```

**3. 安全提示**

- 确保服务器防火墙开放对应端口（443 或自定义端口）
- Let's Encrypt 证书 90 天过期，建议设置自动续期：`certbot renew --quiet`
- 房间码 6 位随机，作为基础访问控制；想要更严格可给房间设密码（创建时填写）
- 服务端不执行任何用户传入的命令/字符串，仅做棋盘状态计算

### 方式二：Cloudflare Tunnel（无公网 IP 时）

如果服务器没有公网 IP，用 Cloudflare Tunnel 把本地端口转发出去，**无需在路由器开端口**。

```bash
# 安装（macOS）
brew install cloudflared

# 临时隧道：给你一个公网 https 域名（关掉即失效）
cloudflared tunnel --url http://localhost:23456
```

终端会打印一个 `https://xxx-xxx.trycloudflare.com` 域名，把这个域名发给朋友用浏览器打开即可。**不玩时按 Ctrl+C 关掉隧道，入口立即失效。**

> 想要固定域名：`cloudflared tunnel login` → `cloudflared tunnel create mygame` → 配置 CNAME，详见 https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/

## 项目结构

```
games/
  package.json
  server/
    app.js              # HTTP/HTTPS 静态托管 + WebSocket，入口
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

