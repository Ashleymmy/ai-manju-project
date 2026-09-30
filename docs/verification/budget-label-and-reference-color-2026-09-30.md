# 创作预估文案和参考配色

用户要求把入口改为弹窗标题“灵感还能走多远”，并以随后截图中的工作区统计卡片作为底色参考。

- 入口可见文字、title、无障碍名称统一为“灵感还能走多远”。窄卡片也保留完整文字，不再改称“创作预估”。
- 入口和积分明细保持一组靠右；窄屏允许整组换行，并压缩统计区内边距，使卡片维持 272px 高度。
- 弹窗使用参考统计卡片的同色 `#171c1e`；结果区域 `#1b2123`、选择框 `#202628`，去掉金黄渐变。弹窗内部图标恢复中性灰。入口计算器及流动星点保留。
- 本地浏览器实际测得弹窗与 `.stat-strip` 背景均为 `rgb(23,28,30)`。
- 1600 屏宽卡片 400.15625×272px，1280 屏宽卡片 320×272px；两种宽度下入口都显示完整文案并靠右。
- 只调整局部文字和样式，没有更改报价、画布、管理员界面、后台服务或其他已有修改。

实际截图 `output/budget-neutral/actual-popover.png`（从页面截图裁切），完整截图为同目录 `actual-page.png`。

## 实际验证输出

日志 `.tmp/budget-neutral-20260930/`。

```text
pnpm --filter ai-manhua-studio check
> tsc --noEmit
exit: 0

pnpm --filter ai-manhua-studio test
Test Files 264 passed (264)
Tests 2093 passed (2093)
Duration 12.98s

pnpm --filter ai-manhua-studio build（最终配色后）
✓ built in 9.30s
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
Duration 129.03s

python -m compileall worker && python -m unittest discover -s tests
Ran 275 tests in 4.089s
OK (skipped=27)

git diff --check
exit: 0
```

仅有既有大 chunk 构建提示。本轮没有新增镜像样式的测试，仅更新已有交互测试中的入口文案。没有提交、部署或重启服务。
