# “其他素材”文件夹导航（2026-09-22）

## 修复结果

“其他素材”不再把所有资产直接平铺。进入后显示顶层文件夹：

- 未分类
- 手动上传
- 生图工作台
- 漫剧资产助手
- 用户在资产库创建的其他顶层文件夹

系统文件夹排在用户文件夹之前，用户文件夹按名称和排序字段排列。点击任意文件夹后进入真实的 `folder:<id>` 目录，目录内继续显示子文件夹和素材。日期归档层仍由现有可见文件夹规则提升，不会额外显示隐藏的日期层。

这次修改只调整画布 @ 引用菜单的数据展示层；素材接口、文件夹 ID、分页和资产引用解析保持不变。当前层只展示文件夹，不把整个资产库的内容重复平铺出来。

## 验证

- mention library 单元测试覆盖系统文件夹、用户自建文件夹、排序、搜索过滤和进入真实文件夹。
- 引用编辑器测试确认进入“其他素材”后显示上述文件夹，并可点击“未分类”进入 `folder:unfiled`。
- Studio 全量检查、测试和构建通过；API、Canvas Agent、Director Desk、Worker 检查通过。

日志：`.tmp/canvas-mention-direct-qa/`。

## 实际输出

```text
pnpm --filter ai-manhua-studio check
$ tsc --noEmit
exit 0

pnpm --filter ai-manhua-studio test
Test Files 190 passed (190)
Tests 1235 passed (1235)
Duration 11.32s

pnpm --filter ai-manhua-studio build
✓ built in 8.26s
exit 0

go build ./...
exit 0
go vet ./...
exit 0
go test ./...
exit 0

pnpm --filter @basketikun/canvas-agent test
tests 4
pass 4
fail 0

pnpm --filter @ai-manju/director-desk test
Test Files 87 passed (87)
Tests 686 passed (686)
Duration 157.71s

python -m compileall -q worker && python -m unittest discover -s tests
Ran 92 tests in 2.279s
OK (skipped=1)

git diff --check
exit 0
```

Go 使用已有工具链及缓存。Worker 使用源码只读挂载的独立测试容器，Redis 相关测试跳过 1 项。pnpm 自动移除的锁文件 override 已精确补回，锁文件无差异。未提交或重启共享服务。
