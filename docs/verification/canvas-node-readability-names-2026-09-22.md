# 节点缩放可读性与统一命名验收

所有节点类型在同一画布内共用名称空间。新建、导入、生成、重命名及读取旧快照时去重；已占用的名称保留，冲突名称自动加数字。复制按钮及快捷键粘贴共用“苹果副本、苹果副本2、苹果副本3”规则，复制副本时继续同一序列。

节点标签超过五个字符时显示前五个字符和省略号；完整名称保存在数据中，并用于悬停提示与重命名。缩小画布时，标题和节点工具栏反向补偿缩放；选中节点提升显示层级，标签使用深色底保证重叠时的可读性。

## 验证结果

使用已安装的工具直接执行，避免本机 pnpm 启动包装流程自动改写锁文件。仅涉及 Studio，没有修改其他助手正在处理的 API、模型或检查器布局逻辑。

类型检查（apps/studio）：

```text
node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
exit_code: 0
```

Studio 全量测试（apps/studio）：

```text
node node_modules/vitest/vitest.mjs run
Test Files  190 passed (190)
     Tests  1247 passed (1247)
```

构建（仓库根目录）：

```text
node apps/studio/node_modules/vite/bin/vite.js build --config apps/studio/vite.config.ts
✓ 2186 modules transformed.
✓ built in 3.81s
```

浏览器回归（本机 Chrome，API 请求全部由隔离测试数据接管）：

```text
node node_modules/@playwright/test/cli.js test --config=.tmp/node-readability.playwright.config.ts
1 passed (11.2s)
```

用例：`apps/studio/e2e/canvas-node-readability-names.spec.ts`。覆盖八种类型的同名节点、连续复制、复制副本、Ctrl+C/Ctrl+V、保存重载、五字显示，以及 25% / 5% 缩放下标题高度、工具栏按钮尺寸、互不遮挡和实际点击。

截图保存在 `.tmp/node-readability-qa/canvas-node-readability-na-05112-ay-readable-when-zoomed-out/readable-at-25.png` 与 `readable-at-5.png`。

`git diff --check` 通过；`pnpm-lock.yaml` 无改动。
