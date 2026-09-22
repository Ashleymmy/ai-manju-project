# 画布视频移除自适应比例（2026-09-22）

## 修改行为

- 视频节点的宽高比列表移除“自适应”。
- 新建视频节点默认使用 16:9。旧节点的空值、`auto` 和 `adaptive` 在读取视频配置时统一回退到 16:9；OpenAI 兼容协议对应 1280×720。
- 既有明确比例保持不变。用户选择的比例用于生成、重试和保存恢复。
- 图片节点的自适应设置和独立视频工作台保持现有行为。

产品修改位于 `CanvasWorkspaceContent.tsx`、`domain/nodeUtils.ts` 及 `domain/index.ts`。保留同目录之前任务及其他助理的改动；未提交、部署或重启共享服务。

## 验证

扩展 `canvas-video-audio-default.spec.ts`：新建节点、旧 `auto` 节点和旧 `adaptive` 节点均不再出现自适应按钮，默认选中 16:9；首次生成请求的 `ratio` 为 `16:9`。切换为 9:16 后保存并刷新，界面与重试请求均为 `9:16`。同时保留默认音频和手动关闭的回归检查。

浏览器使用独立端口 4178 / Chrome，模拟接口接收提交参数，未发起付费生成。页面错误数量为 0，已人工检查参数菜单截图。单元测试另覆盖两种视频协议的旧值兼容、明确比例和图片自适应不变。

全部日志与截图：`.tmp/canvas-video-fixed-ratio-qa/`。

```text
Browser: 3 passed (22.2s)

pnpm --filter ai-manhua-studio check
$ tsc --noEmit
exit 0

pnpm --filter ai-manhua-studio test
Test Files 190 passed (190)
Tests 1198 passed (1198)
Duration 9.33s

pnpm --filter ai-manhua-studio build
✓ built in 3.32s
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
Ran 92 tests in 2.005s
OK (skipped=1)
```

```text
pnpm --filter @basketikun/canvas-agent test
tests 4
pass 4
fail 0

pnpm --filter @ai-manju/director-desk test
Test Files 87 passed (87)
Tests 686 passed (686)
Duration 144.39s

git diff --check
exit 0
```

Go 使用已有工具链；Worker 使用只读挂载源码的独立测试容器，Redis 相关测试跳过 1 项。pnpm 自动移除的原有锁文件 override 已精确补回，无锁文件差异。
