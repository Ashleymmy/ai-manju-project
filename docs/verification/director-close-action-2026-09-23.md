# 导演台右上角退出按钮 — 2026-09-23

## 行为

原来的「×」只发送 `storyai:director-desk-close` 消息，独立标签页没有外层接收者，因此无实际动作。

现在按钮的提示为「保存场景并退出导演台」。退出前同步保存当前实例的最新场景；从 Studio 侧栏打开的独立标签页会真正关闭。对于浏览器不允许脚本关闭的手动标签页，返回 Studio `/dashboard`；单独部署的导演台返回自己的首页。

保存失败时提示原因并保持编辑界面；视频导出尚未结束时提示等待，避免退出中断导出。保留 iframe 和 Tauri 原有关闭消息机制。本次不增加导出图片、回写画布或删除场景等操作。

前一项「侧栏直接独立打开导演台」已完成，见 `director-standalone-navigation-2026-09-23.md`。

## 浏览器实际验收

通过隔离 Chrome 访问现有本地服务，使用模拟 API，不修改真实用户数据。

1. 从侧栏打开独立标签页，修改「场景缩放」为 1.35。
2. 点击「×」，确认标签页实际关闭，原标签页 URL 不变。
3. 重新打开同一实例，确认场景缩放仍为 1.35。
4. 模拟浏览器存储写入失败，确认出现提示，页面保持打开。
5. 恢复存储，给手动打开的标签页增加导航历史，使 Chrome 实际拒绝 `window.close()`；点击「×」后成功返回 `/dashboard`。
6. 同时复核侧栏导航、实例刷新和画布上下文桥接；无浏览器运行错误。

```text
node .tmp/director-standalone-qa/browser-check.cjs
PASS: close saves the edited scene and closes the sidebar-opened tab; reopen restores edits; storage failure blocks exit; a non-closable tab returns to the Studio dashboard.
PASS: sidebar click opens full Director Desk in a new tab; source page unchanged; no embedded editor; reload retains instance; canvas bridge retained; no page errors.
exit_code: 0
```

## 自动检查实际输出

```text
pnpm --config.verify-deps-before-run=warn --filter @ai-manju/director-desk exec vitest run src/__tests__/App.test.tsx src/editor/io/__tests__/referenceVideoExport.test.ts src/editor/io/__tests__/hostBridge.test.ts src/editor/store/__tests__/directorStore.test.ts
Test Files 4 passed (4)
Tests      98 passed (98)
Duration   4.55s

pnpm --config.verify-deps-before-run=warn --filter @ai-manju/director-desk test
Test Files 87 passed (87)
Tests      689 passed (689)
Duration   92.67s

pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio check
tsc --noEmit
exit_code: 0

pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio test
Test Files 200 passed (200)
Tests      1357 passed (1357)
Duration   10.31s

pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio build
✓ built in 4.40s
exit_code: 0

apps/api: go build ./... -> exit_code: 0
apps/api: go vet ./...   -> exit_code: 0
apps/api: go test ./...  -> exit_code: 0 (cached)

pnpm --config.verify-deps-before-run=warn --filter @basketikun/canvas-agent test
tests 4; pass 4; fail 0

apps/worker: python -m compileall worker -> exit_code: 0
apps/worker: python -m unittest discover -s tests
Ran 105 tests in 1.838s
FAILED (failures=9, errors=17, skipped=2)

git diff --check -- apps/director-desk apps/studio/client/src/app/layouts/StudioLayout.tsx apps/studio/client/src/features/director/DirectorPage.tsx
exit_code: 0
```

Worker 失败与先前记录一致：图片输出校验返回 `image_output_unreadable` 和 Windows 缺少 `signal.SIGKILL`，本次未修改 Worker。Studio 的最新全量测试已经全部通过。构建仍有既有的大分包警告。完整日志：`.tmp/director-standalone-qa/close-*.log`。

没有提交、推送、重启共享开发服务或联系其他助理任务。
