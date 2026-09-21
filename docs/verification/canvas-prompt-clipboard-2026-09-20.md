# Canvas 提示词复制保留图片引用验收

## 范围与根因

同一画布内，从节点下方提示词框复制或剪切文字与多张 @ 图片，粘贴到其他节点提示词框后保留图片引用、缩略图和生成参考。没有新增画布节点或连线，不改变生成接口，不自动导入跨画布素材。

编辑器使用 textarea 与缩略图覆盖层，textarea 内图片原本是空白占位符，实际引用保存在独立片段中。浏览器默认复制只得到占位符，导致粘贴后引用丢失。

## 修复内容

- 共享编辑器在复制、剪切时按选区恢复真实引用标记，写入纯文本剪贴板；粘贴时恢复引用片段及缩略图。
- 图片引用作为整体处理，部分选中图片时复制完整引用；多个相同占位符按明确选区位置替换，避免引用错位。
- 保留混合文字、换行、多图和重复引用；兼容已有“复制提示词”按钮。
- 普通纯文字、文件粘贴仍走原有路径；尊重外部事件阻止、只读状态与输入法组合状态。剪贴板写入失败时不删除剪切源内容。
- 已失效引用保留原标记，由现有失效引用规则处理，不伪造素材或替换引用对象。

## 自动验证实际输出

Studio 与 Agent 使用已有依赖，pnpm 命令附加 `--config.verify-deps-before-run=warn`，未安装依赖或修改锁文件。

```text
pnpm --filter ai-manhua-studio check
tsc --noEmit
Exit code: 0

pnpm --filter ai-manhua-studio test
Test Files  180 passed (180)
     Tests  1145 passed (1145)
  Duration  8.68s

pnpm --filter ai-manhua-studio build
Director Desk: built in 3.96s
Studio: built in 3.06s
Exit code: 0

pnpm --filter @basketikun/canvas-agent test
tests 4
pass 4
fail 0

pnpm --filter @ai-manju/director-desk test
Test Files  87 passed (87)
     Tests  686 passed (686)
  Duration  90.00s
```

新增 7 项引用选区领域测试、6 项共享编辑器测试，覆盖复制、剪切、粘贴、失败保护、只读、重复占位符、混合资产引用和换行。

后端在 `apps/api` 复用已有 `.tmp/canvas-quality-qa/go-runtime/go/bin/go.exe`，模块缓存为 `.tmp/canvas-quality-qa/gomodcache`：

```text
go build ./...: exit 0
go vet ./...: exit 0
go test ./...: exit 0, cached
```

Worker 在 `apps/worker` 使用已有 `.tmp/canvas-quality-qa/worker-venv/Scripts/python.exe`：

```text
python -m compileall worker
Listing 'worker'...
Exit code: 0

python -m unittest discover -s tests
Ran 82 tests in 0.209s
FAILED (errors=1, skipped=2)
AttributeError: module 'signal' has no attribute 'SIGKILL'
```

Worker 唯一错误是既有 `test_shutdown_has_shared_deadline_and_kills_stuck_pool` 在 Windows 上的兼容问题，本次未修改 Worker。构建仍有既有 pnpm 配置、依赖与锁文件不同步以及 Director Desk 大 chunk 提示。

## 浏览器验收

```text
node node_modules/.pnpm/@playwright+test@1.62.1/node_modules/@playwright/test/cli.js test --config .tmp/prompt-clipboard.playwright.config.ts

config passed 5.3s
image passed 5.3s
video passed 6.4s
text passed 5.5s
4 passed (23.1s)
```

使用独立 Chrome 上下文和模拟 API，沿用本地 3100 服务，不修改用户真实项目，不调用付费生成。

- 真正执行 Ctrl+A/C/V，将文字与两张图片引用分别粘贴到配置、图片、视频、文本节点，确认缩略图、原始引用标记和换行保留。
- 验证单图选区剪切后粘贴、已有复制提示词按钮、保存刷新后恢复；画布节点和连线数量不变。
- 配置节点与图片节点发起模拟生成，确认请求包含两个图片文件及其 PNG 内容。
- Windows 剪贴板读取会将 LF 转为 CRLF，首次测试仅因此比较失败；测试改为规范化换行后四项通过，应用粘贴路径也规范化 CRLF。
- 系统右键菜单未单独自动化实测，使用同一组原生 copy/cut/paste 事件处理。

截图在 `.tmp/prompt-clipboard-qa/`，分别为四种目标节点的 `pasted-*-references.png`。已目视核对配置节点提示词框：两张缩略图与文字、换行正常显示。

`git diff --check` 通过。未提交、推送、部署或重启已有服务。
