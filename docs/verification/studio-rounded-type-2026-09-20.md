# 圆润字体与导航字号微调

## 变更

- 按用户最新反馈，将左侧导航从 14px 调整为 13px；常规导航文字字重 500，分组标题保留较粗层级。
- UI 默认字体改为寒蝉圆黑体 Medium，强调文字使用 Bold，正文默认字重 500。原有标题、正文和统计数字字号不再扩大。
- 两个字体文件随项目本地提供，来源固定到上游版本 `53505f0818983d2fcdda00dc66e051ad13e81ffb`，保留 OFL 1.1 授权。字体来源、压缩过程和覆盖范围见 `client/public/fonts/chill-round-gothic/README.md`。
- WOFF2 子集各保留 7,807 个字符，包含 GB2312、拉丁字符与标点；生僻字使用系统中文字体回退。文件共约 3.56 MiB，比原始 WOFF 总体积减少约 76%。构建产物已包含两个字体文件及授权。
- 画布与编辑器原有显式字体、等宽数据字体、生成/导出内容不改。保留工作区其他改动，未提交、推送或部署。

## 页面验收

复用 `http://localhost:3100`，使用独立 Chrome context 和模拟业务 API，不调用真实生成、不写入真实项目。

`small-text-readability.spec.ts` 覆盖 1920x1080、1280x800、390x844，检查工作台、技能库、资产库、项目、图片生成、视频生成页面。已查看桌面与手机截图，验证导航 13px / 500、默认字重 500、圆角字体实际加载、原大字号不变和文字无溢出。另验证屏蔽 Google Fonts 后本地 Medium / Bold 仍可加载。

```text
4 passed (21.2s)
canvas-prompt-clipboard.spec.ts: 4 passed (54.7s)
studio-agent-dialog.spec.ts: 2 passed (14.2s)
```

引用回归覆盖配置、图片、视频、文本四类节点的复制、剪切、粘贴和重载；Agent 回归覆盖桌面/手机对话发送、草稿、历史与画布工具。

## 实际验证输出

pnpm 命令使用 `--config.verify-deps-before-run=warn`。字体压缩所需 FontTools/Brotli 仅安装于忽略目录 `.tmp/font-tools`，未修改项目依赖。

```text
Studio check: tsc --noEmit, exit 0
Studio test:
Test Files  184 passed (184)
Tests       1163 passed (1163)
Duration    8.73s

Studio build:
Director dependency built in 3.94s
Studio 2166 modules transformed.
built in 3.16s
exit 0

Canvas Agent:
tests 4
pass 4
fail 0
duration_ms 66.8464

Director Desk:
Test Files  87 passed (87)
Tests       686 passed (686)
Duration    93.07s

Go build ./...: exit 0, no output
Go vet ./...: exit 0, no output
Go test ./...: exit 0
ok github.com/ai-manju/api/internal/handler (cached)
ok github.com/ai-manju/api/internal/repository (cached)
ok github.com/ai-manju/api/internal/router (cached)

Worker compileall worker: exit 0
Worker unittest discover -s tests:
Ran 90 tests in 0.613s
FAILED (failures=4, errors=7, skipped=2)

git diff --check: exit 0
```

Go 与 Worker 使用已有 `.tmp/canvas-quality-qa` 中的运行时。Worker 失败仍来自其他改动的图像输出测试（`image_output_unreadable` 与预期不同）及 Windows 不支持 `signal.SIGKILL`；本次未修改相关后台代码。构建保留既有 Director 大包警告和旧 `pnpm.overrides` 配置警告。
