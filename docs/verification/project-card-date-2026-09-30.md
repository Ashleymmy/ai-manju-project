# 项目卡片日期去重验收

按用户最终选择保留右侧“9月30日”日期，删除左下方“9/30 更新”。日期仍取 `project.updated_at`，悬停提示为“更新于 9月30日”。

## 修改范围

- `apps/studio/client/src/features/projects/ProjectCard.tsx`：删除重复的日期段落，保留右侧日期。
- `apps/studio/client/src/features/projects/model.ts`：移除不再使用的 `chapter` 字段及重复日期格式化。
- 全部项目、工作台和聊天页使用同一个项目卡片组件，因此同步生效。
- 未修改项目数据、路由、卡片操作或其他页面样式；保留工作区之前的改动。

## 页面验证

本地 `/projects` 实际检查 8 张卡片：每张均只有右侧日期，左下方重复段落不存在。当前首张卡片显示“1”和“9月30日”，提示为“更新于 9月30日”。未执行生成、重命名或删除操作。

实际截图：

- `D:/AImanju4.0/output/project-card-date/projects-page.png`
- `D:/AImanju4.0/output/project-card-date/project-card.png`（从上述实际截图裁出）

## 命令及实际输出

日志目录：`D:/AImanju4.0/.tmp/project-card-date-20260930/`。

Studio 使用已有 pnpm 入口执行，以下结果为最终“保留右侧”版本重新验证的输出：

```text
pnpm --filter ai-manhua-studio check
studio check exit: 0

pnpm --filter ai-manhua-studio test
studio test exit: 0
Test Files  262 passed (262)
     Tests  2073 passed (2073)
  Duration  13.44s

pnpm --filter ai-manhua-studio build
studio build exit: 0
✓ built in 6.62s
```

构建有产物体积超过 500 kB 的提示，无错误。

API 在 `apps/api` 下使用已有 Go 运行时：

```text
go build ./...
go build exit: 0
go vet ./...
go vet exit: 0
go test ./...
go test exit: 0
ok  github.com/ai-manju/api/internal/repository (cached)
ok  github.com/ai-manju/api/internal/router (cached)
ok  github.com/ai-manju/api/internal/service (cached)
```

其余项目要求的检查：

```text
pnpm --filter @basketikun/canvas-agent test
canvas-agent test exit: 0
ℹ tests 5
ℹ pass 5
ℹ fail 0

pnpm --filter @ai-manju/director-desk test
director-desk test exit: 0
Test Files  87 passed (87)
     Tests  689 passed (689)
  Duration  108.87s

python -m compileall worker && python -m unittest discover -s tests
worker compile/test exit: 0
Ran 275 tests in 5.168s
OK (skipped=27)
```

Worker 使用已有 `ai-manju-worker-monitoring:20260923` 镜像，禁用网络、只读挂载源码。

`git diff --check`：通过，无输出。未提交、未部署、未重启服务。
