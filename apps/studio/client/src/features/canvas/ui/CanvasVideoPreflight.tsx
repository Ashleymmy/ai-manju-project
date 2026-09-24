import { videoModelCapabilities } from "@/entities/model/videoCapabilities";
import { videoModelDurations } from "@/entities/model";
import { h3VideoSettings, isSeedanceVideoModel, videoReferenceLimits, videoReferenceLimitsForModel } from "@/features/video";
import type { VideoPreflightState } from "../controllers/useVideoPreflight";
import "./videoPreflight.css";

export function CanvasVideoPreflight({ model, state, onRetry }: { model: string; state: VideoPreflightState; onRetry: () => void }) {
  const caps = videoModelCapabilities(model);
  const limits = videoReferenceLimitsForModel(model);
  const seedance = isSeedanceVideoModel(model);
  const allows = (kind: string) => !caps.supports?.length || caps.supports.includes(`reference_${kind}`)
    || (kind === "image" && caps.supports.some(value => value === "first_frame" || value === "last_frame"));
  const imageCount = allows("image") ? seedance || h3VideoSettings(model) ? limits.images : Math.min(limits.images, videoReferenceLimits.openAiImages) : 0;
  const videoCount = seedance && allows("video") ? limits.videos : 0;
  const audioCount = seedance && allows("audio") ? limits.audios : 0;
  const durations = videoModelDurations(model).filter(value => value > 0);
  const mb = (value: number) => `${value / 1024 / 1024}MB`;
  const range = `${limits.mediaMinDurationMs / 1000}–${limits.mediaMaxDurationMs / 1000} 秒`;
  return <div className={`canvas-video-preflight ${state.status}`}>
    <div className="canvas-video-preflight-status" role={state.status === "error" ? "alert" : "status"}>
      <span>{state.message || "选择模型后可查看生成与素材限制"}</span>
      {state.status === "error" ? <button type="button" onClick={onRetry}>重新检查</button> : null}
    </div>
    {model ? <details>
      <summary>模型与素材限制 · {audioCount ? `音频 ${range}` : "不支持参考音频"}</summary>
      {state.details.length ? <p>{state.details.join("；")}</p> : null}
      {!caps.references?.media_max_duration_ms || !caps.references.image_max_bytes ? <p>服务未提供的规格按当前接入通道限制检查。</p> : null}
      <ul>
        <li>生成时长：{durations.length ? `${durations.join("、")} 秒` : "服务未公布"}；画面规格：{[caps.resolutions?.join(" / "), caps.ratios?.join(" / ")].filter(Boolean).join("；") || "服务未公布"}。</li>
        <li>参考图片：{imageCount ? `最多 ${imageCount} 张，每张 ≤ ${mb(limits.imageMaxBytes)}` : "不支持"}。</li>
        <li>参考视频：{videoCount ? `最多 ${videoCount} 个，单个 ${range}，总计 ≤ ${limits.mediaMaxTotalDurationMs / 1000} 秒，每个 ≤ ${mb(limits.videoMaxBytes)}，MP4 / MOV` : "不支持"}。</li>
        {videoCount ? <li>参考视频画面：边长 {limits.videoMinEdge}–{limits.videoMaxEdge}px，宽高比 {limits.videoMinRatio}–{limits.videoMaxRatio}，像素总数 {limits.videoMinPixels}–{limits.videoMaxPixels}。</li> : null}
        <li>参考音频：{audioCount ? `最多 ${audioCount} 个，单个 ${range}，总计 ≤ ${limits.mediaMaxTotalDurationMs / 1000} 秒，每个 ≤ ${mb(limits.audioMaxBytes)}，MP3 / WAV` : "不支持"}。</li>
        {audioCount ? <li>{limits.audioOnly ? "可单独使用参考音频。" : "参考音频必须搭配参考图片或视频。"}“生成音频”开关不代表支持读取参考音频。</li> : null}
        {caps.frames_exclusive ? <li>首尾帧不能与普通参考素材混用。</li> : null}
        {caps.has_audio !== undefined ? <li>生成视频配音：{caps.has_audio ? "支持" : "不支持"}。</li> : null}
        <li>平台已注册素材的内容规格仍需生成服务校验。</li>
      </ul>
    </details> : null}
  </div>;
}
