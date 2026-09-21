# 画布图片参数与实际产出核对

## 范围和证据

用户反馈线上画布选择 1:1 后仍返回横图，随后明确要求只在本地修复。

读取线上公开前端静态文件可确认：所部署前端已有 `canvasImageGenerationSettings`，1:1 / 1K 会产生 1024x1024，生成控制器会提交 size、quality。未取得线上登录后的任务载荷或供应商请求日志，因此不能把截图原因确认为前端、Worker 版本或供应商行为中的某一种。

本地运行中的旧 Worker 镜像确实没有转发文生图 quality，但这是本地环境事实，不能作为线上苹果图片的原因。仓库现有 Worker 源码已包含该字段转发修复，见 `canvas-image-quality-2026-09-20.md`。

## 本轮本地修改

- 画布 JSON 文生图及 multipart 参考图编辑继续提交实际 size、quality，并把明确的像素尺寸和构图比例要求加入供应商收到的提示词，明确不沿用参考图的宽高比。用户可编辑提示词、节点标题与历史中的原始提示不受这段请求附加文本污染。
- Worker 的画布文生图及图生图入口补同样约束，兼容旧前端；前后端共用标记避免重复追加。非画布、自动尺寸及无效尺寸输入行为保持不变。
- 操作面板根据浏览器实际解码的原图宽高，与生成时保存的 requestedImageSize 对比。不符时显示要求/实际像素，保留原图并让用户自行更换模型或重新生成。比较基于当次已提交参数，不会拿生成后修改的设置误报旧图片。
- 没有裁剪或拉伸图像冒充模型按指定比例生成；没有增加自动付费重试。
- 本轮仅修改 image/api.ts、CanvasInspector 的接入点、worker/provider.py 的接入点及新增小模块/测试。其他助理正在改动的节点缩放、剪贴板、Agent 等内容未被覆盖。

## 浏览器验证

独立本地 Vite 端口 53128 + Chrome，测试接口返回本地生成的真实 PNG 文件。没有调用付费供应商。

两个完整浏览器流程分别覆盖无参考图、带 1536×1024 横版参考图：

| 面板选项 | 实际 HTTP 请求 size / quality | 浏览器解码原图 |
| --- | --- | --- |
| 1K / 1:1 / 低 | 1024x1024 / low | 1024×1024 |
| 2K / 3:4 / 中 | 1760x2352 / medium | 1760×2352 |
| 4K / 16:9 / 高 | 3840x2160 / high | 3840×2160 |
| 1K / 1:1 / 低，模拟供应商返回错误尺寸 | 1024x1024 / low | 1536×1024，并出现明确尺寸不符提示 |

测试同时验证原始可编辑提示词未污染。第一次测试选择器误把“注册拟真人素材”的 status 当成尺寸提示，收窄为实际尺寸提示后通过。

实际输出：

```text
ok 1 ... image parameter buttons reach generation and output dimensions are verified (5.4s)
ok 2 ... image parameter buttons reach reference edits and output dimensions are verified (4.3s)
2 passed (11.0s)
```

原始日志及截图：`.tmp/canvas-image-parameters-qa/`。人工查看截图确认提示位于生成按钮下方，原图保持原始比例。

## 项目规定检查实际输出

Studio `check`：

```text
$ tsc --noEmit
[exit 0]
```

Studio `test`：

```text
Test Files  183 passed (183)
     Tests  1157 passed (1157)
  Duration  8.52s
```

Studio `build`：

```text
✓ built in 3.02s
[exit 0]
```

API `go build ./... && go vet ./... && go test ./...` 返回 0，摘录：

```text
ok github.com/ai-manju/api/internal/handler     13.929s
ok github.com/ai-manju/api/internal/middleware  0.968s
ok github.com/ai-manju/api/internal/provider    0.123s
ok github.com/ai-manju/api/internal/repository  0.007s
ok github.com/ai-manju/api/internal/router      0.466s
```

Canvas Agent `test`：

```text
ℹ tests 4
ℹ pass 4
ℹ fail 0
```

Director Desk `test`：

```text
Test Files 87 passed (87)
     Tests 686 passed (686)
  Duration 89.94s
```

Worker `python -m compileall worker && python -m unittest discover -s tests`：

```text
Ran 84 tests in 0.417s
OK (skipped=1)
```

Worker 新测试检查全部六种已存在协议的文生图及参考图编辑实际 HTTP 参数，确认尺寸约束进入供应商请求；原生 Images 协议还验证 size/quality 独立传递。API/Worker 使用只读挂载源码的临时 Linux 容器。临时 Worker 补装旧测试镜像缺少的 httpx/httpcore，未改运行中的服务。跳过项为未配置 Redis 的现有集成测试。

`git diff --check` 返回 0。各检查完整输出均保存在 `.tmp/canvas-image-parameters-qa/`。

## 生效与限制

本地前端源码已更新；Worker 改动已验证但未重建或重启共享运行容器。未提交、推送、发布线上或触发真实生成。

本次证实按钮到请求的参数和尺寸不符反馈可用。提示词约束是对原生 size 参数的补充，不能保证不遵守尺寸的外部供应商一定输出目标尺寸；线上实际模型仍需发布后验证。不能将本地模拟通过表述成线上苹果图片问题已被真实复现或彻底消除。
