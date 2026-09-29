# 普通用户页面统一小圆角

日期：2026-09-29。

## 最终范围

普通工作台、图片/视频生成、项目和资产库、标签/提示词/技能库、资产助手、队列、会员/设置，以及导演台共用一套圆角：小标签 4px，按钮/输入框 6px，卡片/面板/菜单 8px，弹窗 10px。

按用户补充要求，整个画布页面保留原有设计，尤其节点和分组；后台管理员专用页面也保持原样。头像、滑块、开关、连接点等功能性圆形保留。没有修改生成配置、接口或数据。

## 实现

- `packages/ui-tokens/corners.css`：Studio 与导演台共用圆角数值；已加入版本控制白名单。
- `apps/studio/client/src/shared/styles/user-corners.css`：集中管理形状，移除旧的斜切角；按路由标记启用，包含挂载在 body 的弹窗。
- `AppRouter.tsx`：管理员路由标记 admin，画布布局标记 canvas，其他页面标记 user。新圆角仅匹配 user，不按登录者是否为管理员区分普通页面。
- `AppRouter.recovery.test.tsx`：验证普通页面→后台→后台延迟加载→普通监控→画布→普通页面时的隔离。
- 图片工作台原来的局部圆角变量改为共用规格；导演台引入相同 token。

## 浏览器验证

使用用户实际登录的 localhost:3100 会话。检查了工作台、图片、视频、资产、标签、提示词、技能、队列、项目、资产助手、会员、普通运行监控、画布、后台及导演台。未提交生成任务。

- 视频：参数面板、提示词框 8px；按钮 6px，选中项依旧浅底深色字。
- 图片提示词库弹窗：实际位于 root 外的 body portal，圆角 10px。
- 后台：`data-ui-surface=admin`，新规则匹配 false，原有 outline 按钮的斜切角仍在，admin-panel 仍为 0px。
- 画布最终状态：`data-ui-surface=canvas`，新规则匹配 false；节点为原来的 14px，分组框为原来的 10px，分组头部为 10px 10px 0px 0px。overflow 仍为 visible。画布 CSS 未修改。
- 导演台：工具栏、视角切换容器 8px；返回按钮 6px。
- 检查了已访问页面中可见的带完整边框的矩形组件，补齐队列状态标签和资产助手徽章等遗漏。这是实际页面抽查，不代表每个隐藏状态均已人工展开。

截图及读数保存在 `output/user-corners/`。最终画布证据为 `canvas-preserved.png`；较早的 `canvas.png` 是用户补充排除要求前的中间截图，不代表最终结果。`image.png`、`dialog.png`、`video.png` 可查看普通页面最终形状。

## 验证命令与实际输出

完整日志：`.tmp/user-corners-20260929/`。

Studio 类型检查：`pnpm --filter ai-manhua-studio check`，退出 0。

```text
> tsc --noEmit
```

Studio 测试：`pnpm --filter ai-manhua-studio test`，最终退出 0。

```text
Test Files  261 passed (261)
     Tests  2065 passed (2065)
  Duration  13.11s
```

Studio 构建：`pnpm --filter ai-manhua-studio build`，退出 0，保留已有 chunk 大于 500kB 的提示。

```text
✓ built in 3.88s
✓ built in 6.49s
```

API：在 `apps/api` 执行 `go build ./...`、`go vet ./...`、`go test ./...`，全部退出 0。build/vet 无输出；测试结果为通过或无测试文件。

```text
build=0 vet=0 test=0
```

Canvas Agent：`pnpm --filter @basketikun/canvas-agent test`，退出 0。

```text
ℹ tests 5
ℹ pass 5
ℹ fail 0
ℹ duration_ms 71.4139
```

Director Desk：`pnpm --filter @ai-manju/director-desk test`，退出 0。

```text
Test Files  87 passed (87)
     Tests  689 passed (689)
  Duration  94.92s
```

Worker：主机默认 Python 是 Windows 应用占位程序，打包 Python 缺少 psycopg 等项目依赖。改用已有 Worker 镜像，在无网络临时容器内只读挂载当前源码并将编译缓存写入临时目录，执行 `python -m compileall worker && python -m unittest discover -s tests`。运行中的 Worker 未重启。最终退出 0：

```text
Ran 275 tests in 3.875s
OK (skipped=27)
```

`git diff --check` 通过，无输出。未提交、未部署；保留其他既有修改。
