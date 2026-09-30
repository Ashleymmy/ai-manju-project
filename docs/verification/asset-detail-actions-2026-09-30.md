# 资产库详情操作区纵向排列

按用户图二调整资产库右侧详情栏：发送到新画布、发送到已有画布、在生图工作台打开改为等宽、整行纵向按钮，间距 6px，去掉三个入口的前置图标。收藏 / 踩 / 下载仍保持原一行。下载使用 Lucide Download（向下箭头与底托），替换原 Archive 图标。

修改文件仅 AssetsPage.tsx 和资产库 styles.css；保留原有点击回调和仅图片显示生图工作台入口的条件。没有改发送、下载、鉴权或资产数据逻辑，没有新增仅复述样式的测试。

## 页面验证

本地 http://localhost:3100/assets 已加载新样式。桌面详情栏三个按钮在同一 235px 列中，等宽，文字均无水平溢出；窄布局下整行宽度可随容器扩大。下载 SVG 类名为 lucide-download。独立检查页没有 console error。

实际页面截图：output/asset-detail-actions/actual-page.png；操作区裁切图：output/asset-detail-actions/detail-actions.png。

本轮浏览器验收范围为布局、文字和图标，未将其作为完整发送或下载业务链路的验收。没有重启、提交或部署；保留其他任务的未提交修改。

## 项目规定验证的实际输出

日志：.tmp/asset-detail-actions-20260930/。

```text
pnpm --filter ai-manhua-studio check
$ tsc --noEmit
exit: 0
pnpm --filter ai-manhua-studio test
Test Files 265 passed (265)
Tests 2098 passed (2098)
Duration 13.31s
pnpm --filter ai-manhua-studio build
✓ built in 6.50s
exit: 0

go build ./... && go vet ./... && go test ./...
ok github.com/ai-manju/api/internal/service (cached)
exit: 0

pnpm --filter @basketikun/canvas-agent test
tests 5
pass 5
fail 0
pnpm --filter @ai-manju/director-desk test
Test Files 87 passed (87)
Tests 689 passed (689)
Duration 86.07s

python -m compileall worker && python -m unittest discover -s tests
Ran 275 tests in 4.254s
OK (skipped=27)

git diff --check
exit: 0
```

Go 和 Worker 使用隔离容器检查当前代码。既有提示：pnpm.overrides 配置位置、大 chunk 和 AssetsPage.tsx 的 CRLF/LF 提示；均未阻断验证。
