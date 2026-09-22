# 提示词面板下方优先与就近摆放（2026-09-22）

## 最终行为

- 默认紧贴节点下方。下方至少能容纳可用面板时，即使比默认或保存高度小，也缩短面板并让提示词内部滚动，不优先跳到旁边。
- 下方确实放不下时，再使用节点侧边或上方的可用空间。
- 面板在节点左侧时，右边缘紧邻节点，保留 12px 间距；在上方时，下边缘紧邻节点，不再贴到画布最左或最上边缘。
- 左侧面板的拖拽手柄位于外侧左下角，上方面板位于外侧上角；拖动方向按对应边缘计算，宽高仍可分别调整，扩展时不压到节点。
- 保留尺寸保存、刷新恢复、长提示词内部滚动和视口限制。

原因是此前选择左侧可用区域后，直接使用了区域最左边作为面板位置，没有用实际宽度对齐节点。修复同时让位置与手柄方向保持一致。

## 验证范围

- 单元测试覆盖不同保存宽度下左侧面板间距、上方面板间距、向外拖动的坐标换算，以及下方较矮但可用时的优先级。
- 浏览器继续验证长文滚动、独立调整宽高、刷新恢复、小窗口、视频节点与 50%/100%/200% 缩放。
- 新增靠右节点场景：确认左側面板距离节点为 12px；向左下方拖动后宽 +140px、高 +60px，间距仍为 12px；刷新后恢复尺寸与就近位置。
- 新增下方优先场景：保存高度为 500px、下方只有 266px 时，面板留在节点下方，生成按钮仍可见。
- 人工检查靠右就近摆放和下方压缩面板截图，最终页面错误数量为 0。

浏览器脚本：`apps/studio/e2e/canvas-inspector-resize.spec.ts`。独立端口 4178 / Chrome，模拟项目接口，无真实生成或共享项目修改。截图与日志：`.tmp/canvas-inspector-adjacent-qa/`。

## 检查实际输出

```text
Browser: 1 passed (23.9s)

pnpm --filter ai-manhua-studio check
$ tsc --noEmit
exit 0

pnpm --filter ai-manhua-studio test
Test Files 190 passed (190)
Tests 1215 passed (1215)
Duration 10.28s

pnpm --filter ai-manhua-studio build
✓ built in 3.21s
exit 0

go build ./...
exit 0
go vet ./...
exit 0
go test ./...
ok github.com/ai-manju/api/internal/router (cached)
ok github.com/ai-manju/api/internal/service (cached)
exit 0

python -m compileall -q worker && python -m unittest discover -s tests
Ran 92 tests in 2.140s
OK (skipped=1)
```

```text
pnpm --filter @basketikun/canvas-agent test
tests 4
pass 4
fail 0

pnpm --filter @ai-manju/director-desk test
Test Files 87 passed (87)
Tests 686 passed (686)
Duration 109.59s

git diff --check
exit 0
```

Go 使用已有工具链，Worker 使用源码只读挂载的独立测试容器，Redis 相关测试跳过 1 项。pnpm 自动移除的原有锁文件 override 已精确补回，无锁文件差异。保留其他助理和此前任务的改动；未提交、部署或重启共享服务。
