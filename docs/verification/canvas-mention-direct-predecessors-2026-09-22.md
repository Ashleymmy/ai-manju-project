# 所有节点的 @ 弹窗仅显示直接前置节点（2026-09-22）

## 行为

- A → B → C：在 C 输入 @，节点列表只显示 B，不显示 A。
- 如果另有 A → C，则 A、B 都显示，每个节点只出现一次。
- 图片、视频、音频、文本、提示词、便笺、配置、导演节点使用同一规则。
- 搜索、进入素材文件夹或收藏夹时，节点区域继续只显示直接前置节点。

修改位于共享菜单构建函数 `buildCanvasMentionLibraryMenu`，按入边距离 1 筛选候选节点。完整引用数据仍保留，已有提示词中的引用解析及生成输入逻辑不变。保留其他助理对素材目录的调整。

## 验证

- 共享菜单测试覆盖直接连接、间接祖先、下游和旁支排除、环路、无效边、重复边，以及搜索和各资产目录。
- 使用真实 Inspector 和引用编辑组件，对全部 8 类节点输入 @：弹窗仅有直接前置节点，点击后插入正确的节点引用。
- 相关测试文件分别为 `mentionLibrary.test.ts`（10 项）和 `CanvasInspectorMentionInsertion.test.tsx`（17 项），均包含在 Studio 全量测试中。
- 本次为共享筛选逻辑修改，使用组件集成测试验收；未进行真实生成或线上部署。

日志：`.tmp/canvas-mention-direct-qa/`。

## 实际输出

```text
pnpm --filter ai-manhua-studio check
$ tsc --noEmit
exit 0

pnpm --filter ai-manhua-studio test
Test Files 190 passed (190)
Tests 1234 passed (1234)
Duration 9.33s

pnpm --filter ai-manhua-studio build
✓ built in 3.26s
exit 0

go build ./...
exit 0
go vet ./...
exit 0
go test ./...
ok github.com/ai-manju/api/internal/router (cached)
ok github.com/ai-manju/api/internal/service (cached)
exit 0

python -m compileall -q worker && python -m unittest discover -s tests
Ran 92 tests in 1.957s
OK (skipped=1)
```

Go 使用已有工具链及缓存。Worker 使用源码只读挂载的独立测试容器，Redis 相关测试跳过 1 项。

```text
pnpm --filter @basketikun/canvas-agent test
tests 4
pass 4
fail 0

pnpm --filter @ai-manju/director-desk test
Test Files 87 passed (87)
Tests 686 passed (686)
Duration 90.81s

git diff --check
exit 0
```

已精确恢复 pnpm 自动移除的锁文件 override，锁文件无差异。未提交或重启共享服务。
