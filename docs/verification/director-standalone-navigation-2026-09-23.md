# 导演台导航直接独立打开 — 2026-09-23

## 交付行为

- 点击左侧「3D 导演台」，在新标签页直接打开完整导演台，原页面保持原位置。
- 普通 `/director` 入口通过现有 URL 解析逻辑跳转至 `/director-desk/index.html`，不挂载嵌入小界面。保留原鉴权入口。
- 暂时隐藏导航入口的小界面，原视图、控制器和样式代码保留，便于后续恢复。
- 带 `canvasId` 和 `nodeId` 的画布节点入口保留嵌入桥接与帧回写能力。

功能修改仅涉及 `StudioLayout.tsx` 和 `features/director/DirectorPage.tsx`。新标签入口采用原生链接，避免当前 Wouter 拦截普通点击后仍在当前页导航。没有提交、推送或联系其他助理任务。

## 浏览器验收

使用隔离的 Chrome 无头浏览器，1920 × 945，访问现有本地开发服务。接口使用模拟响应，不产生真实生成任务或修改用户数据。

验收覆盖：点击侧栏打开新标签页；原标签 URL 不变；原页面未挂载导演台 iframe；新标签为完整导演台且无 iframe；3D 人物实际呈现；新标签无 opener；刷新保持实例 ID；画布上下文入口仍显示已连接及「保存并返回画布」。浏览器运行错误为 0。

实际输出：

```text
node .tmp/director-standalone-qa/browser-check.cjs
PASS: sidebar click opens full Director Desk in a new tab; source page unchanged; no embedded editor; reload retains instance; canvas bridge retained; no page errors.
exit_code: 0
```

已检查截图：`.tmp/director-standalone-qa/standalone.png`、`.tmp/director-standalone-qa/original-page.png`。

## 项目规定检查的实际结果

使用现有 `.tmp/canvas-quality-qa` Go、Python 工具环境；pnpm 增加 `--config.verify-deps-before-run=warn`，避免自动重装共享依赖。

```text
pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio check
tsc --noEmit
exit_code: 0

pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio test
Test Files  1 failed | 199 passed (200)
Tests       8 failed | 1349 passed (1357)
Duration    12.11s
exit_code: 1

pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio build
✓ built in 4.37s
exit_code: 0

apps/api: go build ./... -> exit_code: 0
apps/api: go vet ./...   -> exit_code: 0
apps/api: go test ./...  -> exit_code: 0

pnpm --config.verify-deps-before-run=warn --filter @basketikun/canvas-agent test
tests 4; pass 4; fail 0
exit_code: 0

pnpm --config.verify-deps-before-run=warn --filter @ai-manju/director-desk test
Test Files 87 passed (87)
Tests      686 passed (686)
Duration   118.34s
exit_code: 0

apps/worker: python -m compileall worker -> exit_code: 0
apps/worker: python -m unittest discover -s tests
Ran 105 tests in 2.820s
FAILED (failures=9, errors=17, skipped=2)
exit_code: 1

git diff --check -- apps/studio/client/src/app/layouts/StudioLayout.tsx apps/studio/client/src/features/director/DirectorPage.tsx
exit_code: 0
```

Studio 的 8 项失败均来自本次未修改的 `CanvasInspectorMentionInsertion.test.tsx:76`：当前断言库不支持 `toHaveBeenCalledExactlyOnceWith`，报 `Invalid Chai property`。Worker 的失败涉及图片输出校验返回 `image_output_unreadable`，以及 Windows 缺少 `signal.SIGKILL`；与同日已有图片生成底栏验收记录一致。本次没有修改这些文件，不能把全量检查报告为全部通过。

完整日志位于 `.tmp/director-standalone-qa/`。构建仍有既有的大分包提示；构建退出码为 0。
