import { getAssetContentBlob } from "@/entities/asset";
import { authenticatedImageSource, recoverAuthenticatedImage } from "@/shared/api/imageRecovery";
import type { ResponseMessageContent } from "@/services/api/ai";
import { describeAgentReferences, type AgentReference } from "./references";

// Preview resolution is enough for Agent vision; generation still reads the original via @.
const AGENT_VISION_THUMBNAIL = 640;
// Bound stalled media requests without disabling the user's interrupt action.
const AGENT_REFERENCE_TIMEOUT_MS = 30_000;

function readDataUrl(blob: Blob, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const reader = new FileReader();
    const abort = () => { reader.abort(); reject(signal.reason); };
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    reader.onload = () => { cleanup(); resolve(String(reader.result)); };
    reader.onerror = () => { cleanup(); reject(reader.error || new Error("读取图片失败")); };
    reader.onabort = cleanup;
    reader.readAsDataURL(blob);
  });
}

export async function buildAgentReferenceContent(text: string, references: readonly AgentReference[], signal: AbortSignal): Promise<ResponseMessageContent> {
  const description = text + describeAgentReferences(references);
  const images = references.filter(reference => reference.kind === "image" && reference.mentionKey);
  if (!images.length) return description;
  const content: Exclude<ResponseMessageContent, string> = [{ type: "text", text: description }];
  for (const reference of images) {
    signal.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error("读取参考图片超时")), AGENT_REFERENCE_TIMEOUT_MS);
    try {
      let blob: Blob;
      if (reference.assetId) {
        blob = await getAssetContentBlob(reference.assetId, reference.assetScope, AGENT_VISION_THUMBNAIL, controller.signal);
      } else if (reference.content && authenticatedImageSource(reference.content)) {
        blob = await recoverAuthenticatedImage(reference.content, controller.signal);
      } else {
        if (!reference.content || !/^(data:image\/|blob:|https?:\/\/|\/)/i.test(reference.content)) throw new Error("图片地址不可用");
        const response = await fetch(reference.content, { signal: controller.signal });
        if (!response.ok) throw new Error(`读取图片失败（${response.status}）`);
        blob = await response.blob();
      }
      if (!blob.size || !blob.type.toLowerCase().startsWith("image/")) throw new Error("图片内容无效");
      const url = await readDataUrl(blob, controller.signal);
      content.push({ type: "text", text: `参考图片：${reference.title} @[node:${reference.nodeId}]` }, { type: "image_url", image_url: { url } });
    } catch (error) {
      signal.throwIfAborted();
      throw new Error(`无法读取引用图片“${reference.title}”：${error instanceof Error ? error.message : "读取失败"}。请重试或移除该引用。`);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  }
  return content;
}
