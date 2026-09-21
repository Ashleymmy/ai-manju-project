# 当前任务导航名称

仅将截图中左侧导航的“画布工坊”改为“当前任务”。悬停 title 随导航配置同步更新；链接 `/canvas?resume=recent`、快捷键和最近编辑画布跳转行为不变。未修改资产库分类或其他页面名称，未提交、推送或部署。

更新 `LineNav.test.tsx` 名称/title 断言及 `canvas-recent-entry.spec.ts` 入口定位和链接断言。浏览器使用独立模拟 API，不写入真实项目。截图 `.tmp/recent-entry-qa/canvas-recent-entry-sideba-2e782-nd-ignores-deleted-projects/current-task-nav.png` 已检查。

## 实际验证结果

```text
canvas-recent-entry.spec.ts: 4 passed (11.5s)
Studio check: tsc --noEmit, exit 0
Studio test: 184 files passed, 1163 tests passed, Duration 8.88s
Studio build: 2166 modules transformed; built in 3.46s; exit 0
Director dependency build: built in 4.00s
Canvas Agent test: tests 4; pass 4; fail 0; duration_ms 72.2494
Director Desk test: 87 files passed; 686 tests passed; Duration 92.79s
Go build ./...: exit 0, no output
Go vet ./...: exit 0, no output
Go test ./...: exit 0
ok github.com/ai-manju/api/internal/handler (cached)
ok github.com/ai-manju/api/internal/repository (cached)
ok github.com/ai-manju/api/internal/router (cached)
Worker compileall worker: exit 0
Worker unittest discover -s tests:
Ran 90 tests in 0.583s
FAILED (failures=4, errors=7, skipped=2)
git diff --check: exit 0
```

浏览器回归包含最近编辑画布、删除后回退、编辑其他画布后更新目标、新账号空列表和列表接口失败的处理。

pnpm 使用 `--config.verify-deps-before-run=warn`；Go/Worker 使用已有 `.tmp/canvas-quality-qa` 运行时。Worker 失败与前一轮一致：图像输出验证的 `image_output_unreadable` 与预期不符，以及 Windows 缺少 `signal.SIGKILL`；与此次文案变更无关，未修改相关代码。保留既有 Director 大包和 `pnpm.overrides` 警告。
