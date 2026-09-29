# 运行记录详情完整性复核

## 确认的问题与纠正

用户指出的问题成立：上一版 `monitoringDetailFields` 的条件添加逻辑跳过了无值字段，部分标签和顺序也被调整。这使模型、诊断详情、处理建议、任务/项目/节点编号等字段在旧记录中消失。该展示变更不符合“保留原详情页，只补齐真实信息”的要求，现已纠正。

原有字段固定展示，不再因内容为空、来源不同或记录较旧而移除：

用户、状态、操作、模型、错误码、错误信息、诊断详情、处理建议、接口、HTTP 状态、上游状态、请求编号、任务编号、项目编号、节点编号、尝试次数、耗时。

- 保持原顺序、双列排列，以及错误信息/诊断详情/处理建议整行布局；小屏继续单列滚动。
- 现有字段和值完整保留。缺少值时显示“未记录”；未收到响应和权限受限分别说明，不生成状态码或编号。
- 原诊断详情没有值、而已采集真实异常/响应正文时，直接显示已有真实内容；不覆盖原来非空的诊断详情。
- 新增异常、响应摘要、上游请求编号等内容附加在原字段之后，不替换原字段。
- 修复另一处显示遗漏：已保存上游正文，但没有 URL/HTTP 状态时，该正文仍必须显示。
- 404、Not Found、实际接口和请求编号继续展示。复制使用完整原记录，不因展示缺少字段而删除数据。
- 检查模型/仓库差异：只新增 diagnostics，未删除既有数据库字段或历史记录。本轮没有修改采集/持久化业务逻辑。

## 本地运行环境核对

复核时现有 API 使用 `ai-manju-transfer-tasks:20260928`，Worker 使用 `ai-manju-worker-monitoring:20260923`。本次未重建或重启现有运行服务。前端本地源码已更新，后端新增诊断采集仍需更新 API/Worker 后生效；历史未保存的信息不能因恢复字段展示而补造。

截图中的 `/api/admin/generation-recovery` 在当前源码中已有路由及注册，本轮未修改该功能，也未把对应错误记录过滤掉。

## 验证实际输出

原始日志与截图：`.tmp/runtime-details-preserved-20260928/`。

### API 和两种仓库

`go build ./...`、`go vet ./...` 退出码均为 0；`go test ./...` 全部通过。

扩展原有一致性测试，逐项验证操作、模型、错误码、诊断详情、建议、接口、状态、所有关联编号、尝试次数和耗时没有在写入/读取时丢失。使用独立真实 PostgreSQL：

```text
--- PASS: TestRuntimeMonitoringRepositoryParity (4.48s)
    --- PASS: TestRuntimeMonitoringRepositoryParity/memory (0.00s)
    --- PASS: TestRuntimeMonitoringRepositoryParity/postgres (4.48s)
PASS
```

独立测试容器已停止，没有使用用户的数据库。

### Studio

`pnpm --filter ai-manhua-studio check`：`tsc --noEmit` 退出码 0。

```text
Test Files  255 passed (255)
     Tests  2021 passed (2021)
```

```text
✓ built in 6.54s
```

构建保留现有大于 500 kB 的包体提示。首次全量运行中，未修改的 `operationTask.test.ts` 出现超时并导致后续用例失败；单独复跑 21 项通过，再次完整运行 2021 项全部通过。首次输出保留在 `studio-first-run.log`，没有放宽或删除这些测试。

### 浏览器

```text
ok upstream details remain readable, copyable and responsive
ok the screenshot's legacy 404 retains all seventeen original fields and copy content
ok a real browser fetch failure reports original exception and request correlation
3 passed (13.0s)
```

覆盖 1920px 的旧 404 记录、1440px/390px 的上游错误记录，固定 17 字段、字段次序、双列对应关系、原报错文字、复制的完整 JSON，以及真实 fetch 失败的采集。截图已查看。界面测试使用明确的测试响应，不作为用户真实任务错误，也没有向用户库写测试记录。

布局测试最初在弹窗动画不同帧分别量取左右字段位置，产生浮点差值；改为在同一帧读取左右位置后通过，未放宽字段存在/内容断言。

### 其他必跑检查

```text
Canvas Agent: tests 4, pass 4, fail 0
Director Desk: Test Files 87 passed (87), Tests 689 passed (689)
Worker: Ran 268 tests in 9.272s; OK (skipped=27)
```

Worker 同时执行 `python -m compileall -q worker`，退出码 0；27 项沿用原有环境依赖跳过条件。
