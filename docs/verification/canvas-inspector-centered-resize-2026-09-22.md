# 提示词面板围绕节点居中伸缩（2026-09-22）

## 修复结果

此前下方、上方面板按默认宽度定位，再应用用户保存的实际宽度，导致左边缘固定，拖动时只向右扩展。

- 下方、上方面板改用实际宽度与节点中心对齐，拉宽、缩窄时两边同步移动；宽、高仍独立调整。
- 拖动计算与居中定位同步：居中时两边一起伸缩，碰到画布边界后限制位置，拖动边缘继续跟随鼠标；反向拖动可以恢复居中。
- 拖动手柄放在空间较多的一侧，避免靠右的节点扩展面板时，手柄提前卡在画布右边。
- 保留默认在节点下方、下方空间较短时压缩面板并内部滚动的规则。侧边面板仍与节点保持 12px 间距。
- 保留尺寸保存、刷新恢复、长提示词滚动、引用内容和画布缩放适配。

## 验证覆盖

单元测试覆盖下方、上方不同宽度的中心对齐，左右边界限制，正反向拖动跨越边界，以及从受限位置开始新拖动时不跳变。

浏览器使用独立端口 4178 / Chrome 和模拟项目接口：

- 下方面板宽度手柄右移 80px，宽度增加 160px、左边缘左移 80px，中心仍对齐节点。
- 角手柄同时改变宽高，反向拖动缩小，中心位置保持不变。
- 左右边缘场景的手柄向外移动 200px，实际拖动边缘跟随 200px；反向拖动恢复原宽和原位置。
- 刷新恢复尺寸，长文内部滚动，引用保留；800×500 小窗口下生成按钮可用。
- 视频节点在 50% / 100% / 200% 缩放下不被面板遮挡；侧边间距和下方优先规则保持。
- 页面错误数量为 0。人工检查最终居中扩展和边缘场景截图。

测试中的尺寸测量等待入场动画完成。外部字体样式请求在测试内替换为空响应，避免远程字体阻塞多次页面导航；产品字体设置未修改。首次浏览器运行曾受入场动画测量和外部字体等待影响，修正测试环境后完整通过。

## 实际检查输出

日志和截图：`.tmp/canvas-inspector-centered-qa/`。

```text
Targeted inspector unit tests
Test Files 2 passed (2)
Tests 36 passed (36)

pnpm --filter ai-manhua-studio check
$ tsc --noEmit
exit 0

pnpm --filter ai-manhua-studio test
Test Files 190 passed (190)
Tests 1225 passed (1225)
Duration 9.49s

pnpm --filter ai-manhua-studio build
✓ built in 3.37s
exit 0

Browser
1 passed (25.7s)

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
Duration 98.53s

python -m compileall -q worker && python -m unittest discover -s tests
Ran 92 tests in 1.940s
OK (skipped=1)

git diff --check
exit 0
```

Go 使用已有工具链及缓存，Worker 使用源码只读挂载的独立测试容器，Redis 相关测试跳过 1 项。pnpm 自动移除的原有锁文件 override 已精确补回，锁文件无差异。保留此前任务和其他助理的改动，未提交、部署或重启共享服务。
