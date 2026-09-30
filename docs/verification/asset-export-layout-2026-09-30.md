# 资产详情导出记录排版

将右侧“导出”页签原来混排的状态、数量、文件名和按钮改为独立记录：第一行是状态、已导出数量 / 总数量、右侧操作；第二行是完整文件名。各记录用细分隔线隔开，数量从同一列开始对齐，文件名可自然换行，并保留完整名称提示。下载按钮使用标准 Download 图标。

仍使用后台真实导出数据，保留原来的最近 5 条范围、状态、下载 / 取消条件和处理函数。已过期记录保留信息，不增加不可用的下载按钮。未改后台数据、文件名或导出任务逻辑。

修改 AssetsPage.tsx 中导出列表的标记及资产库 styles.css 中局部样式；不影响详情栏其他页签和上一轮纵向操作按钮。新增空列表文案“暂无导出记录”。

## 实际页面检查

localhost:3100/assets 的导出页签显示 4 条真实记录：1 条已完成、3 条已过期，包括 5 / 5 和 302 / 302。详情内宽 235px，记录宽度和完成数量起始列一致，文件名分两行完整展示，无水平溢出、无 console error。未触发下载或取消任务。

截图：output/asset-export-layout/actual-page.png；操作区裁切：output/asset-export-layout/export-records.png。

## 实际验证输出

日志：.tmp/asset-export-layout-20260930/。

```text
pnpm --filter ai-manhua-studio check
$ tsc --noEmit
exit: 0

pnpm --filter ai-manhua-studio test
Test Files 265 passed (265)
Tests 2098 passed (2098)
Duration 13.21s

pnpm --filter ai-manhua-studio build
✓ built in 6.46s
exit: 0

go build ./... && go vet ./... && go test ./...
ok github.com/ai-manju/api/internal/service (cached)
exit: 0

pnpm --filter @basketikun/canvas-agent test
tests 5
pass 5
fail 0

pnpm --filter @ai-manju/director-desk test
Test Files 87 passed (87)
Tests 689 passed (689)
Duration 85.94s

python -m compileall worker && python -m unittest discover -s tests
Ran 275 tests in 4.268s
OK (skipped=27)

git diff --check
exit: 0
```

最终数量列左对齐调整后重新构建通过。Go / Worker 使用隔离容器；没有重启现有服务，没有提交或部署。既有大 chunk、pnpm 配置和 CRLF/LF 提示不影响验证。保留其他任务的修改。
