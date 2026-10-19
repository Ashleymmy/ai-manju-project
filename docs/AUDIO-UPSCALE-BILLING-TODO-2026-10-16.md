# 音频 / 超分模型计费待办（2026-10-16）

> 状态：**未实现，等定价规则确定后再做**。
> 目前音频（语音合成、音乐、音色克隆）和超分（图片、视频）调用**不扣积分**，也不会出现在后台「消耗与成本」里。

## 现状

- 积分冻结、结算、退回，以及「消耗与成本」页面，现在都只覆盖**生成任务**（图片生成、视频生成）：
  - 冻结：`apps/api/internal/service/job_service.go` → `BillingHooks.ReserveForJob` / `ReserveForJobWithVideoPolicy`（`apps/api/internal/service/billing_hooks.go`）。
  - 报价：`pricer.QuoteForJobWithVideoPolicy`。
  - 账本：`apps/api/internal/service/credit_ledger_service.go`（`Reserve` / 结算 / `Release`）。
  - 用量报表：`apps/api/internal/service/admin_usage_service.go`、`apps/api/internal/repository/usage_repository.go`（目前只额外读 `operation = "text"` 的请求日志）。
- 音频和超分是**同步直连阿里云**，不创建 Job，所以没有积分记录。
- 它们的调用只写进 `ai_request_logs`（后台「监控」页可查），operation 分别为：
  - `image_upscale`（图片超分）
  - `video_upscale`（视频超分）
  - `audio`（语音合成 / 音乐）
  - `audio_voice_clone`（音色克隆）
- 后台「模型定价」（`apps/studio/client/src/features/admin/ui/ModelPricesPanel.tsx`）只有「图片定价」「视频定价」两栏，没有音频和超分的入口。

## 定价确定后需要补的部分（参考现有图片 / 视频生成的实现）

1. **定价配置**
   - 在模型定价配置里加入音频和超分的计价项。
   - 建议的计价单位：
     - 图片超分：按次，可按倍数区分；
     - 视频超分：按秒，或按次；
     - 语音合成：按字数或按次；
     - 音乐：按次或按时长；
     - 音色克隆：按次。
   - 后台「模型定价」页加对应的标签页和输入框。
   - 后端报价函数要支持这些类型。
2. **调用时扣积分**
   - 涉及的接口，都在 `apps/api/internal/handler/ai.go`：
     - `ImageUpscale`
     - `VideoUpscaleCreate` / `VideoUpscaleGet`：提交时冻结，查询到成功时结算，失败或超时时退回；
     - 音频合成
     - 音色克隆
   - 流程照搬生成任务：调用前冻结 → 成功后结算 → 失败后退回。
   - 积分不足时，给用户返回明确提示（参照现有生成任务的积分不足文案）。
   - 用户看到的报错要保持现有的分层规则：只显示可自行处理的提示，或「稍后重试」「请求过于频繁，请稍后重试」。
3. **进入「消耗与成本」**
   - 让这些调用的冻结和结算记录在用量报表中可见。
   - 记录内容：用户、模型、积分，以及阿里云实际成本（可选）。
   - 注意不要和 `ai_request_logs` 重复计数。
4. **测试**
   - 参照现有的计费测试，覆盖以下场景：
     - 成功扣费
     - 失败退回
     - 积分不足
     - 视频超分超时退回

## 相关

- 音频交接：`docs/AUDIO-MODEL-HANDOFF-2026-10-16.md`
