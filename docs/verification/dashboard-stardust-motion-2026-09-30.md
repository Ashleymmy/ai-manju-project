# 创作预估星点流动效果

用户澄清星点应是流动效果，不应像固定图标的一部分。此改动替代上一版仅悬停提亮的星点效果。

## 改动与实际检查

- 仅调整 `CreationBudgetPopover.tsx` 装饰节点和工作台局部样式：3 个淡蓝紫星点在文字上下沿错相漂移，6 秒一轮，同时淡入淡出。固定图标和文字保持静止，无需悬停。
- 只动画 transform/opacity，无 JS 定时器、额外数据请求或布局尺寸变化。装饰不接收鼠标事件，不被读屏朗读；系统开启减少动态效果时停用动画。
- 保留黄色线条图标、无底框、图片淡蓝底色、视频淡紫底色和真实报价功能。
- 本地浏览器实际读取同一粒子：transform 从 `matrix(0.791522,0,0,0.791522,6.0333,0.0847845)` 变化为 `matrix(0.963107,0,0,0.963107,32.343,-1.63107)`；opacity 从 0.636715 变为 0.218628，确认动画确实运行。
- 实测卡片仍为 320×272px，紧凑入口宽 67px，星点均设置 pointer-events:none。
- 连续截取实际页面帧后裁切制作演示：`output/creation-stardust/actual-motion.gif`，18 帧、6.305 秒；没有注入或模拟页面动画。静态图为同目录 `actual-card.png`。

## 验证实际输出

日志位于 `.tmp/creation-stardust-20260930/`，Go 日志位于 `.tmp/creation-stardust-go-*.log`。

```text
pnpm --filter ai-manhua-studio check
> tsc --noEmit
exit: 0

pnpm --filter ai-manhua-studio test
Test Files  264 passed (264)
     Tests  2089 passed (2089)
  Duration  13.18s

pnpm --filter ai-manhua-studio build
✓ built in 6.56s
exit: 0

go build ./...
exit: 0
go vet ./...
exit: 0
go test ./...
ok github.com/ai-manju/api/internal/service (cached)
ok github.com/ai-manju/api/internal/storage (cached)
exit: 0

pnpm --filter @basketikun/canvas-agent test
tests 5
pass 5
fail 0

pnpm --filter @ai-manju/director-desk test
Test Files  87 passed (87)
     Tests  689 passed (689)
  Duration  125.45s

python -m compileall worker && python -m unittest discover -s tests
Ran 275 tests in 4.271s
OK (skipped=27)

git diff --check
exit: 0
```

构建只有既有大 chunk 提示。未增加仅镜像样式实现的测试。保留所有其他未提交改动，没有提交、线上部署或重启服务。
