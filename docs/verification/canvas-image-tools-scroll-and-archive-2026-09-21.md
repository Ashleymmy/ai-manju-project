# 画布图片工具滚动条与归档入口（2026-09-21）

## 最终行为

- 移除图片工具菜单顶部的“图片工具箱”按钮，保留列表中的具体功能入口。
- 复用现有 Radix ScrollArea，设置常显模式；按用户最终反馈恢复较粗的灰色圆角滚动条（8px 轨道、6px 滑块），整体向右移动 6px。支持滚轮和拖动，标题不滚动，菜单高度适配可用空间。节点悬浮工具菜单与参数区图片工具共用该实现。
- 图片节点右键菜单移除“素材与文件”子菜单，将“加入素材库”直接放在原位置，即主菜单第一项。点击调用既有归档流程并关闭右键菜单，打开分类归档窗口。

产品代码仅调整 `CanvasNodeCard.tsx`、`CanvasStage.tsx`、画布 `styles.css`。其他助理的登录状态修改及此前视频时长、提示词库修改均保留；未提交、未部署、未重启共享服务。

## 浏览器验证

独立端口 4178 / Chrome，模拟项目、用户与素材数据：

- 顶部工具箱入口不存在，右侧轨道和滑块可见。
- 滚轮可到列表底部，能看到“存入素材库”；拖动滑块能返回顶部。
- “扩图”仍打开既有处理弹窗；参数区图片工具同样显示滚动条。
- 右键菜单第一项为“加入素材库”，不存在“素材与文件”；点击后归档窗口正常打开，无页面错误。

```text
1 passed (6.6s)
```

验收脚本、截图和日志：`.tmp/canvas-image-tools-scroll-qa/`。已人工检查顶部/底部滚动条截图与右键菜单截图。首次原生滚动条方案在浏览器截图中仍不可见且拖动检查未通过，最终改用常显组件并通过。增加组件依赖导入后的首次开发服务器加载出现错误页，重启独立验收服务器后完整流程通过；最终构建与测试通过，未改动共享服务。

## 项目要求检查实际输出

```text
pnpm --filter ai-manhua-studio check
$ tsc --noEmit
exit 0

pnpm --filter ai-manhua-studio test
Test Files 190 passed (190)
Tests 1193 passed (1193)
Duration 9.59s

pnpm --filter ai-manhua-studio build
✓ built in 3.55s
exit 0

go build ./...
exit 0
go vet ./...
exit 0
go test ./...
ok github.com/ai-manju/api/internal/router (cached)
ok github.com/ai-manju/api/internal/service (cached)
exit 0

pnpm --filter @basketikun/canvas-agent test
tests 4
pass 4
fail 0

pnpm --filter @ai-manju/director-desk test
Test Files 87 passed (87)
Tests 686 passed (686)

python -m compileall -q worker && python -m unittest discover -s tests
Ran 92 tests in 1.347s
OK (skipped=1)

git diff --check
exit 0
```

Go 使用已有工具链；Worker 使用只读挂载源码的独立测试容器，未配置 Redis 的测试跳过。pnpm 自动移除的锁文件 override 精确补回，无依赖变更。

## 后续滚动条视觉优化

按用户反馈，仅修改画布 CSS：去掉实色底轨，默认显示 4px 的低对比圆角滑块，使用与菜单文字协调的暖灰色；鼠标悬浮时加宽为 6px 并提亮，按下时进一步提亮。滑块保留 8px 的实际拖动区域、12px 的轨道操作区域，避免视觉变细后难以拖动。列表右侧留出 14px 间距。滚动条仍常显，不依赖系统自动隐藏行为。

已查看默认/悬浮截图，复用浏览器验收脚本确认滚轮到底部、拖动回顶部、原工具弹窗、参数区入口与右键归档均正常，无页面异常。截图及本轮日志：`.tmp/canvas-image-scroll-polish-qa/`。

```text
Browser: 1 passed (8.5s)
pnpm --filter ai-manhua-studio check: tsc --noEmit, exit 0
pnpm --filter ai-manhua-studio test:
Test Files 190 passed (190)
Tests 1193 passed (1193)
Duration 9.55s
pnpm --filter ai-manhua-studio build: ✓ built in 3.10s, exit 0
go build ./...: exit 0
go vet ./...: exit 0
go test ./...: exit 0 (cached)
pnpm --filter @basketikun/canvas-agent test: tests 4, pass 4, fail 0
pnpm --filter @ai-manju/director-desk test:
Test Files 87 passed (87)
Tests 686 passed (686)
Duration 90.95s
python -m compileall -q worker && python -m unittest discover -s tests:
Ran 92 tests in 1.468s
OK (skipped=1)
git diff --check: exit 0
```

## 最终恢复较粗样式并保留右移

按用户“最开始设计的版本，并且靠右一点”的反馈，恢复 8px 深灰色轨道、6px 灰色滑块，悬浮时提亮；保留向右移动 6px，列表右侧间距恢复为 12px。已人工检查截图并验证滚轮、拖动、两个工具菜单及归档入口。日志和截图：`.tmp/canvas-image-scroll-final-qa/`。

```text
Browser: 1 passed (8.6s)
pnpm --filter ai-manhua-studio check: tsc --noEmit, exit 0
pnpm --filter ai-manhua-studio test:
Test Files 190 passed (190)
Tests 1193 passed (1193)
Duration 9.45s
pnpm --filter ai-manhua-studio build: ✓ built in 3.13s, exit 0
go build ./...: exit 0
go vet ./...: exit 0
go test ./...: exit 0 (cached)
pnpm --filter @basketikun/canvas-agent test: tests 4, pass 4, fail 0
pnpm --filter @ai-manju/director-desk test:
Test Files 87 passed (87)
Tests 686 passed (686)
Duration 90.62s
python -m compileall -q worker && python -m unittest discover -s tests:
Ran 92 tests in 1.437s
OK (skipped=1)
```

## 右侧间距微调

按最新反馈，将滚动条整体向右移动 6px，进入菜单原有内边距，缩小右侧留白；工具列表排版与滑块操作宽度不变。实际浏览器截图确认滑块靠近右边缘且完整显示，滚轮及拖动回顶部验证通过。截图、日志在 `.tmp/canvas-image-scroll-offset-qa/`。

```text
Browser: 1 passed (9.1s)
pnpm --filter ai-manhua-studio check: tsc --noEmit, exit 0
pnpm --filter ai-manhua-studio test:
Test Files 190 passed (190)
Tests 1193 passed (1193)
Duration 9.42s
pnpm --filter ai-manhua-studio build: ✓ built in 3.05s, exit 0
go build ./...: exit 0
go vet ./...: exit 0
go test ./...: exit 0 (cached)
python -m compileall -q worker && python -m unittest discover -s tests:
Ran 92 tests in 1.506s
OK (skipped=1)
pnpm --filter @basketikun/canvas-agent test: tests 4, pass 4, fail 0
pnpm --filter @ai-manju/director-desk test:
Test Files 87 passed (87)
Tests 686 passed (686)
Duration 89.76s
git diff --check: exit 0
```
