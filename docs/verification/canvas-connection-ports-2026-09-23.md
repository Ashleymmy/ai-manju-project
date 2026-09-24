# 画布连线输入输出端口修复

日期：2026-09-23。对应用户截图 `codex-clipboard-d7d5cd07-6eff-4126-a200-b10094004027.png` 和 `codex-clipboard-8cd613b3-da47-4362-ac2d-83cb0dce55e5.png`，要求音频等节点从右侧输出连接另一节点左侧输入，避免误接导致反向绕线。

## 原因与修改

- 原拖动落点只识别节点 ID，同类端口也会被几何命中或 DOM 回退当作有效目标。给节点及分组接口添加明确端口类型，实际可见接口的类型校验优先于宽松命中区域；输出接输出、输入接输入均拒绝。几何兜底也排除错误侧面的接口。
- 原连续点击两个接口会用第二次点击替换起点，可能悄悄改变用户想要的方向。现在第二个兼容接口直接完成连线；同类接口提示错误并保留原起点。
- 输入端开始反向拖拽仍支持，数据始终保存为输出节点 `from` → 输入节点 `to`。移除「第二节点为 config 时强行改变方向」的例外，所有节点按相同端口规则处理。原 config 默认输入以及禁止 config→config 规则保留。
- 预览与已完成曲线统一使用同一计算函数，避免短距离连线松手时曲率改变。可见路径、命中路径、范围计算继续使用相同曲率。
- 接口提示明确为「输入：连接另一节点的右侧输出」和「输出：连接另一节点的左侧输入」。保留拖到节点主体自动吸附兼容端口的便利操作，以及空白处创建节点并连接功能。

旧画布已有连线的 `from/to` 没有自动反转或重写，避免改变其上下游引用含义；修复作用于新连接交互及统一绘制。已有反向业务连线需要删除后按正确输出→输入重连，不能仅根据节点左右位置推断数据方向。

仅编辑本次端口逻辑、CanvasNodeCard/CanvasStage 和相关测试；未改其他任务的 CanvasWorkspaceContent、inspector resize 等已有改动。未提交、操作暂存区、部署或重启共享服务，未修改线上数据。

## 验证

日志目录：`D:\AImanju4.0\.tmp\canvas-ports-20260923\`。规定检查全部退出 0。

### 专项与全站测试

`targeted.log`：

```text
✓ src/features/canvas/domain/connections.test.ts (52 tests)
✓ src/features/canvas/controllers/stage-interaction/controller.test.ts (37 tests)
Test Files 2 passed (2)
Tests 89 passed (89)
```

新增覆盖八种节点类型的双向拖拽方向、config 端口例外、25/50/100/200% 缩放的节点与分组错误侧面、偏移的 DOM 接口优先校验、同类接口拒绝后不弹新建菜单、点击第二端口完成连线、短连线预览一致性。

Studio 按规定执行 check/test/build，使用已安装的 pnpm CLI `node apps/studio/node_modules/pnpm/bin/pnpm.cjs --filter ai-manhua-studio ...`，设置 `npm_config_manage_package_manager_versions=false`。

```text
> ai-manhua-studio@1.0.0 check D:\AImanju4.0\apps\studio
> tsc --noEmit

Test Files 214 passed (214)
Tests 1504 passed (1504)
Duration 12.02s

✓ built in 6.34s
```

构建存在部分产物超过 500 kB 的提示，不阻止构建。

### 浏览器实际操作

`apps/studio/e2e/canvas-connection-ports.spec.ts` 运行在现有 3100 开发服务，全部 API 均由测试接管，包括自动保存，不触及真实项目。

按用户截图构造音频左上、文本右下布局，验证错误端口拖拽、正确端口拖拽、预览与最终曲线一致、快照 `from/to`、刷新后连线保留、输入端反向拖拽不重复或反转、点击同类接口后再点兼容接口正常完成。

首次 50% 试跑在刷新后被自动打开的提示词面板挡住端口；测试改为正常点击「关闭面板」后操作，没有强制点击绕过 UI。最终 `browser.log`：

```text
ok 1 ... canvas ports connect output to input without reversing at 100% zoom (31.0s)
ok 2 ... canvas ports connect output to input without reversing at 50% zoom (10.7s)
2 passed (42.2s)
```

已查看最终截图，右侧输出至左侧输入的曲线符合图二布局：

- `browser/canvas-connection-ports-ca-fc734-thout-reversing-at-100-zoom/output-to-input-100.png`
- `browser/canvas-connection-ports-ca-e5228-ithout-reversing-at-50-zoom/output-to-input-50.png`

### 其他规定检查

API 在 `apps/api` 使用已有 Go runtime 执行 `go build ./...`、`go vet ./...`、`go test ./...`。前两项无输出，均退出 0；测试摘录：

```text
ok github.com/ai-manju/api/internal/handler    (cached)
ok github.com/ai-manju/api/internal/middleware (cached)
ok github.com/ai-manju/api/internal/repository (cached)
ok github.com/ai-manju/api/internal/router     (cached)
ok github.com/ai-manju/api/internal/service    (cached)
```

本轮无 API 改动，未配置外部数据库的可选集成测试按原约定跳过。

Canvas Agent 与 Director Desk 执行规定的 workspace test；Worker 使用一次性容器只读挂载源码，执行 `python -m compileall -q worker` 与 `python -m unittest discover -s tests`：

```text
Canvas Agent: tests 4 / pass 4 / fail 0
Director Desk: Test Files 87 passed (87), Tests 689 passed (689), Duration 86.05s
Worker: Ran 118 tests in 1.976s, OK (skipped=2)
```

`git diff --check` 通过。本地修复需发布 Studio 后才会在线上生效。
