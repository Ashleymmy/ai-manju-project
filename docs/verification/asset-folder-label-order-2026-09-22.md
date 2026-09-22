# 资产助手文件夹名称及画布目录顺序（2026-09-22）

## 结果

- 系统文件夹“漫剧资产助手”更名为“资产助手”，同步资产库目录、路径、移动目录下拉框及画布 @ 菜单和返回标题。
- “画布工坊”排在“未分类”之前。系统目录顺序为：画布工坊、未分类、手动上传、生图工作台、资产助手。
- 画布 @ 弹窗保留“当前画布 / 收藏夹 / 画布工坊 / 其他素材”的入口布局；“其他素材”里的助手目录使用新名称。
- 系统目录读取时按稳定标识原地更新名称和排序，保持原目录 ID、父子关系和资产引用。前端共享可见目录函数同时兼容旧服务或缓存中的名称和顺序。
- 用户自建的同名目录不被改名。

## 验证

前端验证旧名称和旧排序的目录数据、子目录路径、原始数据不变，以及 @ 弹窗进入资产助手后的真实目录 ID 和返回标题。后端验证个人/团队空间中的旧目录更新和幂等行为。

Memory 与 Gorm 均通过共享服务调用已有的仓库 Update 方法。已检查两套实现保留 ID、系统身份和创建信息，并在独立 PostgreSQL 16 容器运行真实 Gorm 一致性测试；测试容器已移除。

日志：`.tmp/asset-folder-presentation-qa/`。

```text
Targeted frontend tests
Test Files 3 passed (3)
Tests 52 passed (52)

go test ./internal/service -run TestAssetFolderDefaults -count=1
ok github.com/ai-manju/api/internal/service 0.138s

go test ./internal/service -run ^TestAssetFolderGormPostgresParity$ -count=1 -v
--- PASS: TestAssetFolderGormPostgresParity (0.54s)
PASS
ok github.com/ai-manju/api/internal/service 0.677s

pnpm --filter ai-manhua-studio check
$ tsc --noEmit
exit 0

pnpm --filter ai-manhua-studio test
Test Files 190 passed (190)
Tests 1247 passed (1247)
Duration 9.37s

pnpm --filter ai-manhua-studio build
✓ built in 3.10s
exit 0

go build ./...
exit 0
go vet ./...
exit 0
go test ./...
ok github.com/ai-manju/api/internal/router 1.531s
ok github.com/ai-manju/api/internal/service 2.970s
exit 0

pnpm --filter @basketikun/canvas-agent test
tests 4
pass 4
fail 0

pnpm --filter @ai-manju/director-desk test
Test Files 87 passed (87)
Tests 686 passed (686)
Duration 89.90s

python -m compileall -q worker && python -m unittest discover -s tests
Ran 92 tests in 2.586s
OK (skipped=1)

git diff --check
exit 0
```

Worker 使用源码只读挂载的独立容器，Redis 相关测试跳过 1 项。pnpm 自动移除的锁文件 override 已精确恢复。保留其他助理改动，未提交、部署或重启共享服务。
