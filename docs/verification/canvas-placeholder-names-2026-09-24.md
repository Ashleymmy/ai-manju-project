# 占位节点连续编号与当前画布名称

## 最新规则

- 空白节点保留类型标签，从 `-1` 起独立连续编号：`图片占位-1`、`视频片段-1`、`音频轨道-1`、`剧本提示词-1`、`生成配置-1`、`3D 导演台-1`。
- 删除“图片占位-3”后，原来的 `-4`、`-5` 自动变成 `-3`、`-4`；只剩一个时仍为 `-1`。
- 兼容系统默认形式的旧空节点名称：无序号、直接数字及中英文括号编号。旧避重逻辑曾自动写入 titleEdited，迁移时一并处理。
- 复制、Ctrl+C/Ctrl+V、新建、删除、保存和刷新共用编号逻辑。占位节点生成成功后退出占位序列，转入生成结果序列。
- 生成节点前缀来自左上角当前画布名称，不是固定的“测试”。例如“模板1”生成 `模板1image-1`、`模板1video-1`、`模板1text-1`、`模板1audio-1`。
- 画布改名后自动生成名称同步更新，用户自定义名称不变。自定义重名继续使用之前确认的“-1、-2”规则。
- 显式记录自定义名称与占位名称的来源，之后即使用户手动输入类似占位名称的文字，也不会再误作系统默认名。导入素材名保持原规则。

## 修改范围

仅命名领域、节点默认标签来源、复制逻辑、类型定义及对应测试；复用既有状态层与快照保存入口，不变更节点 ID、素材、连线或引用。

## 实际验证

前端在现有 `http://127.0.0.1:3100` 服务验证；浏览器 API 全部模拟隔离，未读写真实用户画布，没有收费生成请求。

```text
pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio check
$ tsc --noEmit
退出码 0

pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio test
Test Files 217 passed (217)
Tests 1539 passed (1539)

pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio build
✓ built in 6.59s

pnpm --config.verify-deps-before-run=warn exec playwright test --config apps/studio/e2e/playwright.naming.config.ts
3 passed (1.1m)
```

浏览器分别使用“测试”“模板1”，实际双击左上角修改画布名，验证自动前缀同步；重现五个旧括号占位节点，真实键盘删除第三个，断言后续自动补号并保存刷新。另覆盖显式改名、新增空节点、导入、复制粘贴和低缩放可读性，无 pageerror。

截图已目视检查：`test-results/canvas-naming/canvas-generated-names-nam-404d9-placeholder-indices-compact/placeholder-delete-compacts.png`。

额外复跑节点命名测试，覆盖旧“视频片段2”样式：`19 passed (19)`。

项目要求的其他检查也已执行：

```text
apps/api: go build ./... / go vet ./... / go test ./...
退出码均为 0；ok github.com/ai-manju/api/internal/handler 14.697s

pnpm --config.verify-deps-before-run=warn --filter @basketikun/canvas-agent test
tests 4 / pass 4 / fail 0

pnpm --config.verify-deps-before-run=warn --filter @ai-manju/director-desk test
Test Files 87 passed (87)
Tests 689 passed (689)

apps/worker: python -m compileall worker
退出码 0
apps/worker: python -m unittest discover -s tests
Ran 118 tests in 1.955s
OK (skipped=2)
```

Go 复用 `.tmp/canvas-quality-qa/go-runtime/go/bin/go.exe`；Worker 复用现有 `ai-manju-worker-monitoring:20260923` 镜像，只读挂载源码、缓存写容器临时目录。未安装依赖、未重启共享服务。已有依赖同步与大分块提示仍在，但不阻断验证。

其他任务的改动保留，`git diff --check` 通过；未提交、推送或部署。
