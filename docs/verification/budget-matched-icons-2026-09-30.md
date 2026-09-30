# 灵感预估图标统一

用户要求图标采用上方星光样式、颜色采用下方暖金色。入口和弹窗标题现在都使用 Sparkles，strokeWidth=1.7，并共享颜色规则 #dfc98d。入口展开/悬停不再替换图标颜色，保留轻微光晕。未调整冷深灰背景、文案、报价或星点漂移动画。

浏览器实测两个 SVG 都为 lucide-sparkles，线条粗细 1.7、颜色 rgb(223,201,141)。实际页面截图：output/budget-icons/actual-icons.png。卡片仍高 272px。

## 实际验证输出

日志：.tmp/budget-icons-20260930/。

```text
pnpm --filter ai-manhua-studio check
> tsc --noEmit
exit: 0

pnpm --filter ai-manhua-studio test
Test Files 264 passed (264)
Tests 2093 passed (2093)
Duration 13.20s

pnpm --filter ai-manhua-studio build
✓ built in 9.37s
exit: 0

go build ./...
exit: 0
go vet ./...
exit: 0
go test ./...
ok github.com/ai-manju/api/internal/service (cached)
exit: 0

pnpm --filter @basketikun/canvas-agent test
tests 5
pass 5
fail 0

pnpm --filter @ai-manju/director-desk test
Test Files 87 passed (87)
Tests 689 passed (689)
Duration 137.75s

python -m compileall worker && python -m unittest discover -s tests
Ran 275 tests in 4.043s
OK (skipped=27)

git diff --check
exit: 0
```

构建仅有既有大 chunk 提示，没有新增样式镜像测试。保留全部其他未提交改动；没有提交、部署或重启服务。
