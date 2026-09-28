# 视频节点手动选择全能参考

## 原因与修复

菜单点击会正确写入 `videoSubMode: reference`，但读取模式时只根据提示词有没有 @ 引用决定文生/参考模式。没有引用时，手动选择立即被自动判断覆盖。

- 菜单选择写入 `videoSubModeManual`，读取时优先尊重有效的手动模式。
- 普通文字输入不改变手动选择；标志、按钮和输入框提示同步使用所选模式。
- 添加第一个引用、删除最后一个引用时恢复原有自动切换，并清除手动标记。
- 标记随原有画布快照保存，刷新后保留选择。
- 老节点没有手动标记时保留原来的自动判断和旧数据修复行为。
- 仅修改画布模式选择逻辑及对应测试；未修改生成服务、模型能力、积分或接口契约。上一轮加载动画改动原样保留。

生产文件：`CanvasInspector.tsx`、`CanvasWorkspaceContent.tsx`、`domain/nodeUtils.ts`、`domain/types.ts`。

## 浏览器复现与验收

```text
pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio exec playwright test --config e2e/playwright.video-submode.config.ts

修复前：1 failed (17.7s)
Locator: locator('.inspector-panel').getByRole('button', { name: '全能参考', exact: true })
Expected: visible
Error: element(s) not found

修复后：1 passed (9.1s)
```

实际画布中点击验证了：无引用时直接选择全能参考、输入普通文字、自动保存并刷新恢复、与视频编辑及文生视频来回切换、添加引用后的自动切换、有引用时仍可手动切换，以及移除最后一个引用后回到文生视频。

使用已有 `http://127.0.0.1:3100` 服务、独立 Playwright 配置，全部业务 API 被测试隔离，保存只更新测试快照。未写入真实用户数据，未发起付费生成，未重启服务。

## 项目检查

以下为本轮实际输出摘要，命令均退出 0。pnpm 使用 `--config.verify-deps-before-run=warn`，保留本地现有依赖，没有安装或修改锁文件。

```text
pnpm --filter ai-manhua-studio check
$ tsc --noEmit

pnpm --filter ai-manhua-studio test
Test Files  223 passed (223)
     Tests  1620 passed (1620)
  Duration  11.36s

pnpm --filter ai-manhua-studio build
vite v7.3.6 building client environment for production...
2972 modules transformed.
built in 6.46s

pnpm --filter @basketikun/canvas-agent test
tests 4
pass 4
fail 0

pnpm --filter @ai-manju/director-desk test
Test Files  87 passed (87)
     Tests  689 passed (689)
  Duration  94.70s
```

API 在 `apps/api` 使用已有 `.tmp/canvas-quality-qa/go-runtime/go/bin/go.exe` 执行：

```text
go build ./...  (退出 0，无输出)
go vet ./...    (退出 0，无输出)
go test ./...  (全部通过，以下为输出节选)
ok github.com/ai-manju/api/internal/handler (cached)
ok github.com/ai-manju/api/internal/provider (cached)
ok github.com/ai-manju/api/internal/repository (cached)
ok github.com/ai-manju/api/internal/router (cached)
ok github.com/ai-manju/api/internal/service (cached)
ok github.com/ai-manju/api/internal/storage (cached)
```

Worker 使用现有 `ai-manju-worker-monitoring:20260923` 容器，只读挂载当前源码到 `/app`：

```text
python -m compileall worker
Listing 'worker'...
Compiling 'worker/__init__.py'...
...
Compiling 'worker/video_references.py'...

python -m unittest discover -s tests
Ran 131 tests in 2.072s
OK (skipped=9)
```

保留非阻塞提醒：依赖与锁文件不同步、既有大体积 chunk、assets 模块静态/动态混合导入。Worker 的 9 项跳过未计为已验证通过。

未提交、未推送。
