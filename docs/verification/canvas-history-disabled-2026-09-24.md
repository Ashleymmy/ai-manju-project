# 画布撤销 / 重做灰态验收（2026-09-24）

## 需求与行为

撤销 / 重做沿用当前整张画布的操作顺序，不随选中节点切换。历史为当前画布打开期间的内存记录，重新加载项目时重新初始化。

顶部与左侧两个入口使用同一历史可用状态。没有可撤销 / 可重做操作时，按钮原生禁用并使用明显的暗灰图标、淡边框；悬停不会恢复高亮。提示文字分别说明“暂无可撤销的画布操作”或“暂无可重做的画布操作”。存在历史时，提示明确作用于画布操作。

## 本任务修改

- `apps/studio/client/src/features/canvas/CanvasWorkspaceContent.tsx`：顶部按钮共用灰态类及说明提示。
- `apps/studio/client/src/features/canvas/ui/CanvasToolbar.tsx`：左侧入口同步样式与说明，并补充稳定的无障碍名称。
- `apps/studio/client/src/features/canvas/styles.css`：限定在历史按钮上的禁用样式。

未改变历史堆栈或节点生成逻辑。保留共享工作区其他任务修改，未提交、未部署、未重启共享服务。

## 浏览器验收

使用现有本地 Studio 和独立浏览器上下文，所有 API 均模拟，不调用生成服务、不写入真实项目。临时脚本与日志在 `.tmp/canvas-history-disabled-20260924/`。

普通节点、旧文件名节点、旧占位节点共三个场景通过：

1. 打开画布时两个入口均无历史且置灰。
2. 切换选中节点不会创建历史。
3. 添加节点后撤销可用、重做不可用。
4. 撤销至初始状态后，撤销禁用、重做可用。
5. 通过另一入口重做到最新状态后，重做禁用。
6. 撤销后进行新编辑会清空重做分支。
7. 保存并刷新后节点保留，内存历史重新初始化。

检查了实际禁用属性、提示文字与计算后的灰态颜色/透明度，并人工查看截图。页面错误记录为空。

实际浏览器输出：

```text
2 passed (20.0s)
1 passed (17.3s)
```

截图：`.tmp/canvas-history-disabled-20260924/browser/history-history-boundaries-d706c-abled-entrances-placeholder/undo-exhausted.png`。

## 项目检查实际结果

日志均在 `.tmp/canvas-history-disabled-20260924/`。

```text
Studio check: tsc --noEmit，exit 0
Studio test:
 Test Files  218 passed (218)
      Tests  1560 passed (1560)
   Duration  10.51s
Studio build: ✓ built in 6.41s，exit 0

历史控制器 / domain 定向测试：
 Test Files  2 passed (2)
      Tests  9 passed (9)

API: go build ./... / go vet ./... / go test ./... 均 exit 0
ok github.com/ai-manju/api/internal/handler (cached)
ok github.com/ai-manju/api/internal/repository (cached)
ok github.com/ai-manju/api/internal/router (cached)

Canvas Agent:
ℹ tests 4
ℹ pass 4
ℹ fail 0

Director Desk:
 Test Files  87 passed (87)
      Tests  689 passed (689)

Worker compileall: exit 0
Ran 118 tests in 1.973s
OK (skipped=2)

git diff --check（本次三个产品文件）: exit 0
```

构建保留已有大文件体积提示。共享工作区验证过程中曾出现节点错误信息函数缺少导入及图片生成测试失败；另一任务同期更新了相应文件。移除了本任务与其重复补入的导入后，类型检查与全量测试重新通过，本任务未保留这些文件的额外修改。
