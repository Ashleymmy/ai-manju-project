# Studio 小字排版优化验证（2026-09-22）

## 用户要求与改动

优化各页面已经调大的小字观感，保留大标题。此次没有再放大字号：辅助说明 12px、一般小字 13px、控件 14px 维持原值。

- 为界面正文引入真正的 Regular 400 字体，避免此前正常文字和中等字重都使用 Medium 字形。导航、说明和辅助信息更轻；选中导航与按钮使用 Medium，分组保持适度强调。
- 保留原来的圆体风格。页面及分区的 h1/h2 继续使用原 Studio Rounded 字体和原先继承的 500 字重，具体标题规则的字号和强调样式不变。
- 统一小字的中文后备字体。紧凑状态、参数、元数据中的拉丁字符保留等宽字体，中文回退到界面字体，避免系统衬线字体混入。
- 调整通用按钮字重、字距与文字行高；不改变页面布局、业务流程和画布内容字体。

字体文件：`apps/studio/client/public/fonts/chill-round-gothic/regular.53505f0.woff2`，1,797,344 字节。源字体沿用已使用的 ChillRoundGothic 上游版本 `53505f0818983d2fcdda00dc66e051ad13e81ffb` 及 SIL OFL 1.1 许可。使用 FontTools 子集化，覆盖与现有 Medium 完全相同的 7,807 个码位，OS/2 字重 400。本地提供字体，不增加第三方字体请求依赖。

主要文件为 `shared/styles/{fonts,tokens,base}.css`、`app/styles/shell.css`、各功能页的小字字体声明、字体 README 和既有 `e2e/small-text-readability.spec.ts`。该工作区同时存在其他任务的项目管理、画布等改动；本次未接管或还原这些文件中的并行修改，未提交、部署或重启共享服务。

## 浏览器与视觉验证

使用已有本地开发服务和隔离 Chrome 浏览器上下文，全部业务 API 被测试数据拦截，没有改动真实项目或调用生成服务。

命令：`node node_modules/@playwright/test/cli.js test --config .tmp/typography-refinement/playwright.config.ts`

```text
4 passed (1.2m)
```

覆盖 1920×1080、1280×800、390×844 下的工作台、技能库、资产库、全部项目、图片生成、视频生成。检查主要导航与按钮不截字、工作台无横向溢出、页面无异常。禁用 Google Fonts 后，400/500/700 三个本地字重仍可加载。

保留项的实际断言：工作台主标题桌面 42px / 窄屏 30px，统计数字 30px，积分数字 24px，输入框 13px。主标题仍为 Studio Rounded / 500；说明文字为 Studio UI / 400；选中导航为 500。

另用 Chrome 实际渲染字体检查，排除仅声明字体但未使用的情况：

```text
.chat-hero h2     ChillRoundGothic_Medium
.stat-strip strong IBMPlexMono-SemiBold
.stat-strip small ChillRoundGothic_Regular
.ln-label (分组)  ChillRoundGothic_Medium
1 passed (3.4s)
```

已人工查看桌面工作台、手机工作台和资产库截图。最终桌面截图：`.tmp/typography-refinement/probe.png`；全部页面截图位于 `.tmp/typography-refinement/after/`；原版截图保留于 `.tmp/typography-refinement/before/`。

## 项目规定检查：实际输出

日志统一位于 `.tmp/typography-refinement/`。

Studio 类型检查：`pnpm --filter ai-manhua-studio check`，退出码 1。当前项目管理功能的并行修改存在下列错误，本次未修改相关 TypeScript：

```text
client/src/features/projects/copyProject.ts(46,5): error TS2322: Type 'unknown' is not assignable to type '{}'.
client/src/features/projects/ProjectsPage.tsx(249,29): error TS2554: Expected 2 arguments, but got 1.
```

Studio 全量测试：`pnpm --filter ai-manhua-studio test`，退出码 1。

```text
Test Files  2 failed | 191 passed (193)
     Tests  2 failed | 1292 passed (1294)
  Duration  9.95s
```

两个失败均位于项目管理并行改动：

1. `architecture.test.ts`：`features/projects/useProjectGroups.ts` 从 `@/features/settings/api` 直接导入，违反跨 feature 必须经公开 `index.ts` 的约束。
2. `ProjectCardActions.test.tsx`：原断言要求“设置封面 / 重命名 / 删除”三个工具，实际新增了“复制画布”。

Studio 构建：`pnpm --filter ai-manhua-studio build`，退出码 0。

```text
../dist/public/assets/CanvasPage-Bx9-Tqun.js  341.71 kB | gzip: 105.18 kB
✓ built in 3.27s
```

API：使用工作区已安装的 Go 与模块缓存，依次执行 `go build ./...`、`go vet ./...`、`go test ./...`，均退出码 0。

```text
ok github.com/ai-manju/api/internal/handler     14.525s
ok github.com/ai-manju/api/internal/repository  (cached)
ok github.com/ai-manju/api/internal/router       1.520s
ok github.com/ai-manju/api/internal/service      2.429s
ok github.com/ai-manju/api/internal/storage     (cached)
```

Canvas Agent：`pnpm --filter @basketikun/canvas-agent test`，退出码 0。

```text
tests 4
pass 4
fail 0
```

Director Desk：`pnpm --filter @ai-manju/director-desk test`，退出码 0。

```text
Test Files  87 passed (87)
     Tests  686 passed (686)
  Duration  89.17s
```

Worker：独立临时 `ai-manju-40-worker` 容器，只读挂载源码并在临时目录补齐 httpx。执行 `python -m compileall -q worker && python -m unittest discover -s tests`，退出码 0，不影响正在运行的服务。

```text
Ran 105 tests in 2.006s
OK (skipped=1)
```

`git diff --check` 通过；pnpm 自动删除的锁文件 overrides 已精确恢复。

本次小字视觉回归和构建通过；整个工作区尚不能报告为全量检查通过，需由项目管理任务继续修复上述两个类型错误及两个失败断言。
