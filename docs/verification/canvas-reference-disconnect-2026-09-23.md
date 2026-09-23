# 画布素材缩略图断开连线验收

日期：2026-09-23

## 行为

- 所有类型节点共用的前置素材缩略图增加悬停显示的右上角 ×。键盘聚焦时也显示，触屏设备保持显示。
- 点击 × 删除该素材来源到当前节点的连线，保留节点、其他连线及提示词；缩略图原有的点击引用功能继续可用。
- 使用现有画布状态、撤销和自动保存流程。

## 验证

直接调用项目已安装的对应工具，执行 Studio check、test、build 及 build:deps 的底层命令，避免包管理器包装器改动共享依赖文件。

1. Studio 类型检查，目录 `apps/studio`：`node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`。项目指定 TypeScript 5.6.3，退出码 0，无错误输出。
2. Studio 全量测试，仓库根目录：`node apps/studio/node_modules/vitest/vitest.mjs run --config apps/studio/vite.config.ts`。

   ```text
   Test Files  200 passed (200)
        Tests  1357 passed (1357)
     Duration  10.79s
   ```

   其中 Inspector 的 25 项测试通过；新增参数化断线测试覆盖 image、video、audio、text、prompt、note、config、director，验证目标参数以及不误触引用、预览、生成。
3. 构建依赖：`packages/canvas-agent-protocol` 下执行 `node node_modules/typescript/bin/tsc -p tsconfig.json`，退出码 0；`apps/director-desk` 下执行 `node node_modules/typescript/bin/tsc -b` 和 `node node_modules/vite/bin/vite.js build`，均退出码 0，输出 `✓ built in 7.96s`。
4. Studio 构建，仓库根目录：`node apps/studio/node_modules/vite/bin/vite.js build --config apps/studio/vite.config.ts`，退出码 0，输出 `✓ built in 4.42s`。构建保留既有大文件分包提示。
5. Chrome 页面回归：`node node_modules/@playwright/test/cli.js test --config .tmp/canvas-reference-disconnect.playwright.config.ts`。

   ```text
   2 passed (21.5s)
   ```

   使用隔离模拟接口，图片和视频目标节点均验证：× 默认隐藏、悬停显示且处于缩略图内部、点击后对应边消失、其他边和节点保留、提示词不变、自动保存、撤销恢复、再次断线后刷新仍保持。页面未捕获运行错误。已目视检查悬停截图。
6. `git diff --check`：退出码 0，无输出。

补充：最初误用仓库根部 TypeScript 5.9.3 时，资产 ZIP 模块报 `Uint8Array<ArrayBufferLike>` 与 `BlobPart` 不兼容。改用 Studio 自己指定的 5.6.3 检查通过，未修改无关资产模块。
