# Canvas 图片引用边界光标验收

## 问题与修复

用户反馈提示词中连续 @ 图片附近点击后没有光标，尤其是最后一张图片后的空白区域。

浏览器中已复现：点击后 textarea 获得焦点，选区位置正确到达末尾，但 `.canvas-mention-caret` 不存在。原因是浏览器在 inline-flex 图片引用两侧的折叠 Range 不返回几何矩形；旧回退只移动一个占位字符，而图片引用有多个占位字符，会再次吸附到相同 DOM 边界，仍无法测量光标。

修复仅在 `useMentionCaret.ts` 的边界测量中增加回退：折叠 Range 没有矩形时，直接取相邻图片引用的真实左边缘或右边缘，再沿用现有缩放、滚动坐标换算。没有插入额外空格，没有改引用内容、剪贴板格式或生成请求。普通文字与拖选测量保持原路径。

## 回归测试

- 新增 9 项光标测试：首图前、两图间、末图后，分别覆盖 0.5、1、1.5 倍缩放及滚动偏移；模拟浏览器在引用边界返回空 Range 矩形的情况。
- 扩展现有四种节点的浏览器剪贴板测试，验证 6 张连续图片与 24 张纯图片换行场景，包含 100% 和 80% 画布缩放。
- 实际鼠标点击首图、中间图片、末图的左右区域，以及末图之后的空白区域；断言焦点、插入位置、光标可见性和末尾光标坐标。
- 实际在末尾和图片间隙输入文字，断言保存内容与所有引用都正确。
- 继续验证复制、剪切、粘贴、复制提示词按钮、刷新恢复，以及配置节点和图片节点模拟生成请求中的两张图片文件。

## 浏览器实际输出

复现测试在修复前失败，输入位置已正确但光标未绘制：

```text
expect(locator).toBeVisible() failed
Locator: locator('.inspector-panel').locator('.canvas-mention-caret')
Error: element(s) not found
1 failed
```

修复后的完整浏览器验证：

```text
node node_modules/.pnpm/@playwright+test@1.62.1/node_modules/@playwright/test/cli.js test --config .tmp/prompt-clipboard.playwright.config.ts

config passed 15.3s
image passed 15.1s
video passed 14.9s
text passed 14.9s
4 passed (1.0m)
```

使用独立 Chrome 上下文及模拟 API，不修改用户项目，不调用付费生成。截图位于 `.tmp/prompt-clipboard-qa/` 下各测试目录的 `caret-<kind>-trailing.png`、`caret-<kind>-wrapped.png`。已目视检查配置节点的连续 6 图与 24 图换行截图，末尾光标紧贴图片边缘且与图片在同一行。

## 项目验证实际输出

pnpm 复用现有依赖，命令附加 `--config.verify-deps-before-run=warn`，未安装依赖、修改锁文件。

```text
pnpm --filter ai-manhua-studio check
tsc --noEmit
Exit code: 0

pnpm --filter ai-manhua-studio test
Test Files  181 passed (181)
     Tests  1154 passed (1154)
  Duration  8.34s

pnpm --filter ai-manhua-studio build
Director Desk: built in 4.86s
Studio: built in 3.24s
Exit code: 0

pnpm --filter @basketikun/canvas-agent test
tests 4
pass 4
fail 0

pnpm --filter @ai-manju/director-desk test
Test Files  87 passed (87)
     Tests  686 passed (686)
  Duration  89.69s

go build ./...: exit 0
go vet ./...: exit 0
go test ./...: exit 0, cached

python -m compileall worker
Listing 'worker'...
Exit code: 0

python -m unittest discover -s tests
Ran 82 tests in 0.220s
FAILED (errors=1, skipped=2)
AttributeError: module 'signal' has no attribute 'SIGKILL'

git diff --check: exit 0
```

Go 在 `apps/api` 使用已有 `.tmp/canvas-quality-qa/go-runtime/go/bin/go.exe` 与 `.tmp/canvas-quality-qa/gomodcache`。Worker 在 `apps/worker` 使用已有 `.tmp/canvas-quality-qa/worker-venv/Scripts/python.exe`；失败仍是既有 `test_shutdown_has_shared_deadline_and_kills_stuck_pool` 在 Windows 下不支持 `SIGKILL` 的问题，本次未修改 Worker。构建仍有既有 pnpm 配置、依赖同步及 Director Desk 大 chunk 提示。

沿用本地 3100 服务，未提交、推送、部署或重启服务，保留其他未提交修改。
