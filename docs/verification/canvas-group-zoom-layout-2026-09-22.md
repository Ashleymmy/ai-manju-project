# 按标注图调整分组缩放与边框（2026-09-22）

本次取代上一版分组无限补偿缩放的设计：以截图中的 45% 为补偿上限，低于此比例时标题栏及分组按钮随画布缩小。较窄分组进一步限制标题栏放大，避免超出分组宽度。

原先只移动标题栏，边框未跟随，造成二者分离。本次将分组顶部延伸到标题栏，内部预留节点名称的空间；节点及分组数据位置不变，连线端点继续使用成员区域原有坐标。

## 验证

使用已安装的工具直接执行 Studio 检查，避免包管理器修改共享工作区锁文件；未改动其他助理负责的模块。

浏览器验收命令：

```text
node node_modules/@playwright/test/cli.js test --config=.tmp/group-zoom-layout.playwright.config.ts
4 passed (8.9s)
```

用例保存在 `apps/studio/e2e/canvas-group-zoom-layout.spec.ts`，模拟接口隔离真实用户数据，覆盖 100%、45%、25%、5%：

- 标题栏与边框顶部、左右边缘相接。
- 45% 以下标题栏及按钮同比例缩小。
- 图片及视频节点名称不被分组标题栏覆盖。
- 增加标题空间不会偏移连接端点。
- 解绑仍正常，成员节点保留。

已检查 45% 和 25% 实际截图。

Studio 单测：

```text
node apps/studio/node_modules/vitest/vitest.mjs run --config apps/studio/vite.config.ts
Test Files  191 passed (191)
     Tests  1261 passed (1261)
```

最终构建：

```text
node apps/studio/node_modules/vite/bin/vite.js build --config apps/studio/vite.config.ts
✓ built in 4.19s
```

类型检查（在 `apps/studio` 执行）：

```text
node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
client/src/features/assets/model/zip.ts(39,81): error TS2322: Type 'Uint8Array<ArrayBufferLike>' is not assignable to type 'BlobPart'.
```

该错误来自共享工作区资产模块，本次未改动该文件。类型检查不记为通过。`git diff --check` 通过。
