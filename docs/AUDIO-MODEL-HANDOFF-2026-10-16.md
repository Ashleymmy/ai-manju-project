# 音频模型交接记录（2026-10-16，暂告一段落，后续待完善）

> 状态：**阶段性完成，未提交**。音频相关改动与其他未提交修改混在工作区里，提交前请按文件核对。
> 后续继续完善时，从本文件的「待办 / 已知问题」开始。

## 已完成

- 接入阿里云百炼音频：CosyVoice 语音合成、MiniMax 语音、Fun-Music 音乐生成。
- 音色克隆（CosyVoice / MiniMax），以及克隆后的音色选项。
- CosyVoice 指令（instruct）归一化：`cosyVoiceInstruction`。
- 各模型的输出格式按模型区分。
- 任务失败（`task-failed`）返回 400，而不是笼统的 5xx。
- 音频时长显示 0:00 的问题已修复。
- 克隆报错分层（`apps/api/internal/handler/ai.go`）：
  - 用户能自己处理的问题（时长、大小、格式、采样率、噪声 / 多人声、下载失败）→ 给出具体提示（`voiceCloneAudioRejected`）。
  - 其他问题（账号、额度、密钥、服务异常）→ 只显示「音色克隆暂时失败，请稍后重试」；限流显示「请求过于频繁，请稍后重试」。
  - 供应商原始报错写入后端日志（`logProviderError`，按 `request_id` 查）。
- 前端克隆前置检查（`apps/studio/client/src/services/api/audio.ts` 的 `voiceCloneFileProblem`）：
  - 格式：mp3、wav、m4a。
  - 大小：≤10MB（MiniMax ≤20MB）。
  - 时长：MiniMax 10–300 秒；其他模型 5–60 秒。

## 待办 / 已知问题

1. **卡在「结果不确定」的音频节点无法由用户自行恢复。** 例如 11audio-8，目前只能删除节点后重新生成。需要增加查询或重试入口。
2. **两个前端边界测试失败（之前就存在）。** 位于 `domainBoundary` / boundary 测试：
   - `CanvasInspector` 引用了 `@/services/api`；
   - `domain/audioConfig.ts` 引用了 `@/services/api/audio`。

   需要把相关逻辑移到 adapter 层。
3. **克隆报错关键词是按经验写的。** 拿到真实的供应商报错后，对照日志里的 `provider_error` 校准。
4. **MiniMax 克隆限制（10–300 秒、20MB）未经线上实测。**
5. **没有管理或删除已克隆音色的界面。** 百炼音色有 1000 个的上限。
6. **克隆本地上传的音频需要后台配置阿里云 AK/SK。** 文件要先经过 VIAPI 临时 OSS 中转。
7. **各音色是否支持 instruct 目前是写死的。** 新增音色时需要同步更新。
8. **以上改动全部未提交。**
9. **音频和超分目前不扣积分，也不进「消耗与成本」。** 定价确定后按 `docs/AUDIO-UPSCALE-BILLING-TODO-2026-10-16.md` 补上。
