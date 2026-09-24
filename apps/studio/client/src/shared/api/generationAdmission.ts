import { ApiError } from "./http";

/** Retry only explicit pre-admission capacity rejections; never replay an ambiguous generation. */
export const GENERATION_ADMISSION_RETRY_MS = 5_000;
/** Bound a blocked submission while allowing long video jobs to release capacity. */
export const GENERATION_ADMISSION_WAIT_MS = 30 * 60_000;

export type GenerationAdmissionOptions = {
  signal?: AbortSignal;
  onWaiting?: (waiting: boolean) => void;
};
type Capability = "image" | "video" | "text" | "audio";
type Waiter = { start: () => void; cancel: () => void };

// Serialize admission, not asynchronous job execution. Once a job is accepted,
// the next submission can use another server slot. A rejected head waits in FIFO
// order so the rest of a batch does not repeatedly flood the admission endpoint.
class AdmissionLane {
  private busy = false;
  private waiting: Waiter[] = [];

  private readonly release = () => {
    this.busy = false;
    this.waiting.shift()?.start();
  };

  acquire({ signal, onWaiting }: GenerationAdmissionOptions): (() => void) | Promise<() => void> {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (!this.busy) {
      this.busy = true;
      return this.release;
    }
    return new Promise((resolve, reject) => {
      const cancel = () => {
        this.waiting = this.waiting.filter(item => item !== waiter);
        signal?.removeEventListener("abort", cancel);
        reject(new DOMException("Aborted", "AbortError"));
      };
      const waiter: Waiter = { cancel, start: () => {
        signal?.removeEventListener("abort", cancel);
        this.busy = true;
        resolve(this.release);
      } };
      this.waiting.push(waiter);
      signal?.addEventListener("abort", cancel, { once: true });
      onWaiting?.(true);
    });
  }
}

const lanes: Record<Capability, AdmissionLane> = {
  image: new AdmissionLane(), video: new AdmissionLane(),
  text: new AdmissionLane(), audio: new AdmissionLane(),
};

export function isGenerationCapacityError(error: unknown) {
  return error instanceof ApiError && error.status === 429
    && /当前(?:图片|视频|音频|文本)?任务并发已达上限|concurrent task limit/i.test(error.message);
}

export async function submitWithGenerationAdmission<T>(
  capability: Capability,
  submit: () => Promise<T>,
  options: GenerationAdmissionOptions = {},
): Promise<T> {
  let release: (() => void) | undefined;
  try {
    const slot = lanes[capability].acquire(options);
    release = typeof slot === "function" ? slot : await slot;
    options.onWaiting?.(false);
    const deadline = Date.now() + GENERATION_ADMISSION_WAIT_MS;
    for (;;) {
      if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      try {
        return await submit();
      } catch (error) {
        if (!isGenerationCapacityError(error) || Date.now() >= deadline) throw error;
        options.onWaiting?.(true);
        await waitForCapacity(options.signal);
      }
    }
  } finally {
    release?.();
    options.onWaiting?.(false);
  }
}

function waitForCapacity(signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const finish = () => { signal?.removeEventListener("abort", abort); resolve(); };
    const timer = setTimeout(finish, GENERATION_ADMISSION_RETRY_MS);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}
