# AI-Manju Canvas Agent

AI-Manju 的本地画布 Agent。它连接浏览器画布与本机 Codex app-server / MCP，支持读取画布、增删改节点、连线、视口、触发生成和导出快照。

## 安全边界

- HTTP 服务只监听 `127.0.0.1`。
- 首次连接必须提供随机 Connect token。
- 首次带正确 token 的网页 Origin 会加入本机白名单，其他 Origin 无法复用。
- 配置保存在 `~/.infinite-canvas/canvas-agent.json`，其中包含 token 和 Origin 白名单。
- 写操作仍由网页侧的工具确认 UI 控制。

## 本项目构建与安装

本包属于 AI-Manju workspace，只生成本地安装包，不发布 npm：

```bash
pnpm --filter @basketikun/canvas-agent build
pnpm --filter @basketikun/canvas-agent test
pnpm --filter @basketikun/canvas-agent pack --pack-destination artifacts/canvas-agent
npm i -g ./artifacts/canvas-agent/basketikun-canvas-agent-0.1.0.tgz
canvas-agent
```

启动后终端会输出：

```text
Local URL: http://127.0.0.1:17371
Connect token: <random-token>
```

将地址和 token 填入 AI-Manju 画布的本地 Agent 配置即可连接。

## MCP 模式

```bash
codex mcp add infinite-canvas -- canvas-agent mcp
```

支持的工具名称、参数 schema、画布快照、操作和确认事件统一来自 `@ai-manju/canvas-agent-protocol`。在线和本地通道使用同一协议版本。