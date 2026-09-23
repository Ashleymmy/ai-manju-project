# 画布视频节点默认 yuntu Seedance Fast（2026-09-22）

画布初始化视频模型时优先选择实时目录中的 `yuntu Seedance Fast`，保留完整供应商模型标识。已有节点保存的模型不变。目标模型未开放时仍回退可用目录默认值，不硬编码供应商 ID，不影响独立视频生成页。

直接调用已安装工具检查，避免改写共享工作区锁文件。

```text
node apps/studio/node_modules/vitest/vitest.mjs run --config apps/studio/vite.config.ts
Test Files  193 passed (193)
     Tests  1286 passed (1286)
```

新增单测覆盖默认 Fast 优先级、同名模型的供应商匹配以及模型不可用时的回退。

```text
node node_modules/@playwright/test/cli.js test --config=.tmp/canvas-video-default-fast.playwright.config.ts
3 passed (24.0s)
```

浏览器验收以模拟接口隔离真实数据和付费生成，验证新建节点显示 Fast、实际提交 Fast、保存刷新后仍使用 Fast；两种已有节点保留原模型，音频和画幅选择未受影响。

```text
node apps/studio/node_modules/vite/bin/vite.js build --config apps/studio/vite.config.ts
✓ built in 9.14s
```

类型检查仍被共享工作区已有资产模块错误阻塞，本次未修改该文件：

```text
node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
client/src/features/assets/model/zip.ts(38,81): error TS2322: Type 'Uint8Array<ArrayBufferLike>' is not assignable to type 'BlobPart'.
```

本次修改的 `git diff --check` 通过。
