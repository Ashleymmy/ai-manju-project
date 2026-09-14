# 画布新建节点后原节点文字消失修复验收

日期：2026-09-11

## 原因与修改

用户复现路径：在原节点检查器输入提示词，新建一个空节点，再选回原节点，检查器显示空白。

根因在共享组件 CanvasResourceMentionTextarea：它把 editorValueRef 的空字符串当作未初始化，在 render 中先改为传入原文；随后同步 effect 比较 ref 与传入值，误判为内容未变化，跳过更新真正驱动 textarea 的 editorValue。新节点为空、原节点有文本时即可稳定触发。最初节点内容没有被新建操作清除，但在错误的空白编辑框继续输入会使新输入覆盖原内容。

修复仅涉及该共享输入组件：ref 与显示状态从同一编辑模型初始化；外部值改变时通过统一的同步过程更新 ref、显示文字与引用片段。移除 render 中依据“是否为空”进行的初始化，以及多余的 ref 回写。检查器和节点内联编辑共用此组件，页面样式、节点新建逻辑与存储格式保持不变。

## 回归测试

新增 4 项组件交互测试，修复前均失败，修复后均通过：

- 纯文本：原节点 → 新空节点 → 原节点，恢复原文，继续输入保留原文。
- 带 @ 节点引用的文本：相同切换流程，同时保留引用显示与 canonical token。
- 初始空编辑框异步加载画布内容后正确显示。
- 清空内容再撤销恢复，正确显示原文，不额外发出内容更新。

## 实际网页验收

在独立临时画布“节点文字回归验证-20260911-1332”（proj_10c1c9144f890bd1）完成：

1. 文本节点输入“文本节点原文：冬天雪景，广阔宁静的雪地。”。
2. 新建图片节点并输入“图片节点提示词：生成一个冬天雪景，覆盖白雪的松树林和远处山脉。”。
3. 再新建一个空图片节点，选回第一个图片节点，检查器显示完整原提示词。
4. 追加“继续追加：冷色调自然光。”后选回文本节点，其原文仍完整。
5. 保存、返回首页、重新打开同一画布，文本原文与图片原提示词加追加内容均完整保留；已检查实际截图。
6. 验收完成后仅删除上述临时画布及其快照，未修改用户已有画布；未提交图片或文本生成任务。

## 验证环境与范围

使用项目已安装的 pnpm，禁用命令自动切换版本；未更改依赖或锁文件。当前改动只有 Studio，重新运行全部类型检查、测试、构建，并执行 git diff --check。后端、Canvas Agent、Director Desk、Worker 本次未修改，沿用本会话已完成的验证，实际输出见 AUTH-REGISTRATION-VALIDATION-2026-09-11.md 与 CHAT-MODEL-SELECTOR-VALIDATION-2026-09-11.md。

## 实际输出

### 修复前的复现测试（退出 1）

```text
       |                              ^
     86|     expect(onChange).toHaveBeenCalledTimes(1);
     87|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/4]⎯

 Test Files  1 failed (1)
      Tests  4 failed (4)
   Start at  13:23:18
   Duration  1.04s (transform 86ms, setup 0ms, collect 171ms, tests 82ms, environment 510ms, prepare 82ms)

D:\AImanju4.0\apps\studio:
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  ai-manhua-studio@1.0.0 test: `vitest run "src/components/canvas/CanvasResourceMentionTextarea.test.tsx"`
Exit status 1
```

### 修复后的定向测试（退出 0）

```text

> ai-manhua-studio@1.0.0 test D:\AImanju4.0\apps\studio
> vitest run "src/components/canvas/CanvasResourceMentionTextarea.test.tsx"


 RUN  v2.1.9 D:/AImanju4.0/apps/studio/client

 ✓ src/components/canvas/CanvasResourceMentionTextarea.test.tsx (4 tests) 90ms

 Test Files  1 passed (1)
      Tests  4 passed (4)
   Start at  13:23:59
   Duration  992ms (transform 81ms, setup 0ms, collect 168ms, tests 90ms, environment 488ms, prepare 72ms)


```

### Studio check（退出 0）

```text

> ai-manhua-studio@1.0.0 check D:\AImanju4.0\apps\studio
> tsc --noEmit


```

### Studio test（退出 0）

```text
 ✓ src/features/auth/AuthPage.test.tsx (5 tests) 117ms
 ✓ src/features/admin/controllers/useSeedanceAssetsController.test.tsx (2 tests) 60ms
 ✓ src/components/canvas/CanvasResourceMentionTextarea.test.tsx (4 tests) 105ms
 ✓ src/components/AgentPanel.test.tsx (3 tests) 103ms
 ✓ src/features/canvas/ui/CanvasNodeCard.test.tsx (5 tests) 28ms
 ✓ src/features/chat/ChatPage.test.tsx (4 tests) 205ms

 Test Files  108 passed (108)
      Tests  519 passed (519)
   Start at  13:25:21
   Duration  4.51s (transform 11.19s, setup 0ms, collect 31.34s, tests 2.01s, environment 10.48s, prepare 10.80s)

```

### Studio build（退出 0）

```text
../dist/public/assets/index-CEZUqAIt.js                           42.14 kB │ gzip:  14.27 kB
../dist/public/assets/index-BsLhAXOJ.js                           46.83 kB │ gzip:  15.48 kB
../dist/public/assets/index-CxjAbB4O.js                           47.43 kB │ gzip:  13.62 kB
../dist/public/assets/index-BTwCZ3Xh.js                           77.97 kB │ gzip:  21.56 kB
../dist/public/assets/styles-DHYzxajY.js                          89.28 kB │ gzip:  29.75 kB
../dist/public/assets/CanvasPage-BXlfSeIs.js                     312.76 kB │ gzip:  95.09 kB
../dist/public/assets/index-BPjVp5Zg.js                          355.13 kB │ gzip: 113.35 kB
✓ built in 2.75s
```
