# 分组标题与按钮缩放验收（2026-09-22）

本次将画布分组标题、操作按钮、连接按钮及临时选区按钮接入节点控件已有的缩放补偿；缩小画布时保留正常屏幕尺寸，并给组内节点标题留出间距。分组完整名称可通过悬停查看。

## 验证结果

- Studio 类型检查：`node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`，在 `apps/studio` 执行，退出码 0。
- Studio 构建：`node apps/studio/node_modules/vite/bin/vite.js build --config apps/studio/vite.config.ts`，输出：

```text
✓ 2186 modules transformed.
✓ built in 7.88s
```

- Chrome 独立界面验收：`node node_modules/@playwright/test/cli.js test --config=.tmp/group-readability.playwright.config.ts`，输出：

```text
3 passed (6.9s)
```

覆盖 100%、25%、5% 缩放：标题栏屏幕高度至少 37px、按钮至少 27px、标题不与组内节点名称重叠，以及点击解绑后保留两个成员节点。已查看 25% 和 5% 截图；验收使用模拟接口，不修改实际项目数据。

## 检查中保留的问题

Studio 全量单测输出：

```text
Test Files  1 failed | 189 passed (190)
     Tests  2 failed | 1245 passed (1247)
```

失败来自 `src/lib/asset-transfer.test.ts`：无二进制资产的空包导入行为，以及上传标签字段 `tag_ids` / `tags` 的期望不一致。对应资产导入实现正在共享工作区被其他任务修改，本次未改动该实现。

附加运行现有 `canvas-selection-connections.spec.ts` 的 50% 连线用例，未进入连接按钮断言：框选准备阶段找不到 `.canvas-group-frame.pending`。临时调整测试起点后，80% 与 100% 用例通过，50% 仍在相同准备步骤失败；临时起点调整已撤销。该项不记为通过。本次仅更新其中端口尺寸的断言以匹配缩放补偿。

`git diff --check` 通过。本次未改动后端及资产导入实现，也未重启共享服务。
