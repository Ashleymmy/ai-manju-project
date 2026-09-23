# 画布批量注册拟真人素材（2026-09-22）

框选多个节点后，在节点、空白选区或分组上右击，可选择「批量注册拟真人素材」。一次选择目标模型，后台处理所有有图片内容的节点；提示跳过的非图片及空节点数量。复用单张注册接口与节点状态，保留原有单张后台注册体验。

同一图片的单张和批量操作共享锁；排队时也不能重复提交。每批最多同时处理 3 张，单张失败继续其余项，完成后汇总成功、处理中、失败与跳过数量。再次批量提交会跳过同供应商已成功或正在注册的图片。切换画布后已接受的任务继续处理，但不向另一画布或已换图节点写回旧状态。

## 验证

使用已安装工具直接检查，以免包管理器改写共享工作区锁文件。

```text
node apps/studio/node_modules/vitest/vitest.mjs run --config apps/studio/vite.config.ts
Test Files  193 passed (193)
     Tests  1294 passed (1294)
```

单测新增批量并发上限、排队锁、防重复提交、部分失败后继续、仅重试失败节点、切换画布防止过时写回、右击保留框选与排队按钮反馈。

浏览器验证全部使用模拟接口，无真实上传注册或用户数据修改：

```text
node node_modules/@playwright/test/cli.js test --config=.tmp/canvas-batch-registration.playwright.config.ts
4 passed (24.1s)
```

包含两条原有单张注册回归、框选后右击节点与空白处的两条批量流程。验证 2 张图片、1 个文字节点及 1 个空图片混选，只上传两张，选择同一供应商，立即关闭确认窗，重复提交不增加请求数，单张失败后再次提交只上传失败项。

补充分组入口验收（避开节点浮动工具栏的点击区域）：

```text
node node_modules/@playwright/test/cli.js test --config=.tmp/canvas-batch-registration.playwright.config.ts --grep "group context"
1 passed (5.8s)
```

已查看右键菜单和批量确认窗实际截图。

最终构建：

```text
node apps/studio/node_modules/vite/bin/vite.js build --config apps/studio/vite.config.ts
✓ built in 4.73s
```

类型检查仍受共享工作区资产模块已有错误影响，本次未修改该文件：

```text
node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
client/src/features/assets/model/zip.ts(38,81): error TS2322: Type 'Uint8Array<ArrayBufferLike>' is not assignable to type 'BlobPart'.
```

`git diff --check` 通过。
