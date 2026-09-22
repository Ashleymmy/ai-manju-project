# 资产目录包跨账号导入导出（2026-09-22）

## 使用方式

1. 在资产库左侧选中文件夹“1”，点击“导出目录”。导出包含整个子树，不受当前分页和界面筛选限制。
2. 页面中间显示“导出任务”；完成后点击“下载资产包”，得到 ZIP。以后也可通过工具栏“导出任务”找回下载入口。
3. 接收方登录自己的账号，在资产库点击“导入资产包”，选择 ZIP。
4. 原目录及子目录（含空目录）恢复到接收方资产库根目录；资产恢复名称、分类、标签层级和绑定、备注、原始文件内容。
5. 接收方已有同名目录时，自动建立“1（导入 1）”等独立副本。不会覆盖已有资产。旧版无目录的散文件包导入当前选中的目录。

支持检查进度、暂停以及在当前页面继续／重试未完成项。已完成的文件不重复上传，结果不确定的上传重试沿用同一幂等键。离开页面会终止后续上传；已导入的数据保留。

## 实现与修复

- 后端所有资产 ZIP 增加 `assets.json` v2，同时保留原 `manifest.json`、`manifest.csv` 与画布片段格式。
- 导出冻结目录结构，保留原始目录名称、顺序、相对根目录及空目录；按实际写入 ZIP 的字节数登记文件大小。
- 标签按定义和父子关系携带，接收方创建或匹配自己工作区的同路径标签，再绑定自己的标签 ID。旧版名称数组改为以名称上传，不再误当作 ID；带逗号的标签用 JSON 数组保持完整。
- 兼容旧 `assets.json` v1 包及旧服务端 `manifest.json` 包。旧包只能恢复包内已有的信息，不能补回旧版未导出的空目录和备注。
- 目录包恢复前检查格式版本、文件、大小、目录和标签关联、重复标识、循环和路径。失败导出条目明确提示，上传失败可单独重试。
- “打包选中”改用同一个后端导出流程，避免原先文件读取失败仍下载不完整包且仅报告成功数量。
- 修复“导出筛选”字段命名不匹配及类型、日期等筛选遗漏，保留当前真实筛选条件。
- 导出进度和下载入口在资产列表上方显示，无需先选中某个资产；空目录也能导出。
- 调整文件夹名称点击区域，避免短名称的点击区域伸入右侧悬浮操作按钮下方。

共享服务使用既有仓库接口，Memory / Gorm 没有增加不同的写入规则。API 与生产导出 Worker 均接入标签定义读取。

## 验证

所有命令日志位于 `.tmp/asset-package-qa/`。保留工作区其他未提交修改。

```text
go build ./...
exit 0

go vet ./...
exit 0

go test ./...
ok github.com/ai-manju/api/internal/handler 17.407s
ok github.com/ai-manju/api/internal/router 1.517s
ok github.com/ai-manju/api/internal/service 1.766s
exit 0

go test ./internal/service -run ^TestAssetPackageGormPostgres$ -count=1 -v
--- PASS: TestAssetPackageGormPostgres (0.62s)
PASS
ok github.com/ai-manju/api/internal/service 0.760s

pnpm --filter ai-manhua-studio check
$ tsc --noEmit
exit 0

pnpm --filter ai-manhua-studio test
Test Files 191 passed (191)
Tests 1262 passed (1262)
Duration 9.05s

pnpm --filter ai-manhua-studio build
✓ built in 3.50s
exit 0

pnpm --filter @basketikun/canvas-agent test
tests 4
pass 4
fail 0

pnpm --filter @ai-manju/director-desk test
Test Files 87 passed (87)
Tests 686 passed (686)
Duration 89.89s

python -m compileall worker && python -m unittest discover -s tests
Ran 92 tests in 2.412s
OK (skipped=1)

node node_modules/@playwright/test/cli.js test --config .tmp/asset-package-qa/playwright.config.ts
ok 1 one user exports a folder ZIP and another restores files, nested/empty folders, labels and notes (8.8s)
1 passed (10.3s)

git diff --check
exit 0
```

专项覆盖：35 个同名资产（超过一页）、多层目录、原始目录名、空目录、标签定义和关联、备注、跨账号权限、兼容包、损坏包、失败重试、暂停继续、Unicode 名称长度。数据库验证使用独立 PostgreSQL 15 容器；Worker 使用源码只读挂载的独立容器，跳过依赖 Redis 的 1 项测试。

浏览器端到端测试使用独立临时 API 和 Studio、两个新测试账号。账号 A 在页面导出 ZIP，账号 B 在页面上传；核验目录、空目录、原文件字节、分类、备注和新账号标签 ID，并再次导入验证同名副本及源账号数据保持完整。测试文件：`apps/studio/e2e/asset-package-transfer.spec.ts`，日志：`.tmp/asset-package-qa/e2e.log`。

## 容量与运行状态

- 沿用后端每次最多 5000 个资产；单文件上传大小沿用服务端配置。
- 浏览器单包导入上限 512 MiB，解压总量上限 1 GiB；超过时提示分目录导出／导入。此限制只用于资产包，不改变画布 ZIP 的既有限制。
- 文件夹最大 6 层、标签最大 8 层，与后端一致。
- 本次完成代码和隔离环境验证；未更新或重启正在运行的共享服务。完整功能上线需要重新构建并更新 API、asset-export-worker 和 Studio。
- 构建仍有既有 pnpm override 和 Director Desk chunk 提示，不影响通过；pnpm 自动移除的锁文件 override 已精确恢复。
