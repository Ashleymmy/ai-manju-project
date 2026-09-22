# 画布视频截图按钮避让播放控件（2026-09-22）

## 修复

截图按钮原来通过 `bottom: 42px` 固定在视频右下方，与浏览器原生全屏及音量控件重叠。将 `.node-video-capture` 改为视频右上角定位（`top: 10px; right: 10px`），保留原有样式、截帧行为和忙碌状态。

本次产品修改仅涉及 `apps/studio/client/src/features/canvas/styles.css` 中该按钮的位置。保留其他助理和此前任务的改动；未提交、部署或重启共享服务。

## 浏览器验收

独立端口 4178 / Chrome，使用浏览器录制的测试视频和模拟接口，无真实生成或上传请求。脚本、截图和日志位于 `.tmp/canvas-video-capture-layout-qa/`。

- 横屏节点 720×405 / 100% 画布缩放、小节点 280×158 / 50% 缩放、竖屏节点 180×320 / 200% 缩放，按钮均位于上部且保持在视频范围内。
- 视频下方控件区域的点击不被截图按钮拦截。
- 在横屏场景中点击浏览器原生全屏按钮，确认视频进入全屏并能退出。
- 三种场景分别点击“截取当前帧”，确认上传请求与图片节点创建成功，无页面错误。
- 已人工查看三种尺寸的截图。

初次验收使用的静态录制样本只有一帧，播放立即结束；修正为连续录帧后正常。竖屏放大场景的参数面板遮住了底部测试坐标，关闭参数面板后验证通过；这些调整仅涉及临时验收脚本。

```text
3 passed (10.3s)
```

## 项目检查实际输出

全部日志位于 `.tmp/canvas-video-capture-layout-qa/`。

```text
pnpm --filter ai-manhua-studio check
$ tsc --noEmit
exit 0

pnpm --filter ai-manhua-studio test
Test Files 190 passed (190)
Tests 1194 passed (1194)
Duration 9.22s

pnpm --filter ai-manhua-studio build
✓ built in 3.19s
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
Duration 90.83s

python -m compileall -q worker && python -m unittest discover -s tests
Ran 92 tests in 2.010s
OK (skipped=1)

git diff --check
exit 0
```

Go 使用已有工具链；Worker 使用只读挂载源码的独立测试容器，Redis 相关测试跳过 1 项。pnpm 自动移除的原有锁文件 override 已精确补回，锁文件无差异。
