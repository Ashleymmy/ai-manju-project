# 资产库分类标签层级显示优化

> 后续视觉调整已移除复选框，当前采用点击行高亮选择。下文初版描述作为历史记录保留，最新验证见末尾。

## 范围与状态

- 用户问题：资产库顶部分类标签数量增加后，父子关系不明显。
- 本地实现及验证完成；未提交、未推送、未部署。其他既有改动保留。
- 仅调整资产库标签展示、搜索和展开方式，不改变标签数据、归属、权限或交集/并集筛选语义。
- 本轮没有后端改动，Memory/Gorm 仓库和公开响应契约均保持原样。

## 修改方向

- 替换原先只支持两级、默认截取前八个根标签的方块列表，改为父标签分列的多级树。
- 根标签加粗并以分隔线区分；子标签逐级缩进，显示父子连接线。
- 展开箭头与筛选复选框独立：收起分支不清空已选项，也不触发筛选。
- 增加标签名称、完整路径及别名搜索。搜索保留祖先链，并临时展开匹配分支；清空搜索后恢复原折叠状态。
- 支持全部展开、全部收起，标签区域限制高度并内部滚动。窄屏改为单列，长名称换行。
- 已选项显示完整路径；即使分支或整个分类标签面板收起，仍可独立取消筛选。
- 查询完整标签树，保留未启用资产但拥有资产子标签的父级作为上下文；该父级不可勾选，无关的纯提示词分支不显示。
- 批量打标签仍仅传入启用了资产的标签，不扩大可绑定范围。

## 涉及文件

- `apps/studio/client/src/features/assets/AssetsPage.tsx`
- `apps/studio/client/src/features/assets/model/queries.ts`
- `apps/studio/client/src/features/assets/model/assetTagTree.ts`
- `apps/studio/client/src/features/assets/ui/AssetTagFilter.tsx`
- `apps/studio/client/src/features/assets/ui/AssetTagFilter.css`
- `apps/studio/client/src/features/assets/model/assetTagTree.test.ts`
- `apps/studio/e2e/asset-tag-hierarchy.spec.ts`
- `apps/studio/e2e/playwright.asset-tags.config.ts`

## 验证输出

pnpm 命令均使用 `--config.verify-deps-before-run=warn`，没有安装、升级或修改依赖。

```text
pnpm --filter ai-manhua-studio check
$ tsc --noEmit
退出 0

pnpm --filter ai-manhua-studio test
Test Files  226 passed (226)
     Tests  1648 passed (1648)
  Duration  10.87s

pnpm --filter ai-manhua-studio build
2977 modules transformed.
built in 6.52s
退出 0

pnpm exec playwright test --config apps/studio/e2e/playwright.asset-tags.config.ts
8 passed (18.2s)

pnpm --filter @basketikun/canvas-agent test
tests 4 / pass 4 / fail 0

pnpm --filter @ai-manju/director-desk test
Test Files  87 passed (87)
     Tests  689 passed (689)
  Duration  88.12s
```

API 使用已有 `.tmp/canvas-quality-qa/go-runtime/go/bin/go.exe`，在 `apps/api` 执行：

```text
go build ./...  退出 0，无输出
go vet ./...    退出 0，无输出
go test ./...   退出 0，节选：
ok github.com/ai-manju/api/internal/handler (cached)
ok github.com/ai-manju/api/internal/middleware (cached)
ok github.com/ai-manju/api/internal/repository (cached)
ok github.com/ai-manju/api/internal/router (cached)
ok github.com/ai-manju/api/internal/service (cached)
```

Worker 在已有 `ai-manju-worker-monitoring:20260923` 镜像中只读挂载 `apps/worker`：

```text
python -m compileall worker
退出 0
python -m unittest discover -s tests
Ran 131 tests in 2.116s
OK (skipped=9)
```

- 新增五项单元测试覆盖层级排序、同名完整路径、非资产祖先、别名/路径搜索、空数据及孤立/循环父子关系。
- 浏览器四项新增测试覆盖四级树、122 个标签跨页加载、折叠不改变选择、同名标签、交集/并集请求、后代筛选参数、搜索恢复状态，以及 1600px/390px 的长名称和边界检查。
- 四项既有资产详情/批量编辑浏览器测试一并通过。
- 首轮新增浏览器测试被版本提示弹窗的无障碍隐藏机制挡住；修正测试初始化顺序，先关闭提示再定位分类区域，重跑八项全部通过。没有为测试调整产品行为。
- 浏览器使用隔离的 API 模拟数据，不调用真实生成，不修改线上/本地业务数据。
- 已人工查看桌面/窄屏截图：`.tmp/asset-tag-hierarchy-qa/1600.png`、`.tmp/asset-tag-hierarchy-qa/390.png`。确认层级缩进、连接线、完整路径显示和长名称换行。
- `git diff --check` 退出 0。保留已有 CRLF、依赖与锁文件不同步、大块构建产物及 assets 混合静态/动态导入警告。

## 使用入口

本地开发服务沿用已有 `http://localhost:3100/assets`，未重启共享服务。线上需获准发布后才会更新。

## 后续调整：去掉勾选框，点击高亮

根据用户对初版视觉的反馈，只修改 `AssetTagFilter.tsx`、`AssetTagFilter.css` 和对应浏览器测试：

- 移除标签前方的复选框，使用原生切换按钮和 `aria-pressed`，点击名称、数量或行内留白即可选中，再点取消。保留多选和键盘 Space/Enter 支持。
- 选中行使用柔和底色、细描边与较亮文字；未选中保持透明，悬停仅轻微提亮。
- 移除根标签下面的长横线，收紧网格间距，减淡树形连接线；保留父子缩进与独立折叠箭头。
- 未启用资产的上下文父标签仍不可选，筛选参数及其他数据逻辑未改。

本轮重新执行全部规定验证，实际输出摘要：

```text
Studio check: $ tsc --noEmit，退出 0
Studio test: Test Files 226 passed (226), Tests 1648 passed (1648), Duration 11.40s
Studio build: 2977 modules transformed, built in 6.51s，退出 0
Playwright asset-tags: 9 passed (26.3s)
Canvas Agent: tests 4 / pass 4 / fail 0
Director Desk: Test Files 87 passed (87), Tests 689 passed (689), Duration 88.57s
API go build ./...: 退出 0，无输出
API go vet ./...: 退出 0，无输出
API go test ./...: 退出 0，包测试结果为 ok（cached）
Worker compileall: 退出 0
Worker unittest: Ran 131 tests in 2.105s; OK (skipped=9)
git diff --check: 退出 0
```

新增浏览器断言：无复选框、点击数量触发选择、重复点击取消、选中底色与状态改变、Space/Enter 切换。原多选/交并集/折叠/搜索/分页及资产批量编辑用例继续通过。

已查看 `.tmp/asset-tag-highlight-qa/panel-1600.png` 与 `panel-390.png`，检查高亮、换行、缩进和布局边界；完整页面截图同目录。测试使用隔离模拟数据，未产生真实业务写入。保留既有构建警告；未提交、未推送、未部署。
