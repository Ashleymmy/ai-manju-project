# 画布生成节点与自定义重名规则

后续需求已更新：空白占位节点也改为 `-1` 连续编号并在删除后补号，生成名称明确取左上角当前画布名称。最新行为与全量通过的验收见 `canvas-placeholder-names-2026-09-24.md`；以下为第一阶段记录。

## 修改方向

按用户最后确认的范围区分“生成结果”“自定义名称”和“新建空白节点”，统一在画布状态及快照保存时处理名称。只改名称，不修改节点 ID、素材 ID、连线、提示词中的 `@[node:...]` 引用或媒体文件格式。

- 未手动命名的生成结果使用画布名加类型及序号，如 `测试image-1`、`测试video-1`、`测试text-1`、`测试audio-1`，各类型独立编号，不再用提示词或服务商文件名命名。
- 删除自动编号节点后，同类型的后续节点顺位补号；将自动节点改为自定义名称后，也会释放原自动序号。
- 手动命名跨类型处理重名：一个 `苹果`；两个为 `苹果-1`、`苹果-2`；删除或改名后补号，只剩一个时恢复 `苹果`。
- 新建空白节点保持旧名称及旧避重格式，例如 `图片占位`、`图片占位（1）`，不参与生成结果编号。导入素材同样保留原有规则；主动重命名时进入自定义重名规则。
- 自动名称随画布改名更新；用户自定义名称不会被画布改名、生成成功、重试失败或中断覆盖。
- 保存用户输入的原始名称，区分用户本来输入的数字和系统追加的序号。遇到用户明确命名 `苹果-1` 或 `测试image-1` 时预留该名称，其他编号跳过占用，避免重名。
- 自动生成节点的复制、粘贴继续参与自动序列；其他副本保留原“副本”命名方式。
- 批量重试原位更新子节点，不再把已有子节点移到数组末尾，避免无关节点的编号变化。
- 节点面板的标题输入改为完成编辑时提交，避免输入过程中自动补号打断输入；中文输入法确认不会提前提交。

## 代码范围

- `canvas/domain/nodeTitles.ts`：分类命名、按类型计数、自定义重名、删除补号及长名称序号显示。
- `canvas/domain/types.ts`：持久化自定义原名、生成结果标记和画布名前缀。
- `canvas/model/store.ts` 与 `CanvasWorkspaceContent.tsx`：初始化、编辑、删除、历史恢复、画布改名、保存统一应用。
- `canvas/domain/generation.ts`、`batch.ts`、生成控制器：四类生成完成与失败处理，批次稳定顺序。
- `canvas/domain/clipboard.ts`、`nodes.ts`、`imageTitles.ts`：副本接入及移除提示词命名。
- `CanvasInspector.tsx`：完整提交标题编辑，保留中文输入法处理。

旧快照中已经标记为手动命名的名称保守保留，不猜测或剥离旧名称中的数字。明确具有生成完成记录的历史节点可进入新规则，仅填写提示词的空白节点不会被误判。

## 实际验收

使用现有本地服务 `http://127.0.0.1:3100`，浏览器内拦截全部应用 API，在独立模拟画布测试，不修改真实用户项目，不调用收费生成服务。

浏览器覆盖双击改名、面板改名、跨节点重名、删除补号、保存刷新、实际新增空白节点、文件导入、复制与 Ctrl+C/Ctrl+V，以及 25% / 5% 缩放下的名称可读性。生成完成和失败由自动化测试模拟服务响应。

```text
pnpm --config.verify-deps-before-run=warn exec playwright test --config apps/studio/e2e/playwright.naming.config.ts
2 passed (35.2s)
```

截图：`test-results/canvas-naming/canvas-generated-names-gen-bdf96-lank-nodes-retain-old-names/generated-and-blank-names.png`，已目视确认生成节点自定义名称与新空白节点“图片占位”并存，无浏览器 pageerror。

### Studio

```text
pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio check
$ tsc --noEmit
退出码 0

pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio test nodeNaming nodeTitles generationTitles batch.test clipboard.test nodes.test model/store.test generation-jobs/controller.test
Test Files  10 passed (10)
     Tests  187 passed (187)

pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio build
✓ built in 6.40s
退出码 0
```

完整 Studio 测试也已运行，当前工作区包含另一项进行中的视频预检改动：

```text
pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio test
Test Files  2 failed | 215 passed (217)
     Tests  2 failed | 1534 passed (1536)
```

剩余失败不属于命名逻辑，未擅自修改对应实现：

1. `app/architecture.test.ts`：新视频预检从 `features/video/services/generationGateway` 直接跨 feature 导入，命中公开入口约束。
2. `video/services/generationGateway.test.ts`：旧测试允许 2.5 模型提交全部参考图，新预检限制为 9 张，报“参考图片最多 9 张”。

pnpm 提示现有依赖与锁文件不同步；本次没有安装或更新依赖。构建保留既有大分块提示，不阻断构建。

### API、Agent、Director Desk、Worker

系统 PATH 未配置 Go，使用仓库已有 `.tmp/canvas-quality-qa/go-runtime/go/bin/go.exe`，在 `apps/api` 依次执行 `build ./...`、`vet ./...`、`test ./...`，均退出 0。实际输出节选：

```text
ok github.com/ai-manju/api/internal/handler 14.699s
ok github.com/ai-manju/api/internal/repository 0.187s
ok github.com/ai-manju/api/internal/router 1.542s
ok github.com/ai-manju/api/internal/service 9.443s
```

```text
pnpm --config.verify-deps-before-run=warn --filter @basketikun/canvas-agent test
tests 4 / pass 4 / fail 0

pnpm --config.verify-deps-before-run=warn --filter @ai-manju/director-desk test
Test Files 87 passed (87)
Tests 689 passed (689)
```

系统 Python 为不可用的 Windows 别名，改用现有 `ai-manju-worker-monitoring:20260923` 镜像，以只读方式挂载 `apps/worker`。编译缓存写容器 `/tmp`，测试禁写字节码；未安装依赖或改动共享服务。

```text
python -m compileall worker
退出码 0
python -m unittest discover -s tests
Ran 118 tests in 1.986s
OK (skipped=2)
```

`git diff --check` 通过。原有连线、面板缩放及视频预检改动均保留。本次无提交、推送、部署或服务重启。
