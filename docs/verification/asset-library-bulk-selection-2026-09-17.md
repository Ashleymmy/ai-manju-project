# 资产库批量选择与标签

## 交互

- 资产网格支持鼠标左键拖动框选，按住 Ctrl、⌘ 或 Shift 可追加选择。
- 选中项使用金色边框高亮，框选中的透明矩形不会遮住缩略图；释放鼠标不会触发卡片点击。
- 顶部批量工具栏显示选中数量，可取消选择。移动、删除、恢复、导出和打包继续使用同一选择集合。
- 新增“批量标签”按钮，弹窗内独立搜索标签，支持为选中资产统一添加或移除多个标签；标签失败时弹窗保留已选状态并显示错误。
- 普通单击、双击预览和复选框操作保持原有行为；按 Escape 可取消当前框选。
- 已框选资产后点击详情区、目录、筛选或页面空白会取消选择；批量工具栏和标签弹窗会保留选择以便继续操作。

## 验证

```text
Studio check: tsc --noEmit, exit 0
Studio test: Test Files 133 passed (133), Tests 734 passed (734)
Studio test after outside-click behavior: Test Files 133 passed (133), Tests 736 passed (736)
Studio build: built in 2.81s, exit 0
git diff --check: exit 0
```

后端接口复用现有 `/api/assets/bulk-tags`，没有新增路由或改变响应信封。Go 环境当前不可用，未执行后端命令。

## 批量移除标签完善

- 切换到移除时读取所选资产的真实标签，仅列出仍有效的标签关联，并显示覆盖数量（例如 `2/6 项`）。
- 多选标签时对受影响资产去重，确认按钮明确显示影响数量；只向接口传递受影响的资产。
- 切换添加/移除会清空勾选，避免误操作。没有标签时不能提交；读取失败时提供重试，不展示不完整结果。
- 关闭弹窗或切换模式会取消旧读取，每批最多读取 5 项资产。移除仅解除所选标签关联，不删除标签定义或其他标签。

本次实际验证输出：

```text
Studio check: tsc --noEmit, exit 0
Studio test: Test Files 133 passed (133), Tests 740 passed (740)
AssetBulkTagsDialog.test.tsx: 6 tests passed
Studio standard build: EPERM mkdir C:\Users\JT\AppData\Local\pnpm\.tools\pnpm\9.15.0_tmp_23412_0
Studio direct Vite build: 2072 modules transformed; built in 5.83s; exit 0
http://localhost:3100/assets 200
http://localhost:3101/health 200
git diff --check: exit 0 (existing CRLF normalization warnings)
```

标准构建入口受包管理器缓存目录写权限限制；直接 Vite 生产构建通过。已恢复本地前端服务，页面 HTTP 检查通过；本次未完成浏览器端交互验收。其他模块沿用此前验证：Canvas Agent 4 项测试通过，Director Desk 87 文件、686 项测试通过；当前 Go/Python 环境不可用，相关检查未执行。
