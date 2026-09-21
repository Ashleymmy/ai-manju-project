# 全站小球原地打开 Agent 对话验收

## 用户确认

技能库等非画布页面点击右下角小球，保持当前页面，弹出画布 Agent 同款对话框，不跳转最近画布或画布列表。用户已明确选择“留在当前页面，弹出 Agent 对话框”。

## 实现

- `StudioAgentFab` 从跳转 `/canvas` 改为按需加载现有 `AgentPanel`，通过 portal 浮在当前页面右侧，不遮断原页面状态。
- 全站对话按登录账号分开保存，使用现有对话记录存储；关闭再打开保留消息、输入草稿与模型选择，刷新后可从历史列表恢复对话。
- 保留真实模型目录、文本请求、发送、中断、错误反馈、新建/切换/删除历史对话等现有路径。全站模式可使用普通文本模型，不要求画布工具调用能力。
- 全站模式没有活动画布，不传画布工具，不读取或写入任意最近项目；没有相关能力的画布引用、手动执行确认等控件不在此模式中显示。即使模型返回未经提供的工具调用，也明确报错且不执行。画布模式原有工具、选中节点引用与生成操作不变。
- Agent 基础样式从画布样式文件原样迁至组件样式，两个入口复用同一套面板。新增全站浮窗定位、窄屏边界和加载状态；拖动宽度、关闭按钮、Escape 及打开后的输入焦点可用。
- 不修改后端路由、鉴权、响应信封或存储仓库实现。

## 单元与浏览器覆盖

新增 5 项 `StudioAgentFab` 测试，覆盖懒加载、不导航、真实请求入口、不携带画布工具、普通文本模型切换、关闭重开保留草稿、历史恢复、Escape 优先关闭菜单、失败后再次发送，以及拒绝意外工具调用。现有 Agent 24 项模型交接、引用和中断测试继续通过。

浏览器在独立 Chrome 上下文中模拟 API，不调用付费模型，不修改用户实际数据。桌面 1440x1000 和窄屏 390x844 均验证：

- 技能库小球原地打开同款 Agent，地址仍是 `/skills`，原搜索输入不变。
- 浮窗、关闭和发送控件完整处于视口内，桌面拖动宽度实际生效。
- 切换模型并发送，确认 `/api/ai/text` 请求携带所选模型和用户文字、没有画布工具，回复显示在消息列表。
- 关闭重开保留对话和草稿，新建及历史切换正常，刷新可恢复保存的历史。
- 全站模式没有项目写请求。
- 桌面另行进入测试画布，验证原画布小球、手动确认、消息显示与请求中的 `tool_choice: required`、`canvas_get_state` 工具均保留。

首次桌面测试被现有版本公告的模态层挡住可访问性查询；调整测试为先关闭公告后继续，没有修改生产公告逻辑。

最终实际输出：

```text
node node_modules/.pnpm/@playwright+test@1.62.1/node_modules/@playwright/test/cli.js test --config .tmp/studio-agent.playwright.config.ts

1440px passed 7.8s
390px passed 5.6s
2 passed (13.9s)
```

截图保存在 `.tmp/studio-agent-qa/` 的测试子目录，包括 `agent-welcome.png`、`agent-conversation.png`、`canvas-agent-regression.png`。已目视检查桌面、窄屏欢迎界面和画布聊天回归截图，无控件重叠或溢出。

## 项目检查实际输出

pnpm 使用现有依赖，实际命令附加 `--config.verify-deps-before-run=warn`，未安装依赖或改锁文件。

```text
pnpm --filter ai-manhua-studio check
tsc --noEmit
Exit code: 0

pnpm --filter ai-manhua-studio test
Test Files  184 passed (184)
     Tests  1162 passed (1162)
  Duration  8.39s

pnpm --filter ai-manhua-studio build
Director Desk: built in 3.89s
Studio: built in 3.02s
Exit code: 0

pnpm --filter @basketikun/canvas-agent test
tests 4
pass 4
fail 0

pnpm --filter @ai-manju/director-desk test
Test Files  87 passed (87)
     Tests  686 passed (686)
  Duration  89.66s

go build ./...: exit 0
go vet ./...: exit 0
go test ./...: exit 0, cached

python -m compileall worker
Listing 'worker'...
Compiling 'worker\\image_requirements.py'...
Compiling 'worker\\provider.py'...
Exit code: 0

python -m unittest discover -s tests
Ran 84 tests in 0.229s
FAILED (errors=1, skipped=2)
AttributeError: module 'signal' has no attribute 'SIGKILL'

git diff --check: exit 0
```

Go 在 `apps/api` 使用已有 `.tmp/canvas-quality-qa/go-runtime/go/bin/go.exe` 与 `.tmp/canvas-quality-qa/gomodcache`。Worker 在 `apps/worker` 使用已有 `.tmp/canvas-quality-qa/worker-venv/Scripts/python.exe`；唯一失败仍是 `test_shutdown_has_shared_deadline_and_kills_stuck_pool` 的既有 Windows 兼容问题。本任务未修改 Worker，保留其他会话的同期修改，因此测试总数反映当前完整工作区。构建仍有既有 pnpm 配置、依赖不同步及 Director Desk 大 chunk 提示。

沿用 `http://localhost:3100` 已运行前端。未提交、推送、部署或重启服务。
