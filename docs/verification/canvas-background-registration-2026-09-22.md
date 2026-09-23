# 画布拟真人素材后台注册验证（2026-09-22）

## 修复范围

- 注册窗口只负责选择模型。点击“后台注册 / 更新状态”后立即收起，原图读取、上传及状态查询在后台继续。
- 去掉全画布注册锁和常驻加载通知；按项目、节点、图片来源防止重复提交，不同节点可分别注册。
- 节点保留上传/处理进度，注册成功或失败显示短通知；失败后可重试，已有处理记录按 ID 查询，不重复上传。
- 后台任务完成不会关闭后来打开的窗口。切换项目、删除节点或替换图片后，迟到结果不会写入错误节点；离开原画布后结束的任务会清除旧进度，避免返回时卡住。
- 上传返回的素材状态仍写入节点元数据及画布快照；原图临时 URL 在读取完成后释放。

本次文件：`CanvasWorkspaceContent.tsx` 的注册流程、`controllers/useCanvasSeedanceRegistration.ts` 及测试、`services/seedanceRegistration.ts` 及测试、`e2e/canvas-background-registration.spec.ts`。保留其他任务并行改动，没有提交、部署或重启共享服务。

## 验证结果（实际输出摘要）

Studio 类型检查：`pnpm --filter ai-manhua-studio check`，退出码 0。

```text
$ tsc --noEmit
```

Studio 全量测试：`pnpm --filter ai-manhua-studio test`，退出码 0。

```text
Test Files  193 passed (193)
     Tests  1289 passed (1289)
  Duration  9.54s
```

Studio 构建：`pnpm --filter ai-manhua-studio build`，退出码 0。

```text
../dist/public/assets/CanvasPage-Dc9IulxY.js  339.39 kB | gzip: 104.28 kB
✓ built in 3.78s
```

注册逻辑的专项验证包含：上传 Promise 未返回时窗口立即收起、重复提交拦截、多节点并发、新窗口不被旧任务关闭、失败重试、切换项目/替换图片/删除节点/组件卸载后不误写、超过 30 秒继续查询、复用已有记录。服务/控制器/按钮专项运行结果为 `3 passed` / `20 passed`。

浏览器回归：隔离配置 `.tmp/registration-check/playwright.config.ts`，Chrome headless，1440 × 900。

```text
ok submitting closes the modal during a slow upload and success never closes a later dialog
ok background failure reports the error and unlocks the original node for retry
2 passed (13.1s)
```

测试使用实际画布组件，拦截全部业务 API。延迟上传响应时验证弹窗已消失、第二节点仍可操作；放行响应后验证后台轮询、成功通知及快照中的 Active 状态。没有调用实际服务商注册，也没有修改用户项目。

API：独立 `golang:1.23-alpine` 容器只读挂载 `apps/api`，执行 `go build ./... && go vet ./... && go test ./...`，退出码 0。初次默认代理下载遇到 EOF，改用 `GOPROXY=https://goproxy.cn,direct` 后完成。

```text
ok github.com/ai-manju/api/internal/handler     14.190s
ok github.com/ai-manju/api/internal/repository   0.009s
ok github.com/ai-manju/api/internal/router       1.363s
ok github.com/ai-manju/api/internal/service      0.143s
ok github.com/ai-manju/api/internal/storage      0.038s
```

Canvas Agent：`pnpm --filter @basketikun/canvas-agent test`，退出码 0。

```text
tests 4
pass 4
fail 0
```

Director Desk：`pnpm --filter @ai-manju/director-desk test`，退出码 0。

```text
Test Files 87 passed (87)
     Tests 686 passed (686)
```

Worker：独立 `ai-manju-40-worker` 临时容器只读挂载源码，在临时目录补齐镜像缺少的 httpx。执行 `python -m compileall -q worker && python -m unittest discover -s tests`，退出码 0。

```text
Ran 105 tests in 3.963s
OK (skipped=1)
```

`git diff --check` 退出码 0。pnpm 自动删除的锁文件 overrides 已精确恢复。

## 验证边界

- 本次解决当前浏览器会话内的阻塞交互，没有新增刷新页面/关闭浏览器后可恢复的持久任务队列。
- 状态查询间隔 5 秒，最多 60 次；超出查询次数仍未完成会说明“仍在处理中”，用户可在真人素材库查看或按已保存 ID 刷新，不虚报成功。
- 切换到其他页面后仍可收到本会话任务结果通知，但不会跨页面直接改写已离开的画布快照。
- 实际服务商注册速度、可用性及线上部署不在本次模拟测试的证明范围内。
