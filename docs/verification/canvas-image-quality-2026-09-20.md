# 画布图片分辨率与精细度修复（2026-09-20）

## 确认的原因

1. 参数面板将 1K / 2K / 4K 写入 `metadata.imageResolution`，但所有画布生图入口未读取该值构造请求。
2. `toImageSizeValue` 仅保留四种比例，其余面板上的比例（包括 4:3、3:2、全景）提交时变成 `auto`。
3. 前端与 Go API 虽然传递了 `quality`，Worker 的普通 OpenAI-compatible 生图请求只构造 model / prompt / size / n，丢弃了精细度。图生图 multipart 和 Responses 路径原本已有质量字段。
4. `auto` 尺寸在普通 Worker 生图中回退到 1024×1024，因此只将精细度切到“高”无法保证高像素输出。

## 本次修改

- 画布统一通过 `canvasImageGenerationSettings` 将分辨率、比例转换为明确像素尺寸，精细度独立生成 low / medium / high。
- 所有面板比例都进入请求；全景映射 3:1。尺寸遵守既有 API 约束：16 像素对齐、最大边 3840、总像素不超过 8,294,400、最大比例 3:1。
- 自适应沿用当前图片原始比例；无图片的节点默认 1:1。不会用用户拖动后的画布卡片大小来推断图片比例。
- 单图、批量、失败重试、恢复入口，以及扩图/换角度/局部编辑共用尺寸计算。保留用户选中的比例，不用请求像素覆盖面板选择。
- Worker 普通生图恢复转发 quality、style、response_format、output_format；GPT Image 2 编辑端点原有字段兼容规则保持不变。
- 参数面板显示“请求尺寸”；原图预览同时显示请求尺寸和解码得到的实际分辨率。实际返回较小图片时不会被标为请求中的高分辨率。
- 批次主图交换与历史版本还原保留图片对应的分辨率、质量和请求尺寸；旧历史不冒用当前图片的请求尺寸。

例：16:9 比例下，1K → 1360×768、2K → 2720×1536、4K → 3840×2160，任意档位均可独立选择低/中/高精细度。4K 档使用约 830 万像素预算，正方形为 2880×2880，受既有后端上限约束，并非所有比例都固定 4096 像素。

公开路由、响应信封、鉴权与 Memory/Gorm 仓库均未修改。未提交或部署，未联系其他助理对话；工作区已有其他任务的修改均保留。

## 验证及实际输出

新增验证覆盖真实参数按钮点击、全部比例与分辨率组合、JSON 与 multipart 请求、Go 队列载荷、Worker 实际 HTTP 请求体、批量重试、历史参数、请求与实际分辨率分开显示。供应商调用使用 mock，无付费模型请求，未进行真实人物图片清晰度对比。

Studio（使用项目已有 pnpm，完成 check / test / build）：

```text
> ai-manhua-studio@1.0.0 check
> tsc --noEmit
Exit code: 0

Test Files  166 passed (166)
     Tests  1036 passed (1036)
  Duration  8.00s

> ai-manhua-studio@1.0.0 build
> pnpm run build:deps && vite build
✓ built in 3.00s
Exit code: 0
```

后端 `go build ./...`、`go vet ./...`、`go test ./...` 均退出 0，实际测试输出摘录：

```text
ok  github.com/ai-manju/api/internal/handler     14.310s
ok  github.com/ai-manju/api/internal/provider     0.581s
ok  github.com/ai-manju/api/internal/repository   0.237s
ok  github.com/ai-manju/api/internal/router       0.702s
ok  github.com/ai-manju/api/internal/service      2.634s
ok  github.com/ai-manju/api/internal/storage      0.527s
```

Canvas Agent 与 Director Desk：

```text
@basketikun/canvas-agent test
tests 4
pass 4
fail 0

@ai-manju/director-desk test
Test Files  87 passed (87)
     Tests  686 passed (686)
  Duration  90.23s
```

Worker 在 Linux 独立临时环境执行 `python -m compileall worker`、`python -m unittest discover -s tests`：

```text
Listing 'worker'...
Ran 82 tests in 0.273s
OK (skipped=1)
```

跳过项是未配置 `REDIS_TEST_URL` 的 Redis 集成测试。Windows 完整运行曾因既有运行时测试使用 Linux 专属 SIGKILL 而失败，改用 Linux 后通过。Go 与 Python 验证工具安装在本任务临时目录；未改项目依赖声明。包管理器缓存及依赖下载遇到沙箱限制后，获准运行。`git diff --check` 通过。

## 使用与发布

人物细节建议选择 4K + 高，并按构图选比例；多视图合成的人物只占整张图的一部分，其局部发丝仍受模型能力及分配到的像素数影响。可在原图预览中核对请求与实际像素。

生效需要发布 Studio 和 Worker；仅更新前端不足以修复 Worker 丢弃 quality 的问题。Go 仅新增回归测试。此次没有重启共享服务或发布线上环境。
