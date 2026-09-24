# 节点吸附间距加大

## 后续调整：最终间距为 48

用户随后指定为 48，已将同一常量由 64 调为 48。新一轮日志位于 `.tmp/canvas-dock-gap48-20260923/`。实际拖动输出 `below dock gap: 48 px`、`right dock gap: 48 px`，`1 passed (3.2s)`；专项 41 通过，Studio check 退出 0、`205 passed (205)` / `1418 passed (1418)`、build `✓ built in 5.62s`；API build/vet/test 退出 0；Canvas Agent `tests 4 / pass 4 / fail 0`；Director Desk `87 passed (87)` / `689 passed (689)`，`Duration 90.12s`；Worker `Ran 113 tests in 2.372s`、`OK (skipped=1)`。以下为首次 64 间距的历史验收记录。

2026-09-23，本地完成。

`apps/studio/client/src/features/canvas/domain/nodeSnap.ts` 的统一吸附间距由 24 增至 64 画布单位。所有节点上下、左右贴靠均适用，给标题留下更多空隙。吸附触发范围、对齐辅助线、Alt 暂时关闭吸附保持原行为。既有节点坐标不会自动重排，下次拖动吸附时使用新间距。

已有对齐测试中一个场景使用旧吸附间距推算其无关的起始坐标，改为原本的固定坐标，继续检查同一对齐行为。未新增产品功能或改动其他助理的工作，无提交、部署、共享服务重启。

## 页面验收

在本地 Chrome、独立模拟 API 画布执行真实指针拖动，分别将视频节点吸附到图片节点下方和右方，测量 DOM 实际间距；下方吸附后标题与上方节点底边还留有超过 20px 空隙。100% 画布缩放的实际输出：

```
below dock gap: 64 px
right dock gap: 64 px
1 passed (3.6s)
```

页面无 pageerror。截图目录：`.tmp/canvas-dock-gap-20260923/browser/browser-verify-wider-docking-gaps-with-real-pointer-drags/`，已检查 `docked-below.png`。初次临时脚本因缺少 ESM 声明未运行，补充测试目录 package.json 后通过。

## 验证命令与输出

日志目录 `.tmp/canvas-dock-gap-20260923/`。pnpm 命令使用项目已安装的 CLI，设置 `npm_config_manage_package_manager_versions=false`。

```
pnpm --filter ai-manhua-studio test client/src/features/canvas/domain/nodeSnap.test.ts client/src/features/canvas/controllers/stage-interaction/controller.test.ts
Test Files  2 passed (2)
     Tests  41 passed (41)
```

```
pnpm --filter ai-manhua-studio check
> tsc --noEmit
```

退出码 0。

```
pnpm --filter ai-manhua-studio test
Test Files  205 passed (205)
     Tests  1418 passed (1418)
  Duration  10.81s

pnpm --filter ai-manhua-studio build
✓ built in 7.40s
```

构建退出码 0，仍有现有大于 500 kB 的分包提示。

API 在 `apps/api` 使用已有 Go 运行时执行 `go build ./...`、`go vet ./...`、`go test ./...`，均退出 0；前两项无输出，测试输出节选：

```
ok  github.com/ai-manju/api/internal/handler (cached)
ok  github.com/ai-manju/api/internal/provider (cached)
ok  github.com/ai-manju/api/internal/repository (cached)
ok  github.com/ai-manju/api/internal/router (cached)
ok  github.com/ai-manju/api/internal/service (cached)
```

完整输出见 `api-test.log`。

```
pnpm --filter @basketikun/canvas-agent test
ℹ tests 4
ℹ pass 4
ℹ fail 0

pnpm --filter @ai-manju/director-desk test
Test Files  87 passed (87)
     Tests  689 passed (689)
  Duration  95.43s
```

Worker 通过已有 Docker 镜像、只读源码挂载执行 `python -m compileall -q worker`、`python -m unittest discover -s tests`，临时依赖和字节码写入容器 /tmp：

```
Ran 113 tests in 1.985s
OK (skipped=1)
```

退出码 0。`git diff --check` 通过。
