# 画布视频生成比例默认 16:9

## 修改范围

- 视频节点的生成参数不显示“自适应”，默认使用 16:9。
- 原有入口已处理新节点及 `auto`、`adaptive`；本轮补齐模型归一化之后再次返回自动比例的漏洞，例如旧数据 `panorama` 或非法尺寸。
- Seedance 使用 `16:9`，OpenAI 兼容模型使用对应的 `1280x720`。有效的手动比例不覆盖；模型不支持的比例仍由生成前校验阻止。
- 参数面板增加自动比例过滤，避免能力数据中的自动选项重新出现。
- 仅调整画布视频生成参数，不改变视频文件的真实显示比例、节点拖动缩放、空白视频框尺寸或图片节点的自适应行为。
- 不涉及 API、积分、仓库实现、依赖或锁文件修改。

## 定向验证

```text
nodeUtils.test.ts + CanvasVideoCapabilities.test.tsx
Test Files  2 passed (2)
     Tests  31 passed (31)
  Duration  1.85s

pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio exec playwright test --config e2e/playwright.video-ratio.config.ts
4 passed (27.3s)
```

浏览器用例覆盖新建、历史 `auto`、历史 `adaptive`、旧 `panorama` 数据：默认选中 16:9，实际提交请求为 16:9；手动切换 9:16 后，保存、刷新及重试均保留 9:16。原音频开关回归同时通过。新增单测覆盖非法尺寸及能力回退偏好自动比例的情形。

使用已有 3100 服务及隔离配置，拦截全部业务 API，无真实项目写入、付费生成或积分消耗。已核看参数面板截图：`test-results/canvas-video-ratio/canvas-video-audio-default-e5fc3-hoice-reach-the-request-new/default-audio-enabled.png`。

## 全项目验收

本轮实际输出摘要，命令全部退出 0。pnpm 命令附加 `--config.verify-deps-before-run=warn`，未安装或替换依赖。

```text
pnpm --filter ai-manhua-studio check
$ tsc --noEmit

pnpm --filter ai-manhua-studio test
Test Files  223 passed (223)
     Tests  1625 passed (1625)
  Duration  10.85s

pnpm --filter ai-manhua-studio build
2972 modules transformed.
built in 9.23s

pnpm --filter @basketikun/canvas-agent test
tests 4
pass 4
fail 0

pnpm --filter @ai-manju/director-desk test
Test Files  87 passed (87)
     Tests  689 passed (689)
  Duration  146.72s
```

API 在 `apps/api` 使用已有 `.tmp/canvas-quality-qa/go-runtime/go/bin/go.exe`：

```text
go build ./...  (退出 0)
go vet ./...    (退出 0)
go test ./...   (退出 0，测试缓存命中)
```

Worker 使用已有 `ai-manju-worker-monitoring:20260923` Docker 镜像，只读挂载源码运行：

```text
python -m compileall worker  (退出 0)
python -m unittest discover -s tests
Ran 131 tests in 2.079s
OK (skipped=9)
```

现有依赖/锁文件不同步、大 chunk 和 assets 静态/动态混合导入警告仍在；9 项 Worker 跳过不计为验证通过。

保留前三轮页面加载居中、视频模式手动选择、节点名缩放规则的未提交改动。本轮未提交、未推送。
