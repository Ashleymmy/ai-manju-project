import { GenerationPrice } from "@/features/member";
import type { VideoWorkbenchMessage } from "../repositories/conversationRepository";

/** Retry restores references from the preceding user message, not the task card. */
export function VideoRetryPrice({ message, messages }: { message: VideoWorkbenchMessage; messages: VideoWorkbenchMessage[] }) {
  const index = messages.findIndex(item => item.id === message.id);
  const source = messages.slice(0, index).reverse().find(item => item.role === "user");
  if (!message.config) return <span className="generation-price">按当前参数报价</span>;
  const config = message.config;
  return <GenerationPrice kind="video" model={config.model} seconds={config.seconds} resolution={config.resolution} audio={config.generateAudio} referenceVideos={source?.attachments?.filter(item => item.kind === "video").length ?? 0} />;
}
