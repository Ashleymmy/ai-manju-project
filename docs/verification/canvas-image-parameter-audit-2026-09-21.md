# 画布图片参数二次核查（2026-09-21）

这次复查沿着“参数按钮 → 生成点击时的节点快照 → API 任务 → Worker 供应商请求 → 原图尺寸 → 节点状态”逐段验证。

## 发现并修复

- 生成前的参数取自点击时的节点快照。参考图读取较慢时，用户随后修改参数不会污染已经开始的任务；新选择不会被任务准备阶段覆盖，下一次生成使用新参数。测试直接使用保留下来的选择重新生成，不再在测试里手动重新赋值。
- 所有比例现在严格保持整数比例并按 16 像素对齐。之前独立四舍五入宽高会让 4:3、3:4 等比例出现轻微偏差；现在宽高满足 `width × ratioHeight = height × ratioWidth`。
- 画布请求继续传递明确的 size 和 quality。无法原生支持 low/medium/high 的图片通道会在调用供应商前拒绝任务，避免把用户选择静默丢掉。
- Worker 对画布任务读取返回原图的真实宽高。尺寸不等于请求尺寸时，任务失败、不会注册成成功资产、不会自动重试或裁剪冒充；错误会回到节点并提供重试。
- 供应商只返回图片链接时，先限时、限量下载原图再执行同样的尺寸校验；下载中断会清除半文件，尺寸不合格不注册资产，避免把合格的链接结果误判为不可读。下载不会携带供应商 API 凭据，也不会因校验失败重新调用生成接口。
- 本地模拟图片按明确的请求尺寸生成有效 PNG，并限制在现有图片尺寸上限内，避免固定 1×1 占位图被新增校验拒绝。真实图片仍使用 Worker 镜像内的 ffprobe 读取尺寸；没有保留仅凭 PNG 文件头就跳过读取错误的兜底。
- Studio 仍保留旧 Worker 的前端兜底：如果旧服务已经返回了错误尺寸，节点会显示实际/要求尺寸，并保留原图。

精细度无法从 PNG 二进制反推“模型画质”，因此实现为：支持的通道必须收到原生 quality 字段；不支持的通道明确拒绝，而不是假装已执行。

## 浏览器验收

本地独立 Vite 端口 53128、测试接口和本地 PNG，未调用付费服务。文生图和带参考图编辑各跑完整流程：

| 选择 | 请求 | 返回原图 |
| --- | --- | --- |
| 1K / 1:1 / 低 | 1024x1024 / low | 1024×1024 |
| 2K / 3:4 / 中 | 1728x2304 / medium | 1728×2304 |
| 4K / 16:9 / 高 | 3840x2160 / high | 3840×2160 |

另模拟供应商返回 1536×1024 的横图：请求仍是 1024×1024，旧服务兜底显示尺寸不符；新 Worker 路径将任务标记失败并保留原图。模拟不支持精细度的四种协议均在 HTTP 请求前失败。

实际浏览器输出：

```text
ok 1 ... image parameter buttons reach generation ... (5.8s)
ok 2 ... image parameter buttons reach reference edits ... (4.6s)
2 passed (12.5s)
```

## 检查结果

```text
Studio check: tsc --noEmit, exit 0
Studio test: Test Files 184 passed; Tests 1172 passed
Studio build: ✓ built in 6.06s
API build/vet/test: exit 0
Canvas Agent: 4 passed, 0 failed
Director Desk: 87 files passed; 686 tests passed
Worker compileall/unittest: Ran 92 tests in 1.764s; OK (skipped=1)
git diff --check: exit 0
```

完整日志及截图位于 `.tmp/canvas-image-audit-qa/`。

最终补充复查日志为 `studio-check-final.log`、`studio-test-final.log`、`studio-build-final.log`、`browser-final.log`、`api-final.log` 和 `worker-final.log`。Worker 使用隔离的 Linux 测试容器，只读挂载当前源码和测试，关闭网络；未启动队列消费进程。现有 Redis 集成测试因未配置 Redis 跳过。Windows 直接运行曾遇到缺少依赖、ffprobe 和 SIGKILL 的环境差异，已用实际 Linux Worker 环境完成全套验证。浏览器使用已有 Chrome 和独立 Vite 端口，不依赖缺失的 Playwright 内置浏览器。

清理了四个测试文件的整文件格式化差异，并用格式化后的备份与最终文件逐一比对，保留其他任务已有的视频原始尺寸测试改动。没有变更依赖锁文件。

## 生效说明

Studio 源码已通过 Vite 热更新；Worker 源码已编译并在独立镜像中通过完整测试，但没有替换正在运行的共享 Worker 容器，以免中断其他任务。要让本机 Worker 运行时启用尺寸硬校验，需要用该源码重建 Worker 镜像并重启 Worker；这一步不会改变 API 或数据库数据。

未操作线上环境或调用真实付费生成服务。上述测试验证了请求字段、结果读取、异常提示与注册顺序；精细度仅能验证原生 quality 参数传递，不能用本地模拟测试保证外部模型的主观画面效果。
