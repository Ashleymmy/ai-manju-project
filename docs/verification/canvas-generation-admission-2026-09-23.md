# 画布批量生成数量与任务排队验收

后续按用户要求，数量菜单已恢复原有 ×1、×2、×4、×6 的单行快捷选项和计费说明；批次生成及并发排队修复保留。下述 1–15 菜单记录为此前验收状态，以本段为最新设计。

恢复后的验收：Studio 类型检查退出码 0；全量测试 `Test Files 214 passed (214)`、`Tests 1483 passed (1483)`；构建 `✓ built in 13.01s`；Chrome 图片回归 `1 passed (10.9s)`，确认原有四个选项单行显示，选择 ×6 实际完成六张图片（模拟并发上限 2）。已目视检查恢复后的菜单。`git diff --check` 与 `git diff --cached --check` 均通过。对应底层命令同下文，页面回归增加 `--grep image`。

## 排查结论与改动

- 截图的“当前任务并发已达上限”来自项目后端的任务准入检查，不是模型“每批最多四张”的错误。画布实际为每张图片单独提交 `n=1`。未通过真实供应商消耗积分验证其具体能力。
- 数量菜单原来只有 1、2、4、6；现开放 1–15，五列显示，与已有图片批次数量上限一致，常量集中定义。
- 修复已有图片批次再次生成时只提交根节点的问题：复用已有结果位置、按所选数量扩展批次；被覆盖的结果写入历史。减少数量时，旧子图作为独立节点保留。
- 图片、视频、文本、音频共用按能力分开的提交队列。异步图片/视频任务一旦获准，立即释放提交队列供下一项申请；容量不足时仅队首等待，避免整批重复冲击准入接口。同步文本/音频请求顺序执行。
- 只重试明确的并发准入 429，图片与视频重试保持同一幂等键。余额不足、供应商额度错误、网络状态不明等错误不自动重放；单次容量等待最长 30 分钟。
- 等待节点显示“排队等待中”，取消、删除节点与切换画布沿用现有 AbortSignal。队列位于当前页面内存中；已经受理的服务端任务继续走现有持久化和恢复机制。
- 本任务未调整会员并发额度、后端仓库或 Worker。工作期间共享仓库同步了上游视频队列修复，已保留。

## 实际验证结果

直接调用已安装的项目工具，执行 Studio check/test/build 及 build:deps 底层命令，避免包管理器改写共享依赖文件。

1. Studio：`node node_modules/typescript/bin/tsc --noEmit`（目录 `apps/studio`），退出码 0，无错误输出。
2. 全量测试：`node apps/studio/node_modules/vitest/vitest.mjs run --config apps/studio/vite.config.ts`。

   ```text
   Test Files  214 passed (214)
        Tests  1483 passed (1483)
     Duration  11.15s
   ```

   聚焦队列、控制器及图片/视频/文本/音频 API 的 109 项测试全部通过。覆盖所有能力的六项批量排队、取消队首与待提交项、后续任务不阻塞、真实错误不重试、容量等待超时、视频两个协议的幂等键、15 张批次再生成与缩减时保留旧结果。

3. 构建依赖：`packages/canvas-agent-protocol` 下执行 `node node_modules/typescript/bin/tsc -p tsconfig.json`，退出码 0；`apps/director-desk` 下执行 `node node_modules/typescript/bin/tsc -b` 和 `node node_modules/vite/bin/vite.js build`，退出码均 0，构建输出 `✓ built in 3.88s`。
4. Studio 构建：`node apps/studio/node_modules/vite/bin/vite.js build --config apps/studio/vite.config.ts`，退出码 0，最终输出 `✓ built in 6.29s`。保留现有大文件分包提示。
5. Chrome 页面回归：`node node_modules/@playwright/test/cli.js test --config .tmp/canvas-generation-admission.playwright.config.ts`。

   ```text
   2 passed (22.8s)
   ```

   使用隔离模拟接口：图片允许同时 2 个任务，选择 6 张后全部成功；视频允许同时 1 个任务，3 个节点依次全部成功。核对排队文字、最终保存结果、唯一资产、无重复受理、没有页面运行错误。数量菜单最终样式另行回归：`--grep image`，`1 passed (11.2s)`，确认十五个选项、五列排布；已目视检查菜单和视频排队截图。
6. `git diff --check` 与 `git diff --cached --check` 均无错误输出。

共享代码更新期间曾出现其他页面的跨模块引用检查失败；相关修改同步后，最终全量测试已全部通过。未改动这些页面。
