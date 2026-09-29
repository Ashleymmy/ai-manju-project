# 真实错误与上游信息补充复核

## 本次修复

在恢复原有详情页之后，按“所有错误保留真实信息，尤其是上游信息”继续检查采集链路，修复以下遗漏：

- Go 模型客户端：HTTP 200 的错误信封、SSE 错误事件、语音接口返回的 JSON 错误，以及后续解析失败，现在保留本次响应的真实 HTTP 状态、上游请求编号、地址、方法和经过脱敏的错误正文。诊断附加在请求上下文，不修改原错误类型、重试条件或付费提交次数。
- 失败日志读取该上下文，避免只保存简化后的提示。成功调用不会因为观察到响应而被记为失败。二进制媒体内容不作为诊断保存。
- 错误信封识别补充数字错误码、大小写不同的 Response/Error/RequestId，以及校验错误的 loc、字段、类型和数值限度。保留上游实际提供的数据，不从提示文字推导错误码或时长限度。
- Worker 不再依赖英文 error/failed 关键词决定是否保留诊断，HTTP 200 的 success:false、数字错误码、中文 msg 等也能保留。仅在任务尝试确实抛出异常时写失败记录。
- 素材下载和存储请求记录实际接口、响应状态、请求编号和底层异常。已确定失败并即将丢弃的下载响应，最多读取 32 KiB 诊断；不读取成功媒体流。已经由业务读取的错误正文可以直接采集。
- 保留公开提示中被 `from None` 隐藏的真实异常链；DNS、TLS、连接被拒绝、响应读取异常不会只剩“连接失败”。不同请求/任务的状态和编号不能混用。底层连接多地址尝试后保留最后一次实际系统错误。

原有详情页的 17 个字段、名称、顺序和布局沿用上一轮恢复结果，本轮没有修改前端详情页。没有删除字段、已有记录或错误内容。没有收到上游响应时明确记录这一事实，不生成虚构状态码、正文或编号。

## 实际检查结果

本轮日志目录：`.tmp/runtime-upstream-audit-20260928/`。

API：`go build ./...`、`go vet ./...` 退出码 0；`go test ./...` 全部通过。新增 HTTP 测试使用本地测试服务器实际返回 HTTP 200/JSON/SSE/语音错误；同时断言没有额外提交、没有错误地变成 HTTP 拒绝类型，也没有保存成功媒体。

真实独立 PostgreSQL：

```text
--- PASS: TestRuntimeMonitoringRepositoryParity (1.20s)
    --- PASS: TestRuntimeMonitoringRepositoryParity/memory (0.00s)
    --- PASS: TestRuntimeMonitoringRepositoryParity/postgres (1.20s)
PASS
```

Worker 监控专项连接该数据库（包括实际 INSERT/SELECT、幂等及上游信息保存）：

```text
Ran 15 tests in 0.061s
OK
```

随后补充系统连接失败原始原因用例，最终 Worker 全量结果：

```text
Ran 275 tests in 3.957s
OK (skipped=27)
```

同时执行 `python -m compileall -q worker`，退出码 0。27 项继续按原有外部环境条件跳过；需要数据库的监控测试已另行运行。验证错误记录失败不会影响重试、生成恢复不重复提交、公共媒体安全边界、Storage 行为、成功媒体不被诊断读取。独立测试数据库容器已停止，没有使用用户数据库。

Studio：`check` 退出码 0；测试与构建实际输出：

```text
Test Files  255 passed (255)
     Tests  2021 passed (2021)
✓ built in 6.62s
```

构建保留已有大于 500 kB 的包体提示。

```text
Canvas Agent: tests 4, pass 4, fail 0
Director Desk: Test Files 87 passed (87), Tests 689 passed (689)
```

`git diff --check` 无错误。原详情页 1920/1440/390px、完整复制以及真实浏览器 fetch 失败的 3 项浏览器验证见 `runtime-details-preserved-2026-09-28.md`，本轮未重复运行未修改的页面测试。

## 生效和边界

本次修改在本地源码中，未更新线上或重启正在使用的 API/Worker。新版采集需要先更新 API 完成 diagnostics 字段的现有自动迁移，再更新 Worker/视频对账进程及前端。历史没有记录的响应无法事后补造。

错误摘要会脱敏并限长，不是把全部请求、媒体、凭证原样存入数据库。上游没有提供编号、没有响应、正文不可读或不能安全保留时如实显示未采集，不编造。进程退出、网络中断或数据库不可写时不能承诺日志必然写入；日志写入失败不改变付费生成、重试和恢复行为。

本轮是分层验证，不冒充线上真实任务复现。之前临时测试 API 启动被自动审批返回 `blocked by policy`；没有绕过启动，使用独立真实 PostgreSQL和已有浏览器测试完成相应验证。
