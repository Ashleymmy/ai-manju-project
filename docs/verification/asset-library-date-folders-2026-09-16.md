# 资产库移除自动日期目录验收

需求：资产库中不再出现系统自动创建的月份/日期文件夹，后续上传、生成、历史回填均不再创建此类目录。

## 行为

- 生图工作台直接归入工作台目录；有归属画布的默认素材归入对应画布的“其他”；未归属画布的素材直接放在“未归属画布”。
- 文件夹列表读取时将历史日期目录中的活动素材归并到上述位置，移除公开列表中的日期层级。目录下用户创建的子目录提升到上一级，素材 ID、文件、URL 保持不变。
- 历史日期记录仅作为内部兼容引用保留，避免已排队的 Worker 或回收站记录失去原始目的地。查询会包含兼容引用中的延迟结果；旧目录 ID 的新写入和回收站恢复会转向新目的地。再次读取列表会归并延迟写入的结果。
- 资产库、画布引用和素材选择器共用目录显示规则；用户自己创建的日期名称文件夹保留。
- 历史回填入口不再生成日期目录，计划中的目录数量与新的四分类目录规则保持一致。

## 实际验证输出

后端在 Go 1.23 验证容器中挂载当前源码执行 `go build ./...`、`go vet ./...`、`go test ./...`，退出码均为 0。相关输出：

```text
ok  github.com/ai-manju/api/internal/assetmigration  0.004s
ok  github.com/ai-manju/api/internal/handler         11.178s
ok  github.com/ai-manju/api/internal/repository      0.005s
ok  github.com/ai-manju/api/internal/router          0.364s
ok  github.com/ai-manju/api/internal/service         0.125s
```

最后补充回填幂等性处理后，重新执行构建、静态检查及相关测试，退出码为 0：

```text
ok  github.com/ai-manju/api/internal/assetmigration  0.003s
ok  github.com/ai-manju/api/internal/service         0.119s
```

独立临时 PostgreSQL 15 数据库运行内存/PostgreSQL 一致性回归，覆盖三个旧目录来源、重复迁移、素材 URL 保留、用户子目录提升、延迟结果查询、回收站恢复、旧目录写入重定向、跨工作区拒绝访问：

```text
--- PASS: TestRetiredDateFoldersPreserveAssetsParity (0.23s)
--- PASS: TestAssetFolderGormPostgresParity (0.27s)
--- PASS: TestCanvasDefaultAssetDestinationParity (0.15s)
PASS
ok  github.com/ai-manju/api/internal/service  0.650s
```

Studio `check`、`test`、`build` 均退出码 0：

```text
> tsc --noEmit
Test Files  126 passed (126)
     Tests  679 passed (679)
✓ built in 2.86s
```

前端新增回归覆盖：自动日期隐藏、同名用户目录保留、旧日期子目录提升、原始数据不被显示层修改。

## 当前本地服务

构建并更新 `ai-manju-40-api-1`；临时测试数据库已停止并自动删除。Studio 本地页面返回 HTTP 200。

使用当前配置账号，通过正常登录及公开 API 核对同一个人资产库（不输出凭据）：

```json
{"Phase":"before update","FolderResponse":true,"AutomaticDateFolders":8,"AssetTotal":19}
{"Phase":"after update","Health":200,"FolderResponse":true,"AutomaticDateFolders":0,"AssetTotal":19,"AssetsInVisibleFolders":19}
```

`git diff --check` 通过。未提交或推送仓库。
