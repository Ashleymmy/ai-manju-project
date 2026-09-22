# 画布视频默认生成音频（2026-09-22）

## 行为

新建视频节点默认勾选“生成音频”；旧节点没有保存该字段时也默认开启。已保存的关闭选择保持关闭，手动切换后刷新仍保留选择。生成接口中的 `generate_audio` 与勾选状态一致。

移除 `CanvasWorkspaceContent.tsx` 新节点初始化中写死的 `generateAudio: false`，在 `domain/nodeUtils.ts` 的共享视频配置解析中统一使用 `generateAudio ?? true`。参数面板、价格估算、生成与重试均读取该配置，避免仅改变复选框外观。

## 浏览器验收

回归脚本：`apps/studio/e2e/canvas-video-audio-default.spec.ts`。独立端口 4178 / Chrome，通过模拟接口记录真实页面提交的请求体，并在创建供应商任务前结束请求；没有付费生成。截图及日志位于 `.tmp/canvas-video-audio-default-qa/`。

- 新建视频节点：默认勾选，首次提交 `generate_audio: true`。
- 原有节点未保存此字段：默认勾选，首次提交 `true`。
- 原有节点保存为关闭：维持未勾选，首次提交 `false`。
- 三种场景均切换复选框、保存、刷新并重试，确认新的勾选状态与提交参数一致。
- 页面错误为 0；人工查看新建节点的参数截图，“生成音频”已勾选，“添加水印”未勾选。

```text
3 passed (18.9s)
```

本次保留其他助理及此前任务的改动；仅本地修改，未提交、部署或重启共享服务。

## 项目检查实际输出

日志位于 `.tmp/canvas-video-audio-default-qa/`。

```text
pnpm --filter ai-manhua-studio check
$ tsc --noEmit
exit 0

pnpm --filter ai-manhua-studio test
Test Files 190 passed (190)
Tests 1194 passed (1194)
Duration 9.28s

pnpm --filter ai-manhua-studio build
✓ built in 3.13s
exit 0

go build ./...
exit 0
go vet ./...
exit 0
go test ./...
ok github.com/ai-manju/api/internal/router (cached)
ok github.com/ai-manju/api/internal/service (cached)
exit 0

pnpm --filter @basketikun/canvas-agent test
tests 4
pass 4
fail 0

pnpm --filter @ai-manju/director-desk test
Test Files 87 passed (87)
Tests 686 passed (686)
Duration 90.73s

python -m compileall -q worker && python -m unittest discover -s tests
Ran 92 tests in 2.060s
OK (skipped=1)

git diff --check
exit 0
```

Go 使用已有工具链；Worker 使用只读挂载源码的独立测试容器，Redis 相关测试跳过 1 项。pnpm 自动移除的锁文件 override 已精确补回，无锁文件差异。
