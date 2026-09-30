# 资产缩略图缩放按钮顺序

按用户要求，将 AssetsPage.tsx 中资产缩略图控件调整为：左侧放大（ZoomIn）、中间列数、右侧缩小（ZoomOut）。按钮提示、点击处理及禁用条件随对应按钮移动，最少 3 列规则保持不变。没有新增功能或修改其他任务文件。

检查最终控件顺序及 git diff --check 通过。没有为此简单排布变更新增测试。

## 实际验证输出

日志：.tmp/asset-zoom-order-20260930/。

```text
pnpm --filter ai-manhua-studio check
$ tsc --noEmit
exit 0

pnpm --filter ai-manhua-studio test
Test Files 267 passed (267)
Tests 2104 passed (2104)
Duration 14.27s

pnpm --filter ai-manhua-studio build
✓ built in 6.49s
exit 0

go build ./... && go vet ./... && go test ./...
ok github.com/ai-manju/api/internal/service (cached)
exit 0

pnpm --filter @basketikun/canvas-agent test
tests 5
pass 5
fail 0

pnpm --filter @ai-manju/director-desk test
Test Files 87 passed (87)
Tests 689 passed (689)
Duration 92.42s

python -m compileall worker && python -m unittest discover -s tests
Ran 275 tests in 4.600s
OK (skipped=27)

git diff --check
exit 0
```

Go 和 Worker 使用隔离容器，没有重启服务、提交或部署。保留其他未提交修改。既有 pnpm 配置、大 chunk 及 CRLF/LF 提示不影响验证结果。
