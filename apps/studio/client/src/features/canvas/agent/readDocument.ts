import { AGENT_DOCUMENT_LIMITS, validateAgentDocument } from "./documents";

// Isolate Office parsers from the UI; cancel or terminate expensive/corrupt files.
export async function readAgentDocument(file: File, signal: AbortSignal): Promise<string> {
  validateAgentDocument(file);
  signal.throwIfAborted();
  const buffer = await file.arrayBuffer();
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./documentParser.worker.ts", import.meta.url), { type: "module" });
    const finish = (text?: string, error?: Error) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      worker.terminate();
      if (error) reject(error);
      else resolve(text!);
    };
    const abort = () => finish(undefined, new DOMException("已取消文件读取", "AbortError"));
    const timer = setTimeout(() => finish(undefined, new Error("文件解析超时，请拆分文件后重试")), AGENT_DOCUMENT_LIMITS.timeoutMs);
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = ({ data }: MessageEvent<{ text?: string; error?: string }>) => {
      finish(data.text, data.error ? new Error(data.error) : !data.text ? new Error("文件没有可读取的文字内容") : undefined);
    };
    worker.onerror = event => { event.preventDefault(); finish(undefined, new Error("文件解析失败，请检查格式或密码保护")); };
    try { worker.postMessage({ name: file.name, buffer }, [buffer]); }
    catch { finish(undefined, new Error("无法启动文件解析，请重试")); }
  });
}
