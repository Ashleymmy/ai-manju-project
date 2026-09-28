# 本地资产包上传分流与悬浮入口移除

## 请求与根因

用户确认报错发生在本地资产库。截图中的 `ai-manju-assets-20260928-bedea4fe.zip` 被作为普通素材送到 `POST /api/assets`，返回 `unsupported asset type`。已与本地 API 日志对上：

```text
request_id: e3a5e71f-1a5f-455a-bd00-ca707be36dc0
method: POST
path: /api/assets
status: 400
time: 2026-09-28T08:29:58.546963771Z
```

普通“导入资产”和拖入文件共用的 `handleFiles` 原先没有区分 ZIP 与媒体文件。专用“导入资产包”的解包、恢复目录和标签、断点续传逻辑已经存在，不需要放宽后端素材类型。

用户追加要求：删除画布右下角导入图标、非画布页面悬浮导入任务条，仅保留资产库已有入口。

## 修改范围

- `AssetsPage.tsx`：普通上传、拖入均先分离 ZIP；资产包进入既有 `importTaskManager`，普通媒体保留原上传流程；支持混合选择；普通文件输入框清空值，允许重新选择同一文件。
- `model/assetPackageFile.ts`：按不区分大小写的 `.zip` 后缀及常用 ZIP MIME 判断候选，实际内容继续由既有资产包解析器校验。
- 同批多个 ZIP 不启动任何一个包，明确提示逐个导入；同批普通素材仍可上传。已有未完成任务继续受管理器保护，不能被新包覆盖。
- `AssetImportTaskHost.tsx` / `importTask.css`：删除两种悬浮入口和专用导航占位样式，保留认证绑定、后台执行、刷新恢复、退出登录隔离、完成后列表刷新及异常任务弹窗。
- 更新相关浏览器用例，历史恢复用例改为从资产库面板查看任务。

没有修改 API、数据库、原用户素材、目录、标签或已有导入记录；没有重启服务、部署线上、提交或推送。工作区既有其他修改全部保留。

## 实际验证

命令使用 `pnpm --config.verify-deps-before-run=warn`，未安装依赖或改动锁文件。

```text
Studio check: $ tsc --noEmit; exit 0
Studio test: Test Files 230 passed (230); Tests 1675 passed (1675)
Studio build: built in 6.91s; exit 0
Playwright package-routing: 7 passed (15.0s)
Playwright transfer-tasks/bulk-details/tag-hierarchy/canvas-entry: 21 passed (1.2m)
API go build ./...: exit 0
API go vet ./...: exit 0
API go test ./...: exit 0; all tested packages ok (cached)
Canvas Agent: tests 4; pass 4; fail 0
Director Desk: Test Files 87 passed (87); Tests 689 passed (689)
Worker compileall: exit 0
Worker unittest: Ran 131 tests in 2.112s; OK (skipped=9)
git diff --check: exit 0 (existing CRLF/LF warning only)
GET http://localhost:3100/assets: 200
```

Go 使用本地已有 Go runtime；Worker 使用既有 `ai-manju-worker-monitoring:20260923` 镜像只读挂载代码执行。保留现有 pnpm 依赖不同步提示与构建包体积警告。

专项浏览器用例覆盖：大写 ZIP/空 MIME、ZIP MIME 无后缀、普通入口与专用入口、混合拖入、普通媒体与同文件重复选择、多 ZIP 提示、无清单 ZIP 失败、未完成任务保护、删除任务后重新导入、切换项目页继续导入并返回查看完成结果。断言只上传解包出的媒体字节，保留目录/标签层级、分类与备注。

浏览器网络使用隔离的测试响应，不会操作用户资产；浏览器 ZIP 解析、IndexedDB 和导入管理器均真实运行。本轮未重传截图中用户的原始资产包，也未运行需要独立后端的真实 API 恢复/大包测试。相关历史恢复用例的入口已同步更新。

首次专项运行的测试路由误拦截前端模块，修正为仅拦截 `/api/`；画布返回资产库的用例补上关闭版本公告弹窗，最终完整重跑通过。

已查看任务完成截图和移除图标后的画布截图，1920/1000/390px 均通过入口移除、资产库任务继续/删除可用的检查。

## 本地验收

打开 `http://localhost:3100/assets`，通过“导入资产”选择 ZIP 或直接拖入。有效资产包应自动显示导入任务并恢复内容；不再把 ZIP 本身作为普通素材上传。画布及其他页面不再出现悬浮导入入口，可返回资产库点击“导入任务”查看、继续或删除任务。
