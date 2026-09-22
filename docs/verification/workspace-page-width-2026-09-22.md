# 工作区页面铺满可用宽度（2026-09-22）

移除 `.page-content` 与 `.feature-page` 的 1480px 宽度上限；页面占满侧栏右侧的可用区域，桌面沿用管理后台的左右 38px、顶部 36px 留白。小窗口保留左右 16px 留白，并修正项目批量操作挤压空间标签的问题。未修改其他助理负责的资产逻辑。

## 浏览器检查

```text
node node_modules/@playwright/test/cli.js test --config=.tmp/workspace-page-width.playwright.config.ts
3 passed (24.4s)
```

使用隔离模拟接口，在 1920px、2560px、390px 窗口下逐一检查全部项目、标签库、提示词库、技能库、队列、图片生成、资产库。验证容器占满主区、边距正确、项目网格铺满内部宽度，无页面运行异常。已查看桌面和小窗口实际截图。

追加小窗口项目操作栏调整后再次验证：

```text
node node_modules/@playwright/test/cli.js test --config=.tmp/workspace-page-width.playwright.config.ts --grep "390px"
1 passed (7.8s)
```

## Studio 检查

直接使用已安装工具运行，避免包管理器改写共享工作区锁文件。

```text
node apps/studio/node_modules/vitest/vitest.mjs run --config apps/studio/vite.config.ts
Test Files  191 passed (191)
     Tests  1261 passed (1261)
```

```text
node apps/studio/node_modules/vite/bin/vite.js build --config apps/studio/vite.config.ts
✓ built in 3.48s
```

类型检查在 `apps/studio` 执行，仍被已有资产模块问题阻塞：

```text
node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
client/src/features/assets/model/zip.ts(38,81): error TS2322: Type 'Uint8Array<ArrayBufferLike>' is not assignable to type 'BlobPart'.
```

该文件不在本次修改范围。类型检查不记为通过。修改文件的 `git diff --check` 通过。
