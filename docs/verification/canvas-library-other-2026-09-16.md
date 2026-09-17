# 画布四分类及默认归档验证

## 本次行为

- 新建画布的同名关联文件夹包含角色、场景、道具、其他四个子文件夹；改名保持关联和目录 ID。
- 上传及生成素材没有指定分类时，进入当前画布的其他目录，不再新建日期目录。
- 手动选择分类时移动已有素材，保留素材 ID 和文件地址。
- 读取旧画布素材目录时补齐分类，把原总目录、自动日期目录内的素材归入其他；已分类素材和用户子目录保持原位。
- 非空文本节点自动保存到当前画布的其他分类；自动保存与手动分类串行处理，避免相互覆盖。

## 验证结果

后端使用 Docker 的 Go 1.23 构建环境执行 `go build ./...`、`go vet ./...`、`go test ./...`，全部退出 0。测试输出节选：

```text
ok  github.com/ai-manju/api/internal/handler       11.188s
ok  github.com/ai-manju/api/internal/repository    0.007s
ok  github.com/ai-manju/api/internal/router        0.367s
ok  github.com/ai-manju/api/internal/service       0.122s
```

另建独立 PostgreSQL 临时数据库验证 Memory/Gorm 行为一致，以下用例两种实现均通过：

```text
--- PASS: TestCanvasProjectLibraryParity (0.23s)
--- PASS: TestCanvasProjectLibraryRollbackParity (0.15s)
--- PASS: TestOpeningLegacyCanvasEnsuresLibraryParity (0.10s)
--- PASS: TestListingCanvasFoldersRepairsMissingCategoriesParity (0.10s)
--- PASS: TestCanvasDefaultAssetDestinationParity (0.14s)
PASS
```

Studio 的 `check`、`test`、`build` 均退出 0：

```text
Test Files  126 passed (126)
     Tests  678 passed (678)
✓ built in 5.38s
```

Canvas Agent 和 Director Desk 测试：

```text
Canvas Agent: tests 4, pass 4, fail 0
Director Desk:
Test Files  87 passed (87)
     Tests  686 passed (686)
```

Worker 旧验证镜像缺少 httpx。在临时容器内依据现有 `requirements.lock` 安装带哈希校验的依赖后执行 `python -m compileall -q worker` 和 `python -m unittest discover -s tests`，退出 0：

```text
Ran 78 tests in 0.124s
OK (skipped=1)
```

使用与本地服务相同的新 API 镜像，在临时内存实例中实际调用注册、创建画布、上传图片、素材列表、重新分类和改名接口：

```text
PASS: create four categories; upload defaults to other; list includes upload; role/other reclassification preserves asset ID and URL; rename stays linked; no date folders.
```

临时数据库及 HTTP 验证实例均已停止并自动删除。现有 API 服务已更新，保留其数据库和素材卷。网页服务已恢复，HTTP 返回 200；API 健康检查返回 `success: true`、`db: ok`、`storage: postgres`。`git diff --check` 通过。

构建保留 Director Desk 原有的部分产物超过 500 kB 提示。本次没有提交或推送。
