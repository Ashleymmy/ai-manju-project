# 生成期间画布节点丢失修复

用户截图：`codex-clipboard-00e07fe5-2e87-44cd-b987-0d4a638fb429.png`、`codex-clipboard-f3824fc2-3766-4561-bf86-02bfded9281f.png`。问题是视频准备生成期间新建的图片、文本节点在进入生成后消失。

## 根因

`CanvasGenerationJobsController.generateVideoFromNode` 在点击时捕获整张画布的 `nodes/edges`，随后异步解析引用、下载媒体、读取元数据。准备完成后仍使用旧数组构造 `pendingNodes/pendingEdges` 并覆盖实时画布。因此等待期间新增节点被移除、已有节点编辑被回退、删除的节点/连线可能被恢复，旧快照还会随后保存到服务端。这与截图从“正在准备生成”进入“生成中 20%”时丢失节点的时机一致。

文本、音频入口有同类旧数组回写；图片入口虽然已读取当前节点集合，但准备结束仍可能使用旧源节点位置、尺寸和用户元数据。结果完成和进度更新路径本来按目标 ID 更新实时集合，本次审查并通过浏览器验证了这些阶段。

## 修复

- 新增统一的 `currentGenerationGraph`：异步准备之后重新确认项目、源节点仍存在，并同步读取实时节点/连线。四类生成入口以当前图构造待生成节点，异步任务只保留提交时所需的提示词、参数和素材，不用旧画布快照回写。
- 生成节点保留等待期间最新的位置、尺寸及用户元数据；无关节点的新增、内容修改、删除和连线变化保持不变。独立任务即使反序结束，也不回退已完成任务的节点结果。
- 引用解析完成后检查源节点是否已删除。真正请求生成前再次检查目标和项目，防止保存等待期间已删除的节点仍提交任务。正常取消/删除不弹出解析错误。
- 准备结束只在用户仍选中源节点时选择对应结果节点；已经开始编辑其他节点时，不抢回选中状态和面板。
- 审查自动保存控制器：保存请求串行执行，服务端响应只更新保存状态和版本，不将旧响应重新应用到编辑中的图。浏览器验证包含保存后的刷新恢复。

本轮产品代码仅修改 `apps/studio/client/src/features/canvas/controllers/generation-jobs/controller.ts`；在已有 controller 测试追加回归，新增浏览器用例。保留同文件中上一轮素材预检及其他助手的节点命名、批次修改。无 API、Worker、仓库层改动，无 Memory/Gorm 行为差异；未提交、部署、重启服务或修改真实项目。

## 验证

日志目录：`D:\AImanju4.0\.tmp\canvas-generation-isolation-20260923\`。

### 修复前复现与专项回归

先加入四类节点的并发编辑/删除源节点用例，修复前实际输出：

```text
Test Files 1 failed (1)
Tests 8 failed | 66 skipped (74)
```

原故障分别表现为新增节点丢失、源节点位置回退、删除源节点后仍读取素材或恢复音频节点。随后补充反序并发视频和保存期间删除目标的检查。最终 controller + autosave 实际输出：

```text
✓ src/features/canvas/controllers/autosave.test.ts (5 tests)
✓ src/features/canvas/controllers/generation-jobs/controller.test.ts (79 tests)
Test Files 2 passed (2)
Tests 84 passed (84)
```

本轮新增 13 个 controller 用例覆盖：四种生成类型期间新增/编辑/删除/连线/源节点拖动/选中状态保留（4）；解析引用时删除源节点不恢复或提交（4）；保存期间删除目标不提交（4）；两个视频任务反序完成且保留新节点和连线（1）。自动默认名称仍按现有命名规则排序，独立性测试用固定自定义名排除命名排序变化。

### 浏览器连续操作

用例：`apps/studio/e2e/canvas-generation-isolation.spec.ts`。Chrome、现有 3100 服务。所有 API 与生成任务均为测试接管，不触及真实账户、项目、费用或生成服务。

先让素材预检通过，再使用浏览器虚拟时钟使读取缓存过期，暂停实际 PNG 的读取请求，复现“正在准备生成”窗口。期间新增图片、编辑旧文本、删除其他文本及连线；放行准备后暂停任务接收，继续新增文本；收到任务后再编辑文本，最后返回模拟成功结果并刷新页面。

断言涵盖：所有新增节点仍在；两次文本编辑均保留；被删除节点和连线未恢复；生成只提交一次；结果节点成功；刷新后节点和内容仍在；无页面运行异常。

实际输出：

```text
ok 1 ... editing the canvas during video preparation, acceptance and completion survives reload (7.9s)
1 passed (8.5s)
```

首次浏览器试跑修正测试素材的相对路径；第二次因提示词面板遮挡删除目标，改为正常关闭面板后点击，未用强制点击绕过界面。最终截图已查看：`browser/canvas-generation-isolatio-d4365--completion-survives-reload/concurrent-nodes-preserved.png`。模拟成功返回的是资产记录，这个测试验证状态和数据保留，不验证生成视频的播放质量。

### 全项目规定检查

Studio 使用现有 pnpm CLI，`npm_config_manage_package_manager_versions=false`，执行 `--filter ai-manhua-studio check/test/build`，全部退出 0。实际输出：

```text
> ai-manhua-studio@1.0.0 check D:\AImanju4.0\apps\studio
> tsc --noEmit

Test Files 217 passed (217)
Tests 1552 passed (1552)
Duration 11.90s

✓ built in 6.53s
```

构建保留既有部分 chunk 大于 500 kB 的提示，构建成功。

API 使用已有 Go runtime 和模块缓存执行 `go build ./...`、`go vet ./...`、`go test ./...`。实际输出摘录：

```text
build=0 vet=0 test=0
ok github.com/ai-manju/api/internal/handler (cached)
ok github.com/ai-manju/api/internal/middleware (cached)
ok github.com/ai-manju/api/internal/provider (cached)
ok github.com/ai-manju/api/internal/repository (cached)
ok github.com/ai-manju/api/internal/router (cached)
ok github.com/ai-manju/api/internal/service (cached)
```

其他包通过或无测试；完整输出见 `api-test.log`。build/vet 无输出，退出 0。

Canvas Agent / Director Desk 执行各自规定 test 命令：

```text
canvas-agent=0 director-desk=0
Canvas Agent: tests 4; pass 4; fail 0
Director Desk: Test Files 87 passed (87); Tests 689 passed (689)
```

Worker 使用现有镜像、只读挂载源码，临时目录补充 httpx 后执行 `python -m compileall -q worker` 和 `python -m unittest discover -s tests`：

```text
Ran 118 tests in 2.014s
OK (skipped=2)
```

`git diff --check` 退出 0。

本次是本地防止覆盖的修复；没有访问或恢复用户线上已丢失的节点，不把测试中的刷新保留结果等同于线上历史数据已恢复。
