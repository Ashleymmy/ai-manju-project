import { useEffect, useState } from "react";

// Debounce edits; reference checks never create generation tasks.
const VIDEO_PREFLIGHT_DEBOUNCE_MS = 200;
// Passive inspection must never hold the editor hostage to a slow asset lookup.
const VIDEO_PREFLIGHT_TIMEOUT_MS = 3000;
export type VideoPreflightCheck = (nodeId: string, signal: AbortSignal) => Promise<string[]>;
export type VideoPreflightState = { status: "idle" | "checking" | "ready" | "error"; message: string; details: string[] };

export function useVideoPreflight(nodeId: string, key: string, check?: VideoPreflightCheck) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ nodeId: string; key: string; attempt: number; state: VideoPreflightState }>();
  useEffect(() => {
    if (!nodeId || !check) { setResult(undefined); return; }
    const controller = new AbortController();
    const deadline = setTimeout(() => {
      controller.abort();
      setResult({ nodeId, key, attempt, state: { status: "idle", message: "可点击生成，提交前将校验参考素材", details: [] } });
    }, VIDEO_PREFLIGHT_TIMEOUT_MS);
    const timer = setTimeout(() => {
      void check(nodeId, controller.signal).then(details => {
        clearTimeout(deadline);
        if (!controller.signal.aborted) setResult({ nodeId, key, attempt, state: { status: "ready", message: "模型与引用类型检查通过，提交前校验素材规格", details } });
      }, error => {
        clearTimeout(deadline);
        if (!controller.signal.aborted) setResult({ nodeId, key, attempt, state: { status: "error", message: error instanceof Error ? error.message : "素材检查失败，请重试", details: [] } });
      });
    }, VIDEO_PREFLIGHT_DEBOUNCE_MS);
    return () => { clearTimeout(timer); clearTimeout(deadline); controller.abort(); };
  }, [nodeId, key, attempt, check]);
  // Never show the previous model/reference's green status for even one render.
  const state: VideoPreflightState = !nodeId || !check ? { status: "idle", message: "", details: [] }
    : result?.nodeId === nodeId && result.key === key && result.attempt === attempt ? result.state
    : { status: "checking", message: "正在检查模型与参考素材，完成后可生成…", details: [] };
  return { ...state, blocked: state.status === "checking" || state.status === "error", retry: () => setAttempt(value => value + 1) };
}
