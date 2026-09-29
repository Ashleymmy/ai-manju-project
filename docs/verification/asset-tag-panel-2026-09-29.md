# 资产库分类标签边框与标题

日期：2026-09-29。未提交、未部署。

## 修改范围

- AssetTagFilter.css：将仅有上下边线改为完整 1px 细边框，使用已有 8px 界面圆角；背景和页内布局保持原样。
- AssetTagFilter.tsx：将“分类标签”改为语义化 h2 组件标题。
- 标题明确使用界面无衬线字体 Studio UI / 系统中文字体，15px、字重 600、行高 1.5、无额外字距。其余标签保持 13px。
- 只修改资产库分类标签组件，保留全部既有未提交工作。

## 浏览器验证

页面：`http://localhost:3100/assets`，使用已有登录状态。

- 实际四边均为 `1px solid rgba(239, 235, 222, 0.16)`，圆角为 8px。
- 标题实际为 H2，字号 15px、字重 600、行高 22.5px，字体为 Studio UI 系列。
- 展开“人物”子标签后，外框从 137px 高度自适应到 272px；119px 高的子标签面板完整位于外框内，没有裁切。
- 收起后恢复原高度，筛选选项保持完整。
- 截图：`output/asset-tag-panel/actual-page.png`。

## 必要检查及实际输出

完整日志：`.tmp/asset-tag-panel-20260929/`。本次为局部外观和标题语义修改，未新增测试；执行了项目要求的现有完整检查。

Studio check / test / build 全部退出 0：

```text
> ai-manhua-studio@1.0.0 check D:\AImanju4.0\apps\studio
> tsc --noEmit

Test Files  262 passed (262)
     Tests  2070 passed (2070)
  Duration  13.79s

✓ built in 6.78s
```

构建存在已有大于 500kB 的 chunk 提示。

API build / vet / test 全部退出 0，build/vet 无输出，测试输出节选：

```text
go-build=0 go-vet=0 go-test=0
ok  github.com/ai-manju/api/internal/sdvideo (cached)
ok  github.com/ai-manju/api/internal/service (cached)
ok  github.com/ai-manju/api/internal/storage (cached)
ok  github.com/ai-manju/api/internal/tagmigration (cached)
```

Canvas Agent 与 Director Desk 测试退出 0：

```text
ℹ tests 5
ℹ pass 5
ℹ fail 0
ℹ duration_ms 72.8783

Test Files  87 passed (87)
     Tests  689 passed (689)
  Duration  92.58s
```

Worker 使用已有镜像，只读挂载当前源码、禁用网络，执行 compileall 和 unittest，退出 0：

```text
Ran 275 tests in 5.468s
OK (skipped=27)
```

`git diff --check` 通过，无输出。
