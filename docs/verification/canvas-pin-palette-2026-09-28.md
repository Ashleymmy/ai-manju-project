# Canvas Pin 十二色验收

## 范围

- 按用户最后确认的布局：12 个颜色，两行，每行 6 个。不使用三行。
- 保留原 8 个色值，追加青绿 `#2DD4BF`、蓝色 `#3B82F6`、黄绿 `#A3E635`、灰蓝 `#94A3B8`。
- 按后续要求重排：上排红、黄、绿、天蓝、紫、白；下排橙、黄绿、青绿、蓝、粉紫、灰蓝。相近色上下配对，横向由暖到冷，中性色在末列；保持全部 12 个色值不变，不影响已有标记。
- 仅修改共享 Pin 色盘常量及色块网格列数。节点元数据、归类定位、保存和取消标记沿用现有逻辑。
- 其他既有修改保留；未提交、未推送、未部署或重启服务。使用现有 `http://localhost:3100`。

## 测试

新增单元测试校验 12 色唯一、原有色值全部保留、大小写归一化、12 色均可生成定位标记、同色节点归入同一标记及上下两排的排列顺序。

新增浏览器测试覆盖 1440px 和 390px：12 个色块按新顺序排列，两行六列，不超出屏幕；全部 12 色逐一点击，验证保存快照中的色值与选中状态，刷新保留，取消后删除元数据。

API 使用隔离模拟，未读写用户画布。窄屏初次测试受既有浮动属性面板遮挡，测试改为先通过正常关闭按钮收起该面板；没有强制点击或隐藏真实界面元素。

## 实际输出

命令使用 `pnpm --config.verify-deps-before-run=warn`；未修改锁文件或依赖。

```text
pnpm --filter ai-manhua-studio check
$ tsc --noEmit
exit 0

pnpm --filter ai-manhua-studio test
Test Files 229 passed (229)
Tests 1661 passed (1661)
Duration 10.79s

pnpm --filter ai-manhua-studio build
vite v7.3.6 building client environment for production...
2979 modules transformed.
built in 6.63s
exit 0

pnpm exec playwright test --config apps/studio/e2e/playwright.pin-palette.config.ts
2 passed (1.3m)

apps/api: go build ./...; go vet ./...; go test ./...
build/vet exit 0; all tested packages ok (cached)

pnpm --filter @basketikun/canvas-agent test
tests 4; pass 4; fail 0

pnpm --filter @ai-manju/director-desk test
Test Files 87 passed (87)
Tests 689 passed (689)
Duration 89.12s

apps/worker: python -m compileall worker
exit 0
apps/worker: python -m unittest discover -s tests
Ran 131 tests in 2.191s
OK (skipped=9)

git diff --check
exit 0
```

Go 使用 `.tmp/canvas-quality-qa/go-runtime/go/bin/go.exe`。Worker 以现有 `ai-manju-worker-monitoring:20260923` 镜像只读挂载源码检查，缓存目录在临时容器内。

已检查两张实际截图：`test-results/canvas-pin-palette/**/pin-palette-1440.png` 和 `pin-palette-390.png`。色块未重叠，均为两行六列。

保留现有依赖不同步、构建包体积和 CRLF 提示；没有新增测试失败。
