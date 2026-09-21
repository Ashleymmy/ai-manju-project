# 画布节点菜单调整（2026-09-21）

按截图把图片节点的“素材与文件”移到“节点操作”标题下的第一项，保留其中的查看图片、复制提示词、替换图片、加入素材库操作。删除该菜单中的“选中节点”“从此节点连接”“生成当前模式”三项，并移除组件中因此不再使用的动作解构。

本轮产品代码只调整 `apps/studio/client/src/features/canvas/ui/CanvasStage.tsx` 的节点菜单。该文件里其他任务已有的选区连线改动已保留。未新增测试，使用现有检查验证；未提交或发布线上。

## 验证结果

```text
pnpm --filter ai-manhua-studio check
$ tsc --noEmit
exit 0

pnpm --filter ai-manhua-studio test
Test Files 184 passed (184)
Tests 1172 passed (1172)

pnpm --filter ai-manhua-studio build
✓ built in 3.07s

go build ./... && go vet ./... && go test ./...
exit 0
ok github.com/ai-manju/api/internal/handler (cached)
ok github.com/ai-manju/api/internal/router (cached)

pnpm --filter @basketikun/canvas-agent test
tests 4
pass 4
fail 0

pnpm --filter @ai-manju/director-desk test
Test Files 87 passed (87)
Tests 686 passed (686)

python -m compileall -q worker && python -m unittest discover -s tests
Ran 92 tests in 1.724s
OK (skipped=1)

git diff --check
exit 0
```

日志目录：`.tmp/canvas-node-menu-qa/`。Go 使用已有的本地工具链；Worker 在独立 Linux 测试容器中只读挂载源码验证，未重启共享服务，跳过的是未配置 Redis 的集成测试。构建存在已有的包体积提示，不影响通过。
