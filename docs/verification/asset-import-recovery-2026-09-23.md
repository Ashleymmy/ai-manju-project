# 资产包导入跨页面与刷新恢复验收

日期：2026-09-23。范围：资产库「导入资产包」任务。代码已完成；未发布到 studio.clouddo.cc。

## 原因与修复

原来的任务、原始 File、进度和取消控制器均属于 AssetsPage。页面卸载会直接 abort；刷新会丢失全部内存状态。

- 导入由应用级任务管理器持有，资产库、项目页、画布等页面共用固定的「导入任务」入口；页面卸载不再取消导入。
- 开始前在 IndexedDB 原子保存资产包和任务记录。大 Blob 与小进度记录分离，不在每次更新进度时复制整个包。完成后自动删除缓存的原始包。
- 保存会话标识、目录/标签映射、待创建名称、已完成素材和失败项。刷新后登录原账号，自动重新打开本地包并接续运行；主动暂停保持暂停。
- 目录、标签创建新增可选 idempotency_key；服务端按用户及空间生成稳定 ID。上传沿用稳定会话上传键。刷新时即使服务端已经完成、浏览器尚未收到结果，也不会再创建一份。
- 使用 IndexedDB 事务领取/续期任务，覆盖 HTTP 站点没有 Web Locks 的情况。其他标签页显示共享进度；原标签页消失后可接续。租约 15 秒，检查周期 3 秒。
- 每个请求前校验已认证账号及 token；账号切换后旧任务停止发送请求，重新登录原账号再接续。
- 原始包保存失败时不开始服务器写入；进度保存失败则停止后续修改。结束任务仅清理本地缓存，已导入素材保留。

## 浏览器验证

隔离 Go API 3397 / Vite 3396，Chrome headless，独立账号和本地测试素材目录；没有重启或修改 3100/3101，也没有访问线上素材进行写入。

`apps/studio/e2e/asset-package-recovery.spec.ts`：

1. 导入途中跳转全部项目页，任务继续；第 4 项已经落库但响应尚未返回时刷新，最终 8/8，没有重复素材。
2. 第二个标签页跟踪同一任务，最终显示 8/8；完成后 sources 存储为空。
3. 手动暂停后刷新，超过自动检查周期仍不恢复；点击继续后完成。
4. 文件夹创建成功但响应丢失时刷新，最终只有原计划的两个目录。
5. 标签创建成功但响应丢失时刷新，最终只有一个导入标签。
6. 导入运行时更换账号 token，另一账号没有收到旧任务素材；回到原账号恢复完成。
7. 注入缓存配额错误，页面明确报告未开始导入；无服务端素材写入，无残缺任务记录。

对应测试输出（该文件 6 个用例；多项断言在同一用例）：

```text
ok ... navigation continues; refresh recovers a lost upload response without duplicates; a second tab follows
ok ... explicit pause survives refresh and resumes only on request
ok ... refresh after a asset-folders response is lost reuses the created definition
ok ... refresh after a tags response is lost reuses the created definition
ok ... changing account cannot continue the previous user's import with the new token
ok ... storage quota failure performs no partial server import
```

跨账号导出/导入原有回归通过：目录层级、空目录、标签、备注、分类及二次独立导入保持原行为。

大包刷新验证：1,212,171,649 字节 ZIP64，34 个各 34 MiB 的素材，已导入至少两项时刷新，自动恢复到 34/34，服务端总数和唯一 ID 数均为 34。额外拦截任何大于 64 MiB 的 Blob.arrayBuffer 调用，确保未读取整包到内存。

```text
ok 1 ... imports a large folder package without reading the whole ZIP (44.4s)
1 passed (46.6s)
```

首次大包验证在系统盘浏览器临时目录写入失败，任务在服务器修改前停止并显示空间提示。复测仅将测试浏览器 TEMP/TMP 放到 D 盘独立目录后通过，未更改用户浏览器设置。该场景体现自动恢复确实需要本地存储原始包，不应伪装成缓存成功。

## 项目验证实际输出摘要

```text
go build ./... : exit 0
go vet ./...   : exit 0
go test ./...  : exit 0
ok github.com/ai-manju/api/internal/handler (cached)
ok github.com/ai-manju/api/internal/repository (cached)
ok github.com/ai-manju/api/internal/router (cached)
ok github.com/ai-manju/api/internal/service 11.416s
ok github.com/ai-manju/api/internal/storage (cached)

TestImportDefinitionsReplayAndIsolateKeys/memory   PASS
TestImportDefinitionsReplayAndIsolateKeys/postgres PASS

pnpm --filter ai-manhua-studio check : exit 0
pnpm --filter ai-manhua-studio test
Test Files 198 passed (198)
Tests 1327 passed (1327)
pnpm --filter ai-manhua-studio build : exit 0
✓ built in 4.93s

Canvas Agent: tests 4 / pass 4 / fail 0
Director Desk: Test Files 87 passed (87), Tests 686 passed (686)
Worker: Ran 105 tests in 2.030s, OK (skipped=1)
```

PostgreSQL 对照在单独的 postgres:16-alpine 容器、事务隔离 schema 内执行；两种仓库均验证同键重放、跨账号/空间隔离以及不同任务仍遵守名称冲突规则。未改数据库结构。

Worker 使用临时容器及只读源码挂载。默认 PyPI 连接失败后，使用清华 PyPI 镜像在临时容器安装 httpx==0.28.1，再执行 compileall 和全部 unittest；没有更改共享 Worker 服务。Studio 构建仅有已有的大 chunk 提示，pnpm 提示根 overrides 配置位置旧，均不阻断构建。

## 使用边界与发布

- 首次「正在保存资产包」阶段尚未完成原子保存，页面会提示不要刷新，刷新会触发浏览器离页提示。
- 缓存完成后，同一浏览器、同一站点中切页继续、刷新自动接续，不必重新选包。关闭所有页面/浏览器期间不执行上传，重新打开并登录原账号后接续。清除站点数据会移除本地恢复文件。
- 当前每个账号保留一个导入任务，未完成前不会被另一个包覆盖；原有素材数量/ZIP64能力保持。
- 前后端需要一起发布，确保目录/标签请求使用服务端幂等处理。此任务未提交、推送或部署；保留了其他助理的暂存改动。
