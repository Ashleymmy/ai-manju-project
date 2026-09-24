# 全部项目加载超时与误报空列表修复

日期：2026-09-23。用户更正后的截图为 `codex-clipboard-e800d24b-a9ef-417b-ad02-17aba0705ea9.png`，页面为「全部项目」，错误是「请求超时或已取消」，request_id 为 `9cd52fdb-313d-4b4d-a0c8-b42597dfca66`。截图同时显示全部/未分组/侧栏项目数为 0，以及「还没有画布项目」。

## 排查结论与修复

代码中确认了两个相关缺陷：项目归档页、工作台和侧栏统计仍调用默认全量项目列表，该接口读取所有画布快照，页面实际只需要项目元信息；列表请求失败后又将本地状态置为空数组，将失败误显示成没有项目。此前画布切换列表的摘要接口修复没有覆盖这些入口。

- ProjectsPage、DashboardPage、ChatPage、侧栏和个人统计统一使用按账号/空间隔离的共享项目摘要查询，并复用请求。项目数量独立更新，无需等待资产/任务统计完成。
- 首次加载显示读取状态，未知数量显示 `—`；失败显示持续可见的重试提示。已有列表刷新失败时保留卡片和数量，不显示成功空态。保留有限自动重试，支持手动刷新、回到窗口或网络恢复后刷新。
- 最近画布入口、命令面板、资产库关联选择、复制时重名检查都改用摘要查询。普通列表请求携带 `include_data=false`；仅完整备份保留 `getProjects` 全量读取。
- 列表摘要不包含画布内容。归档页导出按需读取完整快照，失败时停止导出，避免把摘要导出成空画布。复制仍读取完整快照。
- API 路径、响应信封与鉴权保持原样。依赖前次已完成的 Memory/Gorm 摘要实现，未在本轮修改后端项目逻辑。

本轮只修复本地代码，没有访问或修改线上数据库，没有部署、提交或重启共享服务。线上请求的实际耗时及数据库记录尚未核验；截图本身不能证明项目已删除，也不能据此声称已找回线上项目。

## 验证结果

实际日志目录：`D:\AImanju4.0\.tmp\projects-loading-20260923\`。

### Studio

使用已安装的 pnpm CLI，设置 `npm_config_manage_package_manager_versions=false` 后执行项目规定的 check、test、build，均退出 0。

`studio-check.log`：

```text
> ai-manhua-studio@1.0.0 check D:\AImanju4.0\apps\studio
> tsc --noEmit
```

`studio-test.log`：

```text
 Test Files  214 passed (214)
      Tests  1483 passed (1483)
   Duration  12.81s
```

`studio-build.log`：

```text
✓ built in 8.69s
```

构建存在部分产物超过 500 kB 的提示，不影响成功。新用例覆盖归档/工作台首次失败与重试、缓存保留、请求复用、侧栏数量不等待其他统计、未知数量不显示 0、最近入口取消、导出完整内容及快照读取失败。现有卡片重命名、复制、删除、封面与分组测试通过。

### 浏览器

`apps/studio/e2e/projects-loading-recovery.spec.ts` 在现有本地 3100 服务中运行，全部应用 API 被测试接管，不操作用户真实项目。使用 Chrome 验证：

1. 持有列表请求不响应，触发真实 15 秒 HTTP 超时及一次有限重试。
2. 超时后数量显示 `—`，不出现「还没有画布项目」，保留明确重试入口。
3. 恢复接口并点击重试，3 张卡片及侧栏数量恢复。
4. 刷新返回 503 后仍保留之前的卡片和数量，再次重试可恢复。
5. 导出选中项目仅此时读取完整快照，成功下载 ZIP；普通列表全程 `include_data=false`，无页面运行异常。

最初试跑被首次版本公告遮罩挡住重试按钮，测试现已按正常用户操作关闭公告；没有用强制点击绕过遮罩。后续浏览器测试通过。截图检查另补充等待卡片入场动画结束和标题可见性断言，避免将动画第一帧当作最终页面。

最终 `browser.log` 实际输出，退出 0：

```text
ok 1 ... all projects retries timed-out requests, shares metadata and keeps cards on refresh failure (34.7s)
1 passed (35.9s)
```

截图位于日志目录的 `browser/projects-loading-recovery--ff654-ps-cards-on-refresh-failure/`：`timeout-is-not-empty.png`、`projects-restored.png`。

### API

使用 `.tmp/canvas-quality-qa/go-runtime/go/bin/go.exe`，在 `apps/api` 执行 `go build ./...`、`go vet ./...`、`go test ./...`，均退出 0。前两项无输出，`api-test.log` 摘录：

```text
ok  github.com/ai-manju/api/internal/handler     17.791s
ok  github.com/ai-manju/api/internal/middleware  2.062s
ok  github.com/ai-manju/api/internal/repository  (cached)
ok  github.com/ai-manju/api/internal/router      2.396s
ok  github.com/ai-manju/api/internal/service     11.414s
```

本轮没有设置 PostgreSQL 集成测试环境变量，可选数据库用例按测试约定跳过；未改变的 Memory/Gorm 摘要实现此前已在独立 PostgreSQL 中验收，实际输出见 `canvas-switcher-recovery-2026-09-23.md`。未连接生产库。

### 其他规定检查

Canvas Agent / Director Desk 分别执行规定的 workspace test，退出 0：

```text
Canvas Agent: tests 4 / pass 4 / fail 0
Director Desk: Test Files 87 passed (87), Tests 689 passed (689), Duration 85.97s
```

Worker 在一次性容器内执行 `python -m compileall -q worker` 和 `python -m unittest discover -s tests`，源码只读挂载，依赖与字节码保留在临时容器，退出 0：

```text
Ran 118 tests in 1.792s
OK (skipped=2)
```

相关文件 `git diff --check HEAD` 通过。共享工作区其他任务的合并冲突已消失，本轮未处理或覆盖其文件，也未改动暂存区。

## 发布边界

线上要获得完整性能修复，需要发布 Studio 及支持 `include_data=false` 的 API。只发布 Studio 时，旧 API 兼容可用，但仍可能返回完整快照，无法消除服务端读快照开销。上线后需重新打开「全部项目」核对真实记录；如成功响应仍缺少某个画布，再查账号、空间归属和删除记录，不应盲目清缓存或写入空快照。
