# 画布图片工具箱入口（2026-09-21）

> 后续用户调整：已取消本报告中的顶部“图片工具箱”入口，改为工具列表常显滚动条；右键菜单“加入素材库”提升到第一项。最终行为及验证见 `canvas-image-tools-scroll-and-archive-2026-09-21.md`。下文保留此前阶段记录。

图片工具弹出菜单原先有高度限制，聚焦、放大、压缩、多角度等入口位于滚动区域下方，首次使用不容易发现。在共享的 `CanvasImageToolGrid` 顶部增加“图片工具箱”入口，放在滚动列表之外。按最新反馈移除独立边框卡片、加粗标题和多行说明，改为与“扩图”等按钮一致的单行菜单项：相同高度、字体、内边距、透明背景、圆角和悬浮效果，右侧箭头表示打开工具箱。完整功能说明保留在悬浮提示中。点击打开已有完整图片处理弹窗，默认选中裁剪。节点悬浮工具栏与参数区工具菜单共同使用此入口，处理期间禁用。

本项产品改动仅为 `CanvasNodeCard.tsx` 与画布 `styles.css`；同时继续完成此前的视频时长任务，见 `canvas-video-duration-2026-09-21.md`。保留工作树已有的提示词库与其他助理的登录状态改动。未提交、未发布线上、未重启共享服务。

## 浏览器验收

独立本地端口 4178，Chrome 无头浏览器，模拟用户与图片数据。验证节点工具菜单无需滚动可见工具箱，计算样式与“扩图”的高度、字体、内边距、背景和边框一致；点击后七个标签均可切换并显示对应执行按钮；取消后从参数区工具菜单也能打开同一窗口，无页面异常。未执行生成或付费调用。

```text
1 passed (6.0s)
```

临时验收脚本、日志与菜单/弹窗截图：`.tmp/canvas-image-toolbox-qa/`。已人工查看最新截图，确认单行入口与相邻按钮风格一致、右侧箭头可见。首次验收脚本拦截范围包含前端模块请求，修正为仅拦截 `/api/` 后恢复；第二次脚本按 Esc 取消节点选中后未重新选择，修正后全流程通过，两项均为验收脚本问题。

## 初版项目规定检查实际输出

以下为初版检查；最新样式修正及视频时长改动后的完整项目检查见 `canvas-video-duration-2026-09-21.md`，各项均通过。

```text
pnpm --filter ai-manhua-studio check
$ tsc --noEmit
exit 0

pnpm --filter ai-manhua-studio test
Test Files 189 passed (189)
Tests 1188 passed (1188)

pnpm --filter ai-manhua-studio build
✓ built in 3.19s
exit 0

go build ./... && go vet ./... && go test ./...
exit 0
ok github.com/ai-manju/api/internal/router (cached)
ok github.com/ai-manju/api/internal/service (cached)

pnpm --filter @basketikun/canvas-agent test
tests 4
pass 4
fail 0

pnpm --filter @ai-manju/director-desk test
Test Files 87 passed (87)
Tests 686 passed (686)

python -m compileall -q worker && python -m unittest discover -s tests
Ran 92 tests in 2.330s
OK (skipped=1)

git diff --check
exit 0
```

日志均在上述验收目录。Go 使用已有工具链；Worker 使用独立 Linux 测试容器只读挂载源码，跳过未配置 Redis 的集成测试。构建存在已有大包提示。pnpm 自动删除的原锁文件 override 已精确补回，无依赖变更。
