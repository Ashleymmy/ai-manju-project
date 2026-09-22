# 画布提示词面板滚动、避让与自由调整尺寸（2026-09-22）

## 行为与原因

原面板随提示词增长，随后定位逻辑按画布底部限制把面板向上移动，导致覆盖正在编辑的节点。右下角手柄则使用同一个缩放比例同时改变宽高。

- 默认面板高度限制为 320px，长提示词在编辑区域内部滚动，按钮和操作行保持可见。
- 面板根据节点周围的可用空间，优先放在下方，再考虑右侧、左侧和上方。手动保存的大尺寸会按所选区域限制，避免向节点方向挤压。
- 右下角改为自由调整宽高；水平拖动只改宽度、垂直拖动只改高度、斜向拖动按两个方向分别改变。保留单独的右侧和底部手柄。
- 取消原 720px 的手动宽度上限；仍限制在当前可用画布空间内。默认宽度继续保持紧凑。
- 定位锚点不依赖提示词长度或手动尺寸，拖动时左上角保持稳定；尺寸按原有节点元数据保存，刷新恢复。
- 若节点占满视口、四周均无最小可用编辑空间，退回画布底部保证面板可访问；这种极端场景无法同时完整展示节点和独立面板。

修改范围：`domain/inspectorSize.ts`、`CanvasWorkspaceContent.tsx`、`ui/CanvasInspector.tsx`、`ui/CanvasInspectorResizeHandles.tsx` 与 `ui/inspectorResize.css`。复用现有提示词滚动与引用交互组件，保留其他助理正在修改的相关文件。

## 验证范围

- 单元测试验证宽高独立变化、边界独立限制、去除旧宽度上限、四个方向的避让、超大保存尺寸裁剪、锚点稳定及无可用区域的回退。
- 更新已有拖动生命周期测试，继续检查取消、指针抬起、切换节点及组件卸载后的清理。
- 浏览器使用 80 行提示词，确认面板高度受限、滚轮能滚动、节点未被面板覆盖。
- 验证分别拖宽、拖高和右下角自由拖动（宽 +180px、高 +40px），编辑区域随尺寸扩大，引用内容保留，刷新后尺寸恢复。
- 800×500 窗口下生成按钮与调整手柄保持可见；高视频节点在 50%、100%、200% 画布缩放下与面板无重叠。
- 人工检查默认长提示词、放大后的面板和视频侧边面板截图。最终页面错误数量为 0。

浏览器脚本：`apps/studio/e2e/canvas-inspector-resize.spec.ts`。独立端口 4178 / Chrome，模拟项目接口，未发起真实生成。日志、截图位于 `.tmp/canvas-inspector-free-resize-qa/`。测试中不同缩放使用独立模拟项目，避免本地快照缓存影响验收。

## 检查实际输出

```text
Browser: 1 passed (12.0s)

pnpm --filter ai-manhua-studio check
$ tsc --noEmit
exit 0

pnpm --filter ai-manhua-studio test
Test Files 190 passed (190)
Tests 1207 passed (1207)
Duration 9.78s

pnpm --filter ai-manhua-studio build
✓ built in 3.41s
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
Duration 116.78s

python -m compileall -q worker && python -m unittest discover -s tests
Ran 92 tests in 2.016s
OK (skipped=1)

git diff --check
exit 0
```

Go 使用已有工具链；Worker 使用只读挂载源码的独立测试容器，Redis 相关测试跳过 1 项。pnpm 自动移除的原有锁文件 override 已精确补回，无锁文件差异。保留其他助理及此前任务的改动；未提交、部署或重启共享服务。
