import { FileText, Film, Image as ImageIcon, LayoutGrid, Music, X } from "lucide-react";
import { getAssetMediaUrl } from "@/entities/asset";
import { RetryImage } from "@/shared/ui/RetryImage";
import { VideoThumbnail } from "@/shared/ui/VideoThumbnail";
import type { AgentReference } from "./references";

export function AgentReferenceStrip({ references, onRemove }: { references: readonly AgentReference[]; onRemove?: (nodeId: string) => void }) {
  if (!references.length) return null;
  return <div className="agent-references" aria-label={onRemove ? "本次引用" : "消息引用"}>
    {references.map(reference => {
      const Icon = reference.kind === "image" ? ImageIcon : reference.kind === "video" ? Film : reference.kind === "audio" ? Music : reference.kind === "text" ? FileText : LayoutGrid;
      const media = reference.kind === "image" || reference.kind === "video";
      const source = media ? (reference.assetId ? getAssetMediaUrl(reference.assetId, reference.assetScope, reference.kind === "image" ? 320 : undefined) : reference.content) : "";
      return <div className={`agent-reference${media ? " agent-reference-media" : ""}`} key={reference.nodeId} title={reference.title} data-reference-node={reference.nodeId}>
        <span className="agent-reference-thumb">{source
          ? reference.kind === "video" ? <VideoThumbnail src={source} alt={reference.title} /> : <RetryImage src={source} alt={reference.title} draggable={false} fallback={<ImageIcon size={18} />} />
          : <Icon size={18} />}</span>
        {reference.kind === "video" && <Film className="agent-reference-video-mark" size={12} aria-hidden="true" />}
        {!media && <span className="agent-reference-title">{reference.title}</span>}
        {onRemove && <button type="button" title={`移除引用：${reference.title}`} aria-label={`移除引用：${reference.title}`} onClick={() => onRemove(reference.nodeId)}><X size={12} /></button>}
      </div>;
    })}
  </div>;
}
