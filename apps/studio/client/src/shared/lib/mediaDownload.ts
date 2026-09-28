// Only a stalled transfer times out. Large, progressing reference files retain
// their full download time, with no deadline shared across a batch of assets.
export const MEDIA_DOWNLOAD_IDLE_TIMEOUT_MS = 60_000;

export async function fetchMediaBlob(url: string | URL, init: RequestInit = {}, label = "读取素材") {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let finished = false;
  let rejectInterrupted: (reason: unknown) => void = () => undefined;
  const interrupted = new Promise<never>((_resolve, reject) => { rejectInterrupted = reject; });
  const abort = () => {
    const reason = init.signal?.reason ?? new DOMException("Aborted", "AbortError");
    rejectInterrupted(reason);
    controller.abort(reason);
  };
  const resetIdleTimer = () => {
    if (finished || controller.signal.aborted) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      rejectInterrupted(new Error(`${label}超时，传输已停止，请检查网络后重试`));
      controller.abort();
    }, MEDIA_DOWNLOAD_IDLE_TIMEOUT_MS);
  };
  if (init.signal?.aborted) throw init.signal.reason ?? new DOMException("Aborted", "AbortError");
  init.signal?.addEventListener("abort", abort, { once: true });
  resetIdleTimer();
  const download = async () => {
    const response = await fetch(url, { ...init, signal: controller.signal });
    // Some fetch implementations may resolve after cancellation. Do not start a
    // new reader/timer after the caller has already received the timeout.
    if (finished || controller.signal.aborted) {
      if (response.body) void response.body.cancel().catch(() => undefined);
      throw new DOMException("Aborted", "AbortError");
    }
    if (!response.ok) throw new Error(`${label}失败（${response.status}）`);
    resetIdleTimer();
    if (!response.body) return response.blob();
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (finished || controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (done) break;
      if (value.byteLength) {
        chunks.push(value);
        resetIdleTimer();
      }
    }
    return new Blob(chunks, { type: response.headers.get("Content-Type") || "" });
  };
  try {
    return await Promise.race([download(), interrupted]);
  } finally {
    finished = true;
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", abort);
    // Release a stalled reader without waiting for a broken network response.
    if (reader) void reader.cancel().catch(() => undefined);
  }
}
