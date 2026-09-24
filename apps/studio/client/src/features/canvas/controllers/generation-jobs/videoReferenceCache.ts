import type { CanvasGenerationInput } from "../../domain/connections";
import type { CanvasVideoReferenceHydrationResult } from "../../domain/video";

// Retain only the current preflight's files briefly, so Generate need not
// download them again. Never retain an unbounded set of large media files.
const VIDEO_PREFLIGHT_CACHE_TTL_MS = 60_000;
const VIDEO_PREFLIGHT_CACHE_MAX_BYTES = 100 * 1024 * 1024;
// Reading metadata is preparation, not a generation that can wait for minutes.
const VIDEO_REFERENCE_READ_TIMEOUT_MS = 20_000;

export class VideoReferenceCache {
  private value?: { key: string; expires: number; result: CanvasVideoReferenceHydrationResult };
  private generation = 0;
  clear() { this.value = undefined; this.generation++; }
  async read(projectKey: string, scope: string, inputs: readonly CanvasGenerationInput[], signal: AbortSignal | undefined,
    load: (signal: AbortSignal) => Promise<CanvasVideoReferenceHydrationResult>) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const key = JSON.stringify([projectKey, scope, inputs]);
    if (this.value?.key === key && this.value.expires > Date.now()) return this.value.result;
    const generation = this.generation;
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, VIDEO_REFERENCE_READ_TIMEOUT_MS);
    let rejectAborted!: () => void;
    const canceled = new Promise<never>((_, reject) => {
      rejectAborted = () => reject(timedOut
        ? new Error("参考素材读取超时，尚未开始生成。请检查素材是否可播放，或重新上传后再检查")
        : new DOMException("Aborted", "AbortError"));
      controller.signal.addEventListener("abort", rejectAborted, { once: true });
    });
    try {
      const result = await Promise.race([canceled, load(controller.signal)]);
      if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
      const bytes = [...result.references.images, ...result.references.videos, ...result.references.audios]
        .reduce((total, item) => total + (item.file?.size || 0), 0);
      if (generation === this.generation && bytes <= VIDEO_PREFLIGHT_CACHE_MAX_BYTES) this.value = { key, expires: Date.now() + VIDEO_PREFLIGHT_CACHE_TTL_MS, result };
      return result;
    } catch (error) {
      if (timedOut) throw new Error("参考素材读取超时，尚未开始生成。请检查素材是否可播放，或重新上传后再检查");
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      controller.signal.removeEventListener("abort", rejectAborted);
    }
  }
}
