# 标签新建防护、诊断与批量选择

## 状态与事实

- 本地代码与隔离验证完成；未提交、未推送、未发布。已有其他画布改动原样保留。
- 用户确认报错发生在 `http://studio.clouddo.cc`，不是 localhost，标签此前未创建或删除。
- 用户提供的监控记录：`POST /api/tags`，HTTP 409，`tag already exists`，请求号 `37437383-61df-4bc9-b6c2-bca2fb8cd8bf`，诊断详情为空。
- 公开健康检查确认线上使用 PostgreSQL；当前没有线上登录会话或数据库/服务器日志访问入口。仅凭截图无法确定本次命中了哪个唯一约束，不能宣称线上创建失败已彻底修复。
- 本地查到的同名标签不是线上证据，不能用来否定用户的操作说明。

## 修改内容

### 标签列表

- 增加全选、全选当前筛选结果、清空选择。
- 支持 Shift 连续勾选及取消，Ctrl/Cmd 点击行可增减选择；普通点击仍查看详情。
- 筛选后只操作可见、可编辑的行，保留其他筛选下已选项；只读标签不可加入批量操作。
- 选择结果直接供原有批量移动、批量删除使用。手机宽度保留搜索和选择工具。
- 将行内复选框与查看详情按钮分离，消除交互控件嵌套。

### 新建流程

- 按后台规则检查同归属、同父级的名称，合并空白、忽略大小写；不同父级同名不误拦。
- 增加同步提交锁和按请求内容复用的幂等标识；服务端已成功但返回丢失时，重试不会创建第二份。兼容新建时缺少 `crypto.randomUUID` 的环境。
- 真正找到已有标签时提供查看入口；服务端冲突时补查当前权限范围内的归档记录，允许用户明确点击恢复，保留旧设置、关联和子标签状态。
- 未找到冲突记录时保留输入并提示联系管理员查看监控，不武断宣称用户已经创建过。
- 不改变后台命名唯一性、删除/归档规则，不自动合并或删除用户数据。

### 后台诊断

- 原 Gorm 标签仓库把所有唯一约束错误笼统变成重名，包括主键或可能的旧索引冲突。现只将已知标签名称/别名约束归为重名；其他 PostgreSQL 错误保留分类。
- 错误包装保留数据库原因，监控可以记录 SQLSTATE、表名、约束名及排查建议。
- 不把数据库行值、其他用户标签内容或 SQL 原文放到页面；诊断继续沿用现有用户隔离。
- 公共响应信封、路由和鉴权不变。真实名称冲突仍是 409；非名称数据库错误不再误报 409。
- Memory 仓库本来就是按归属、父级、规范化名称检查，不需修改。运行了 Memory/PostgreSQL 幂等与隔离一致性测试。

## 验证结果

本轮实际输出摘要。pnpm 命令使用 `--config.verify-deps-before-run=warn`，未更新依赖或锁文件。

```text
定向 Vitest（标签匹配、HTTP 环境、选择范围、API 参数）
Test Files  3 passed (3)
     Tests  23 passed (23)
  Duration  343ms

pnpm --filter ai-manhua-studio check
$ tsc --noEmit
退出 0

pnpm --filter ai-manhua-studio test
Test Files  225 passed (225)
     Tests  1643 passed (1643)
  Duration  10.73s

pnpm --filter ai-manhua-studio build
2974 modules transformed.
退出 0

pnpm --filter ai-manhua-studio exec playwright test --config e2e/playwright.tags.config.ts
7 passed (18.9s)

pnpm --filter @basketikun/canvas-agent test
tests 4 / pass 4 / fail 0

pnpm --filter @ai-manju/director-desk test
Test Files  87 passed (87)
     Tests  689 passed (689)
  Duration  108.29s
```

API 在 `apps/api` 使用已有 `.tmp/canvas-quality-qa/go-runtime/go/bin/go.exe`：

```text
go build ./...  (退出 0)
go vet ./...    (退出 0)
go test ./...   (退出 0，节选)
ok github.com/ai-manju/api/internal/handler (cached)
ok github.com/ai-manju/api/internal/middleware (cached)
ok github.com/ai-manju/api/internal/repository (cached)
ok github.com/ai-manju/api/internal/router 1.490s
ok github.com/ai-manju/api/internal/service 10.008s

go test ./internal/service -run '^TestImportDefinitionsReplayAndIsolateKeys$' -count=1 -v
--- PASS: TestImportDefinitionsReplayAndIsolateKeys (0.12s)
    --- PASS: TestImportDefinitionsReplayAndIsolateKeys/memory (0.00s)
    --- PASS: TestImportDefinitionsReplayAndIsolateKeys/postgres (0.12s)
PASS
```

PostgreSQL 定向测试仅在独立事务内建临时 schema，测试结束回滚；未修改业务数据。其他默认跳过的集成测试不计为已覆盖。

Worker 使用已有 `ai-manju-worker-monitoring:20260923` 镜像，只读挂载源码：

```text
python -m compileall worker  (退出 0)
python -m unittest discover -s tests
Ran 131 tests in 2.086s
OK (skipped=9)
```

浏览器 API 全部拦截，没有线上写入、真实任务或积分消耗。测试验证实际新建、重试、恢复和批量移动的请求参数；桌面 1600px 与手机 390px 截图已核看，位于 `test-results/tag-creation`。保留现有大包及依赖同步警告。`git diff --check` 通过。

## 线上剩余工作

需要线上管理员读取该请求对应的 PostgreSQL/API 错误日志，确认约束名称。若旧日志无法提供，应在获准发布本次诊断代码后复现并读取新增诊断。可先只读检查实际索引定义：

```sql
SELECT schemaname, indexname, indexdef
FROM pg_indexes
WHERE tablename = 'tags';
```

只有确认实际索引或数据问题后，才制定针对性迁移。当前没有擅自删除索引、清空标签、修改线上数据库或重启共享服务。
