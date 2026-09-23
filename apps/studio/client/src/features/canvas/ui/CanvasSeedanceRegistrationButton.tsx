import { BadgeCheck, Clock3, Loader2, RotateCcw } from "lucide-react";
import type { CanvasNodeData } from "../domain/types";
import { savedSeedanceRegistration, seedanceRegistrationPhase, type SeedanceRegistrationState } from "../services/seedanceRegistration";

export function CanvasSeedanceRegistrationButton({ node, state, onRegister, className = "", showLabel = false, disabled = false }: {
  node: CanvasNodeData;
  state?: SeedanceRegistrationState;
  onRegister: (node: CanvasNodeData) => Promise<unknown>;
  className?: string;
  showLabel?: boolean;
  disabled?: boolean;
}) {
  const saved = savedSeedanceRegistration(node);
  const phase = state?.phase || (saved ? seedanceRegistrationPhase(saved) : "idle");
  const busy = phase === "queued" || phase === "uploading" || phase === "processing";
  const label = {
    idle: "注册拟真人素材",
    queued: "等待批量注册拟真人素材…",
    uploading: "正在上传拟真人素材…",
    processing: "已上传，正在处理注册…",
    pending: "已上传至资产库 · 真人素材，仍在处理中，点击刷新状态",
    success: "已注册至资产库 · 真人素材，可用于视频参考",
    error: `注册未完成，点击重试${state?.error ? `：${state.error}` : ""}`,
  }[phase];
  const Icon = busy ? Loader2 : phase === "pending" ? Clock3 : phase === "error" ? RotateCcw : BadgeCheck;
  return <button
    type="button"
    className={`${className} canvas-seedance-registration is-${phase}`}
    title={label}
    aria-label={label}
    aria-busy={busy}
    disabled={disabled || busy || phase === "success"}
    onPointerDown={event => event.stopPropagation()}
    onClick={event => { event.stopPropagation(); void onRegister(node); }}
  >
    <Icon size={15} className={busy ? "spin" : undefined} />
    {showLabel ? <span>{busy ? "注册中…" : phase === "success" ? "已注册拟真人素材" : phase === "pending" ? "注册处理中" : phase === "error" ? "重试注册" : "注册拟真人素材"}</span> : null}
    <span className="sr-only" role="status" aria-live="polite">{label}</span>
  </button>;
}
