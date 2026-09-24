# 画布切换列表缺失：排查与本地修复

用户确认：问题出现在 studio.clouddo.cc，应该是画布内的切换列表找不到旧画布。本次修复本地代码；未读取线上数据库、未恢复线上备份、未发布。不能据此断言线上数据已删除或已恢复。

## 已确认的缺陷与处理

| 缺陷 / 隐患 | 最终行为 |
| --- | --- |
| 列表请求失败被转换成空数组，弹窗统一显示“无匹配画布” | 加载、请求失败、真实空列表、搜索无匹配分别显示；失败有重试按钮 |
| 同一空间只加载一次列表，重新打开弹窗不会刷新 | 打开弹窗刷新，恢复窗口焦点或网络时刷新，可手动刷新；打开时清除旧搜索条件 |
| 刷新失败清空已经取得的画布 | React Query 保留成功取得的列表，错误提示注明仍显示上次加载的画布 |
| 列表读取全部画布的完整快照，大画布可能放大传输量、超时及快照读取故障 | 新增 GET /api/projects?include_data=false，仅读取元信息；Gorm 路径不读取 project_snapshots，Memory 路径只清除返回副本的 Data |
| 新建画布后同一空间列表不重新加载 | 新建成功写入相应列表并失效缓存；重命名、删除、导入、封面更新也取消旧请求并更新列表缓存 |
| 空间/账号切换以及较早请求迟到可能污染列表 | 缓存键包括空间、用户；取消旧请求，不使用跨空间的占位数据；瞬时网络/5xx 仅自动重试一次 |
| 从切换菜单“新建并进入”直接跳转，可能丢弃尚未执行的自动保存 | 走与切换画布相同的保存流程；保存失败留在原画布，新画布保留在列表供之后进入 |
| 列表轻量化后，批量导出的旧兜底可能误用不完整数据 | 快照不可用时读取单个项目的完整数据；仍没有完整数据则报错，不把摘要作为空画布导出 |

默认列表 API、项目详情、快照读写、鉴权和工作区可见范围保持原行为。新增摘要响应不含 `data` 字段，避免把空对象当作可编辑快照；前端也会剔除旧版服务端可能返回的 `data`。

没有改动其他助理的文档导入、生成重试、监控功能文件，未提交、部署或重启共享服务。

## 验证

日志目录：`D:\AImanju4.0\.tmp\canvas-switcher-20260923\`。

### 前端

实际使用项目已安装的 pnpm CLI：`node apps/studio/node_modules/pnpm/bin/pnpm.cjs --filter ai-manhua-studio check|test|build`，并设置 `npm_config_manage_package_manager_versions=false`。

`studio-check.log`，退出码 0：

```text
> ai-manhua-studio@1.0.0 check D:\AImanju4.0\apps\studio
> tsc --noEmit
```

`studio-test.log`，退出码 0：

```text
 Test Files  207 passed (207)
      Tests  1434 passed (1434)
   Duration  11.01s
```

`studio-build.log`，退出码 0：

```text
✓ built in 7.31s
```

构建仍提示部分产物超过 500 kB，该提示不阻止构建。

新增前端测试验证初次加载失败与重试、刷新失败保留数据、账号/空间隔离、迟到响应取消、有限自动重试、不重试权限错误、取消旧请求后更新列表、异常响应不伪装为空列表、旧服务器兼容和摘要数据剔除。项目会话测试增加了“只有元信息时禁止写入”和“保存失败不跳转”。现有自动保存队列、切换和快照保留测试通过。

### 后端与 PostgreSQL

使用仓库已有 Go runtime：`.tmp/canvas-quality-qa/go-runtime/go/bin/go.exe`，在 `apps/api` 执行 `go build ./...`、`go vet ./...`、`go test ./...`。

`api-build.log` / `api-vet.log`：退出码均为 0，无输出。

新建独立临时 PostgreSQL 15 容器，映射到 127.0.0.1:55439，设置 TEST_DATABASE_URL 与 ASSET_TEST_DATABASE_URL 指向测试数据库；没有使用用户运行中的数据库。验收后移除测试容器。

专项输出 `summary-go-tests.log`：

```text
--- PASS: TestProjectListSummaryOptInPreservesFullAPI (0.00s)
--- PASS: TestProjectSummariesPreserveWorkspaceAndSnapshots (0.16s)
    --- PASS: TestProjectSummariesPreserveWorkspaceAndSnapshots/memory (0.00s)
    --- PASS: TestProjectSummariesPreserveWorkspaceAndSnapshots/postgres (0.16s)
--- PASS: TestGormProjectSummariesDoNotReadSnapshots (0.04s)
```

覆盖旧版个人空间记录、个人/团队/他人隔离、快照内容与版本不变、默认 API 仍返回完整数据，以及模拟快照查询故障时摘要查询仍可用。

首次全量测试遇到多个包同时迁移临时空库造成的 PostgreSQL 建表/索引冲突；顺序运行解决了该冲突，随后遇到其他助理正在修改的 `TestRuntimeMonitoringScopeAndExport` 失败。保留日志 `api-test.log` 与 `api-test-serial.log`，没有改动该功能。检测到对应文件更新后，再次执行完整 `go test ./...`，最终退出码 0，`api-test-final.log` 摘录：

```text
ok  github.com/ai-manju/api/internal/handler      14.713s
ok  github.com/ai-manju/api/internal/middleware   (cached)
ok  github.com/ai-manju/api/internal/monitoring   (cached)
ok  github.com/ai-manju/api/internal/repository   (cached)
ok  github.com/ai-manju/api/internal/router       9.175s
ok  github.com/ai-manju/api/internal/service      (cached)
ok  github.com/ai-manju/api/internal/tagmigration (cached)
```

### 浏览器交互

在现有本地开发服务运行 Chrome / Playwright，全部 API 请求由测试接管，隔离用户真实数据。`browser.log`：

```text
ok 1 ... canvas switcher recovers from failed lists, keeps loaded canvases and refreshes on reopen (6.7s)
1 passed (7.6s)
```

实际验证：首次列表 503 显示重试而非“无匹配”；恢复后旧画布出现；搜索无匹配独立显示；重新打开清除旧查询并显示其他窗口新建的画布；刷新再次 503 保留已加载列表；能切换旧画布；新建后列表立即显示新画布；模拟保存失败不离开旧画布，恢复后可进入新画布；原有节点始终存在，保存请求未用摘要覆盖画布。

截图在该日志目录的 `browser/canvas-switcher-recovery-c-4534a-ses-and-refreshes-on-reopen/`：

- `list-failed-retry.png`
- `list-refresh-failed-keeps-canvases.png`
- `list-restored-with-new-canvas.png`

### 其他必跑项

```text
Canvas Agent: tests 4 / pass 4 / fail 0
Director Desk: Test Files 87 passed (87), Tests 689 passed (689), Duration 88.71s
Worker: Ran 113 tests in 1.981s, OK (skipped=1)
```

Canvas Agent / Director Desk 使用同一个 pnpm CLI，分别执行规定的 workspace test。Worker 在一次性容器内执行 `python -m compileall -q worker` 和 `python -m unittest discover -s tests`；源码只读挂载，临时依赖及字节码位于容器内。

## 线上确认边界

此次可复现并修复的是切换列表的代码缺陷，线上当时具体请求状态、账号与服务端记录尚未核验。Studio 与 API 发布后，重新打开切换列表即可重新请求，旧画布是否完整仍以线上接口/数据库实际记录为准。若服务端成功响应仍没有某个项目，应进一步核对该项目归属空间、账号及历史删除记录，不应清空缓存或盲目覆盖恢复数据。

其他旧客户端仍可使用默认全量列表接口，这是为了保持兼容；本次画布切换器与画布选择页已经使用摘要接口。
