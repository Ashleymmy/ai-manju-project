# 视频引用自适应排列验证

日期：2026-09-24。本轮覆盖上一轮“所有引用单独一行”的排列要求。

## 最终要求与实现

- 用户最后确认不必严格每排四个。短引用按输入框可用宽度自然排列，放不下再换行；不固定列数、不挤压缩略图。
- 根据实际显示标签判定长短，不根据内部引用 ID 长度判定。长标签仍独占一行，显示宽度受输入框约束，避免跨行拆框。
- 原生输入与覆盖层共享相同占位文字，保持光标、点击与拖拽选区对齐。面板宽度或字体变化时重新测量容量，并保留原始引用对应的选区。
- 旧的逐行短引用恢复编辑时可以重新紧凑排列；正常输入中的手动换行和段落空行保留。
- 不改积分、生成接口、画布节点编辑器或其他工作区改动；未提交、未推送。

## 本轮文件

- `apps/studio/client/src/features/video/model/promptEditor.ts`
- `apps/studio/client/src/features/video/model/promptEditor.test.ts`
- `apps/studio/client/src/features/video/ui/Composer.tsx`
- `apps/studio/client/src/features/video/ui/Composer.test.tsx`
- `apps/studio/e2e/video-shelf-mentions.spec.ts`

## 浏览器检查

```text
pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio exec playwright test --config e2e/playwright.video-shelf.config.ts
ok ... long labels keep their own row beside flowing short labels and retain selection after resizing
ok ... clicking library media inserts usable prompt references at 1920px
ok ... clicking library media inserts usable prompt references at 1280px
ok ... clicking library media inserts usable prompt references at 390px
4 passed (10.6s)
```

验证了短引用同行、窄屏自动换行、长短混排、窗口缩放后仍复制同一个引用、点击光标、拖拽选择、200 条引用滚动对齐，以及最终请求含真实图片/视频/音频数据。API 全部隔离，未调用付费生成服务。长标签场景通过历史消息的键盘“重新编辑”入口载入。

截图目录：`D:/AImanju4.0/test-results/video-shelf-mentions/`。包括各视口的 `shelf-inserts-media-mentions.png`、`scrolled-reference-caret.png`，以及长短混排的 `mixed-reference-lengths-1280.png`、`mixed-reference-lengths-390.png`。

## 全项目验证

pnpm 命令均带 `--config.verify-deps-before-run=warn`，不改动现有锁文件或自动安装依赖。

```text
pnpm --filter ai-manhua-studio check
$ tsc --noEmit
exit_code: 0

pnpm --filter ai-manhua-studio test
Test Files  223 passed (223)
     Tests  1612 passed (1612)
Start at 17:13:52

pnpm --filter ai-manhua-studio build
Director Desk: built in 3.88s
Studio: built in 6.40s
exit_code: 0

go build ./...
exit_code: 0
go vet ./...
exit_code: 0
go test ./...
ok github.com/ai-manju/api/internal/handler 14.794s
ok github.com/ai-manju/api/internal/repository 0.164s
ok github.com/ai-manju/api/internal/router 1.524s
ok github.com/ai-manju/api/internal/service 8.972s
其余测试包均为 ok；exit_code: 0

pnpm --filter @basketikun/canvas-agent test
tests 4; pass 4; fail 0

pnpm --filter @ai-manju/director-desk test
Test Files 87 passed (87)
     Tests 689 passed (689)

python -m compileall worker
exit_code: 0
python -m unittest discover -s tests
Ran 118 tests in 2.087s
OK (skipped=2)
```

Go 使用工作区自带 `.tmp/canvas-quality-qa/go-runtime/go/bin/go.exe`。Worker 使用临时 Docker 容器 `ai-manju-worker-monitoring:20260923`，只读挂载当前源码；未部署或重启共享服务。继续使用 `http://localhost:3100/video`。

本轮全量 Studio 已通过，上一轮报告中的画布素材排序失败在当前工作区未再出现；本轮没有编辑该区域。现有依赖同步、大包体积、混合导入警告保留，未进行无关修改。
