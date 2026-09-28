# 画布导入任务图标入口

## 修改

- 仅在画布路由将原左下角导入任务框改为右下角图标，位于 Agent 小球左侧，间隔 16px。
- 桌面按钮 40x40px、图标 20px，与 Agent 垂直居中；不显示常驻文字、任务计数、边框或大块底色。悬停提供轻微反馈。
- 根据用户追加截图，使用与 Agent 按钮相同的原生 `title` 提示，文字固定为“导入任务”；不使用自定义 Tooltip 气泡。
- 窄屏适度抬高入口，避开底部缩放工具栏；保持键盘焦点轮廓和 Enter 激活。
- 点击仍调用原 importTaskManager，任务对话框和继续/删除等功能不变。非画布页面保留原左侧入口。
- 无后端业务改动，无用户数据变更，未提交、未推送、未部署或重启服务。继续使用 http://localhost:3100。

## 验证

新增 `canvas-import-task-entry.spec.ts`，覆盖 1920/1000/390px：只有一个图标、无可见文字、位于 Agent 左侧、对齐及间距、无底栏重叠、原生 title、鼠标点击与键盘打开、空任务状态、读取真实隔离 IndexedDB 的暂停任务、删除后重新打开为空。

浏览器 API 为模拟，IndexedDB 属于独立测试浏览器，没有操作用户的真实任务。已查看桌面和窄屏截图。原生提示由浏览器绘制，自动截图不展示该系统浮层；通过与 Agent 一致的 title 属性验证提示文字和实现，不冒称截图捕获了系统提示。

初轮几何断言遇到 Agent 入场动画的亚像素位置，已改为等动画结束后比较。删除任务原逻辑会关闭全局弹窗，测试按实际行为重新打开确认空状态。最终专项通过，未为测试改动任务管理行为。

## 实际输出

pnpm 命令沿用 `--config.verify-deps-before-run=warn`，不修改依赖或锁文件。

```text
Studio check: tsc --noEmit; exit 0
Studio test: Test Files 229 passed (229); Tests 1661 passed (1661)
Studio test duration: 11.39s
Studio build: vite v7.3.6; built in 6.49s; exit 0

Playwright transfer-tasks config: original asset/tag/bulk regression 18 passed
Playwright canvas-import-task-entry final rerun: 3 passed (15.5s)

API: go build ./...; go vet ./...; go test ./...
build/vet exit 0; all tested packages ok (cached)
Canvas Agent: tests 4; pass 4; fail 0
Director Desk: Test Files 87 passed (87); Tests 689 passed (689)
Director Desk duration: 89.61s
Worker compileall: exit 0
Worker unittest: Ran 131 tests in 2.096s; OK (skipped=9)
git diff --check: exit 0
```

Worker 使用现有 `ai-manju-worker-monitoring:20260923` 镜像只读挂载源码检查；Go 使用项目 `.tmp` 内现有工具链。保留既有依赖同步提示、构建体积警告及 CRLF 提示。

截图：`test-results/asset-transfer-tasks/canvas-import-task-entry-*/import-entry-{1920,1000,390}.png`。
