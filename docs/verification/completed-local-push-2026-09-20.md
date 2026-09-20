# 已完成修改推送验收（2026-09-20）

本批在独立工作目录验证并推送，以远端 `94a1319` 为基线，保留远端两项视频生成更新。视频历史先以 `49dbe19` 单独推送。

## 纳入范围

- 视频重新生成、重试、取消及刷新后的历史保留，新视频生成时间更新。
- Agent 生成期间插话及旧请求结果隔离。
- 独立节点复制、节点名称独立编辑、提示词面板三向缩放、图片裁剪比例。
- 图片预览失败恢复、缩略图插入引用、素材选择弹窗布局。
- 工作台项目卡片的封面、改名及删除操作。
- 关联画布存在时保护归档文件夹；画布删除后允许删除归档及子目录。
- 页面模块加载失败恢复、发布时保留旧版本静态资源。

## 保留在原工作区

按“助理1—助理5”对话的工作状态筛选，未纳入 Ctrl+V/系统剪贴板后续修复、最近编辑画布导航、批量生成排查、图片分辨率/精细度及对应 Worker 修改。共享文件按代码片段拆分；没有切换、回滚、暂存或覆盖原工作区。

## 本批实际验证输出

Studio（设置进程级包管理器选项，避免修改共享依赖；未更改锁文件）：

```text
pnpm --filter ai-manhua-studio check
$ tsc --noEmit
exit 0

pnpm --filter ai-manhua-studio test
Test Files  160 passed (160)
     Tests  988 passed (988)

pnpm --filter ai-manhua-studio build
✓ built in 4.74s
exit 0
```

首批视频历史单独验证：`150 passed` 文件、`889 passed` 测试，类型检查及构建通过。

后端在一次性 `golang:1.23-alpine` 容器读取隔离目录，运行 `go build ./... && go vet ./... && go test ./...`：

```text
exit 0
ok github.com/ai-manju/api/internal/handler (cached)
ok github.com/ai-manju/api/internal/repository 0.010s
ok github.com/ai-manju/api/internal/router (cached)
ok github.com/ai-manju/api/internal/service 0.122s
```

未改动两套仓库实现。归档删除通过共享 Service 使用工作区内的项目 ID 校验；提交的回归测试涵盖 Memory/Gorm 行为一致性。此次常规 Go 检查没有配置独立 PostgreSQL DSN，因此数据库专项分支沿用助理3在同一批后端文件上的完整验收记录（`.codex-logs/asset-folder-delete-v2-report.md`），不将本轮常规测试视作重新完成数据库联测。

```text
pnpm --filter @basketikun/canvas-agent test
ℹ pass 4
ℹ fail 0

pnpm --filter @ai-manju/director-desk test
Test Files  87 passed (87)
     Tests  686 passed (686)

python -m compileall worker
python -m unittest discover -s tests
Ran 80 tests in 0.367s
OK (skipped=1)
```

Worker 使用一次性容器和只读代码挂载，并在该容器补齐 `httpx==0.28.1`。未改动运行中的 Worker。

浏览器回归使用隔离页面与模拟 API，不访问真实项目数据、不调用生成供应商：

```text
素材选择弹窗（4 种尺寸及筛选）：5 passed
提示词面板三向缩放及刷新恢复：1 passed
独立节点复制及刷新恢复：1 passed
视频历史覆盖、刷新、播放及应用：1 passed
8 passed (2.9m)
exit 0
```

测试结束后，Windows 测试服务退出等待阻塞；核对进程仅属于本批的 53120 端口后关闭，测试运行器正常退出 0。没有重启原项目服务。

```text
node --test apps/studio/docker/retain-assets.test.mjs
ℹ tests 1
ℹ pass 1
ℹ fail 0

git diff --check
exit 0
```

本轮未构建或部署生产容器。旧静态资源首次上线前的迁移要求见 `docs/release-rollback-checklist.md`。
