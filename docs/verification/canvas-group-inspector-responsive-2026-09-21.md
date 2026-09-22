# 画布分组工具栏自适应宽度（2026-09-21）

## 问题与修复

原分组面板固定使用最大 760px 的宽度，内部强制单行排列并隐藏横向滚动条；内容变宽后，最右侧的“解散分组”被截断。

- 使用内容宽度自动撑开面板，最大宽度限制在画布可用区域内。
- 空间不足时，分组名称、颜色和操作按钮自动换行；极低窗口允许纵向滚动。
- 通过 ResizeObserver 测量面板完整尺寸，随窗口、内容及换行变化重新限制浮层位置，保留与画布边缘及分组标题的间距。
- 保留现有按钮外观和操作，不改接口或分组数据。

产品变更位于 `apps/studio/client/src/features/canvas/CanvasWorkspaceContent.tsx` 与同目录 `styles.css`。保留其他助理及此前任务的改动；仅本地修改，未提交、部署或重启共享服务。

## 浏览器验证

独立端口 4178 / Chrome，模拟用户与项目接口，无真实生成请求。脚本和截图位于 `.tmp/canvas-group-responsive-qa/`。

- 画布缩放 50%、100%、200%，分别切换窗口宽度 1440、1024、768、600、390、320、1920px。
- 验证面板保持在窗口内、没有横向溢出，所有输入框和按钮均完整显示。
- 编辑长分组名称、切换颜色、打开积分明细、解散分组均通过。
- 动态增加按钮文字后，工具栏可以超过原 760px 限制，仍完整展示内容。
- 页面错误数量为 0。人工检查 1920px 单行与 390px 换行截图。

```text
3 passed (14.2s)
```

## 项目检查实际输出

以下 Studio 检查在最终分组代码修改后执行，日志位于 `.tmp/canvas-group-responsive-qa/`。

```text
pnpm --filter ai-manhua-studio check
$ tsc --noEmit
exit 0

pnpm --filter ai-manhua-studio test
Test Files 190 passed (190)
Tests 1194 passed (1194)
Duration 9.15s

pnpm --filter ai-manhua-studio build
✓ built in 3.16s
exit 0

git diff --check
exit 0
```

下列检查已在本轮滚动条修改后执行；随后仅修改上述分组前端文件，因此沿用本轮结果，日志位于 `.tmp/canvas-image-scroll-final-qa/`。

```text
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
Duration 90.62s

python -m compileall -q worker && python -m unittest discover -s tests
Ran 92 tests in 1.437s
OK (skipped=1)
```

Worker 使用源码只读挂载的独立测试容器；Redis 相关测试跳过 1 项。pnpm 自动移除的原有锁文件 override 已精确补回，未引入依赖变更。
