# 画布同类弹层关闭行为验收（2026-09-13）

## 原因与修复范围

上次只处理了模型菜单，其他 Popover 和部分自定义菜单仍依赖冒泡事件或输入框失焦。画布拖拽及节点控件停止冒泡、阻止默认行为后，这些关闭逻辑无法可靠触发。

新增 `CanvasPopover` 和共用 `useOutsidePress`：捕获阶段接收外部按下/点击，不阻止原操作；处理弹层内操作、嵌套 Portal、切换弹层和关闭后的焦点。画布专用适配器保留原有样式及 Radix 键盘行为。

覆盖检查器的图片工具、视频模式、模型、参数、数量、风格、优化技能、更多操作；节点工具栏的标记颜色和图片工具；顶部画布切换；Agent 菜单、@ 引用素材、右键菜单和连线创建菜单。检查器隐藏或更换节点时关闭旧弹层；位置标记菜单在取消选择后重置。

参数、输入框及滑块可以在弹层内连续操作。模型选项保留选择即关闭行为。连线创建菜单在 pointerup 打开，因此忽略同一手势紧随的 click，从下一次外部 pointerdown 开始关闭，防止刚打开就消失。

本轮仅修改前端交互，没有修改模型调用、后端接口、鉴权、仓库数据或现有画布内容。

## 验证

新增 10 项测试，覆盖停止冒泡后第一次外部点击、受控/非受控弹层、内部选项及输入控件、焦点、嵌套菜单、切换弹窗、隐藏清理、Agent 菜单、@ 菜单及连线释放手势。原模型菜单 8 项回归继续通过。

使用真实 `CanvasPopover` 组件、应用样式及停止冒泡的容器进行浏览器隔离实测：

1. 打开参数，将比例从 1:1 改为 16:9，菜单保持打开。
2. 点击外部按钮一次，菜单关闭，外部操作计数从 0 变为 1，焦点在外部按钮。
3. 打开参数后直接点击图片工具，参数关闭，图片工具打开。
4. 点击外部提示词输入框，菜单关闭，焦点保留在输入框。

隔离验证未登录用户账户、未操作用户画布、未调用模型。临时预览标签页已关闭，两个预览文件已删除。

## 项目规定检查的实际输出

全部命令退出 0，完整输出见 `.codex-logs/canvas-popovers-*-2026-09-13.log`。

Studio：`pnpm --filter ai-manhua-studio check`、`test`、`build`。

```text
> ai-manhua-studio@1.0.0 check D:\AImanju4.0\apps\studio
> tsc --noEmit

Test Files  117 passed (117)
     Tests  578 passed (578)
  Start at  11:11:57
  Duration  5.78s (transform 14.44s, setup 0ms, collect 40.51s, tests 4.89s, environment 18.53s, prepare 13.65s)

✓ 2293 modules transformed.
✓ built in 8.20s
✓ 2055 modules transformed.
✓ built in 5.78s
```

Director Desk 依赖构建保留既有包体积提示，无构建错误。

API：Go 1.23 临时容器只读挂载源码，执行 `go build ./... && go vet ./... && go test ./...`。

```text
ok  github.com/ai-manju/api/internal/assetmigration          0.003s
ok  github.com/ai-manju/api/internal/config                  0.002s
ok  github.com/ai-manju/api/internal/handler                10.987s
ok  github.com/ai-manju/api/internal/middleware              0.009s
ok  github.com/ai-manju/api/internal/provider                0.010s
ok  github.com/ai-manju/api/internal/providerpresetmigration 0.005s
ok  github.com/ai-manju/api/internal/queue                   0.003s
ok  github.com/ai-manju/api/internal/repository              0.007s
ok  github.com/ai-manju/api/internal/router                  0.288s
ok  github.com/ai-manju/api/internal/service                 0.116s
ok  github.com/ai-manju/api/internal/tagmigration            0.006s
```

Canvas Agent：`pnpm --filter @basketikun/canvas-agent test`。

```text
✔ shared tool definitions and local validators stay aligned (1.8723ms)
ℹ tests 1
ℹ pass 1
ℹ fail 0
ℹ skipped 0
```

Director Desk：`pnpm --filter @ai-manju/director-desk test`。

```text
Test Files  87 passed (87)
     Tests  686 passed (686)
  Start at  11:03:13
  Duration  109.70s (transform 1.12s, setup 11.75s, import 11.53s, tests 27.85s, environment 50.27s)
```

Worker：现有镜像只读挂载源码，执行 `python -m compileall worker && python -m unittest discover -s tests`。

```text
Compiling 'worker/tasks.py'...
Compiling 'worker/video.py'...
......................................s........................
----------------------------------------------------------------------
Ran 63 tests in 0.064s

OK (skipped=1)
```

跳过项仍为需要 `REDIS_TEST_URL` 的既有 Redis 集成测试。`git diff --check` 通过，临时文件不存在。

```json
{"url":"http://127.0.0.1:3101/health","status":200}
{"url":"http://127.0.0.1:8101/health","status":200}
{"url":"http://127.0.0.1:3100/comic-assets","status":200}
```
