# 画布视频生成前能力与素材检查

日期：2026-09-23。用户要求按当前模型的实际限制，在点击生成前说明并限制不兼容素材，避免等待后才提示音频时长不合规。对应截图：`codex-clipboard-56a5bd55-8606-4fb3-8fb1-cb3acb1bf13e.png`。

## 原因与修复

- 原有音频时长校验位于生成服务调用入口；画布先读取全部参考素材、进入生成流程，用户选择素材时看不到结果。现在打开视频提示词面板即检查模型参数与实际参考文件，显示检查中、具体错误或通过状态，错误和检查中禁用生成/重试/面板快捷键。控制器生成与重试入口也在修改节点、持久化、上传或创建任务之前校验，覆盖不经过面板的调用。
- 限制说明读取当前模型的能力目录，显示输出时长、比例、分辨率，参考图片/视频/音频支持情况、数量、大小、时长、视频尺寸、素材组合规则及是否支持生成音频。未知规格明确标为服务未公布或当前接入通道限制，不将可生成音频与可读取音频混为一谈。
- 新增后端参考素材时长/文件大小字段；已明确映射的端点发布相应限制，SD-video 上游提供的 reference limits 优先于本地模型系列默认值。前端删除“图片数量大于 9 即视为 2.5”和“显示名包含 2.5 即放宽端点限制”的推断。
- 通过浏览器实际读取文件时长与尺寸。错误显示具体素材名、测量时长、模型允许范围以及裁剪/更换模型建议。损坏或不可读文件提示重新上传；媒体下载与元数据读取最多等待 20 秒并取消底层读取。
- 成功读取的素材在同项目/作用域下短暂缓存，生成时再次校验当前模型但不重复下载；缓存只保留一份、最多 100 MB、有效期 60 秒。切换模型/素材/画布会废弃旧检查状态，取消的检查不回写结果。重复引用与最终提交按相同规则去重，避免误报超数量。
- 展开的说明在面板内滚动，检查结果与生成按钮保持在相邻位置；生成按钮禁用时降低亮度。详细实测素材时长放入可展开说明，减少默认面板占用。

改动涉及 API model capabilities、Studio 模型解析和视频校验入口、Canvas generation controller/browser services、预检 hook/组件及两处面板接入。无仓库层改动，不涉及 Memory/Gorm 差异；保留既有响应信封、路由和鉴权。不覆盖另一助手的命名、批次、面板缩放修改；未提交、部署或重启共享服务。

## 验证证据

完整日志目录：`D:\AImanju4.0\.tmp\video-preflight-20260923\`。

新增/补充自动化覆盖：超长音频在检查、直接生成、重试三个入口均不创建任务、不上传、不保存、不改变原节点；不支持的音频在下载前拒绝；切换模型复用读取；重复素材去重；读取超时取消；旧异步结果隔离；服务端显式限制优先于系列默认值。

### Studio

使用已安装 pnpm CLI，设置 `npm_config_manage_package_manager_versions=false`，执行 `--filter ai-manhua-studio check/test/build`。实际输出摘录：

```text
> ai-manhua-studio@1.0.0 check D:\AImanju4.0\apps\studio
> tsc --noEmit

Test Files 217 passed (217)
Tests 1536 passed (1536)
Duration 10.22s
```

check 退出 0。build 退出 0；最终构建输出见 `studio-build.log`。现有部分 chunk 超过 500 kB 的提示未阻止构建。

首次全量回归发现新增跨 feature 导入未走公共出口，以及旧端点测试通过显示名推断 2.5 能力。已改用 video 公共出口，并将测试目录补为真实 capability 字段后，全量 1536 项通过。共享工作区另一任务的命名测试也已通过。

### 浏览器

`apps/studio/e2e/canvas-video-preflight.spec.ts` 在现有 3100 服务运行。所有 API（包括自动保存和生成提交）均由测试接管，没有真实生成、费用或项目修改；使用真正的 PCM WAV 文件，经浏览器媒体解码读取时长，模型目录和任务返回为测试数据。

```text
ok 1 ... canvas checks real audio duration and the selected model contract before generation (4.2s)
ok 2 ... canvas checks unreadable audio and recovers before generation (2.4s)
2 passed (7.2s)
```

- 20 秒 WAV 在参考音频上限 15 秒的模型下提前显示素材名和实测值，生成禁用，提交数为 0。
- 切换到参考音频上限 30 秒的模型后通过检查，手动点击生成才提交，模型及原音频内容与选择一致，点击生成没有再次下载音频。
- 损坏音频提前提示不可读取；更换为 10 秒有效 WAV 后点击重新检查恢复可生成，检查期间仍无提交。
- 限制说明最后一项可滚动进入视口；无页面运行异常。

已查看截图（位于日志目录 `browser/canvas-video-preflight-can-487b1--contract-before-generation/`）：`audio-too-long-before-generate.png`、`model-supports-audio.png`。

### API

使用项目已有 Go runtime 与模块缓存，在 `apps/api` 执行 `go build ./...`、`go vet ./...`、`go test ./...`。实际结果：

```text
build=0 vet=0 test=0
ok github.com/ai-manju/api/internal/handler 15.653s
ok github.com/ai-manju/api/internal/middleware (cached)
ok github.com/ai-manju/api/internal/provider (cached)
ok github.com/ai-manju/api/internal/repository (cached)
ok github.com/ai-manju/api/internal/router (cached)
ok github.com/ai-manju/api/internal/sdvideo (cached)
ok github.com/ai-manju/api/internal/service (cached)
```

其余包通过或无测试；完整输出见 `api-test.log`。build/vet 日志为空、退出 0。新增验证端点映射正确输出 15/30 秒参考限制，以及远端 12 秒/8 MB 定制值不会被默认值替换。

### 其他规定检查

Canvas Agent 与 Director Desk 执行规定的 workspace test 命令，退出 0：

```text
Canvas Agent: tests 4; pass 4; fail 0
Director Desk: Test Files 87 passed (87); Tests 689 passed (689)
```

Worker 使用现有 worker 镜像、只读挂载源码，在临时目录补充 httpx，执行 `python -m compileall -q worker` 和 `python -m unittest discover -s tests`；未重启现有 Worker，退出 0：

```text
Ran 118 tests in 2.985s
OK (skipped=2)
```

`git diff --check` 退出 0。

## 范围

这是本地代码修复，尚未上线。生成前检查覆盖当前能力目录和可读取本地媒体的已知限制。已注册的 `asset://` 引用无法在浏览器读取内容，界面明确说明仍需服务端内容校验；真实上游的运行状态、内容审核及生成结果不由这组模拟提交测试证明。没有据此声称与 updream 使用的是同一生成通道。
