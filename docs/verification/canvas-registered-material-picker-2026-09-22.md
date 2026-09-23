# 画布资产选择器：拟真人素材

## 交付范围

- 在「从资产库插入节点」分类栏加入「拟真人素材」。
- 使用与画布注册一致的用户接口 `GET /api/ai/seedance-assets`，携带工作区与独立 Provider 标识，不调用管理员素材列表。
- 读取 SD-video 及可用拟真人视频模型对应 Provider 的真实注册记录；已有节点引用的 Provider 也纳入读取。逐页读取，支持搜索、重新查询、错误提示和部分服务失败时保留其他可用结果。
- 处理中、注册失败、缺失源文件的记录显示状态并禁止插入。
- 多选插入独立图片/视频节点，保存真实媒体地址与注册 ID、上游 ID、Provider、状态和来源指纹；不把注册 ID 冒充普通资产 ID，不持久化临时 Blob URL。
- 引用插入节点时，既有生成上下文继续携带 `seedanceVolcanoAssets`，支持后续使用注册素材引用。
- 不变更后端接口、权限或仓库逻辑。不提交、不推送。

## 自动验证

在 `D:\AImanju4.0` 执行。pnpm 检查使用 `--config.verify-deps-before-run=warn`，未重新安装或改动依赖。以下摘录为实际输出。

### Studio

```text
pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio check
$ tsc --noEmit
exit_code: 0

pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio test
Test Files  192 passed (192)
Tests       1275 passed (1275)

pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio build
vite v7.3.6 building client environment for production...
2269 modules transformed.
built in 3.32s
exit_code: 0
```

包含新增的多页/多 Provider 读取、多选插入、图片/视频生成引用保留、注册状态、工作区搜索、失败重试、取消旧查询和部分服务失败测试。

已有提示：pnpm 依赖目录与锁文件不同步、旧 `pnpm.overrides` 配置被忽略；Director Desk 构建存在大体积分包提示。均未阻断构建。

### 浏览器回归

```text
node node_modules/.pnpm/@playwright+test@1.62.1/node_modules/@playwright/test/cli.js test --config .tmp/asset-picker.playwright.config.ts
8 passed (31.1s)
```

使用真实应用 UI 与隔离的模拟 API，不写入用户项目、不调用付费生成接口。此验证不是使用用户登录账号的线上素材验收。

- 原资产库：1440x900、1024x600、390x844、320x568 下的缩略图布局、多选插入、搜索、空状态。
- 拟真人分类：1440、390、320px 下搜索、真实接口结构记录展示、处理/失败状态不可选、多选插入、保存注册元数据、刷新恢复。
- 已查看桌面与 320px 截图；分类正常换行、无横向溢出，插入按钮可见。
- 截图位于 `.tmp/asset-picker-qa/`，只包含测试素材。

### 其他模块

Go 使用现有本地工具链 `.tmp/canvas-quality-qa/go-runtime/go/bin/go.exe`，`GOMODCACHE` 指向 `.tmp/canvas-quality-qa/gomodcache`，工作目录 `apps/api`。

```text
go build ./... -> exit_code: 0
go vet ./...   -> exit_code: 0
go test ./...  -> exit_code: 0
ok github.com/ai-manju/api/internal/handler    14.624s
ok github.com/ai-manju/api/internal/repository 0.221s
ok github.com/ai-manju/api/internal/router     1.555s
ok github.com/ai-manju/api/internal/service    2.903s

pnpm --config.verify-deps-before-run=warn --filter @basketikun/canvas-agent test
tests 4; pass 4; fail 0

pnpm --config.verify-deps-before-run=warn --filter @ai-manju/director-desk test
Test Files 87 passed (87)
Tests      686 passed (686)
```

Worker 使用 `.tmp/canvas-quality-qa/worker-venv/Scripts/python.exe`，工作目录 `apps/worker`。

```text
python -m compileall worker -> exit_code: 0
python -m unittest discover -s tests
Ran 105 tests in 1.407s
FAILED (failures=9, errors=17, skipped=2)
```

失败集中在 `test_image_output_validation` 的图片可读性/尺寸预期，以及 `test_runtime` 使用 Windows 不提供的 `signal.SIGKILL`。本任务没有编辑 Worker 或其测试，因此不能报告全项目测试通过。

## 工作区保护

开发期间存在其他会话对 `seedanceRegistration.ts`、其测试及 `CanvasWorkspaceContent.tsx` 注册弹窗处理的修改。保留这些更改；本任务只在后者的资产控制器绑定处增加 Provider 列表读取。
