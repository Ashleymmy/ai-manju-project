import { X } from "lucide-react";

/* 图片/视频大图弹层（消息附件与生成结果共用的查看器）。 */

export function MediaLightbox({
  url,
  kind,
  onClose,
}: {
  url: string;
  kind: "image" | "video";
  onClose: () => void;
}) {
  if (!url) return null;
  return (
    <div className="wb-lightbox" onClick={onClose} role="presentation">
      <button type="button" className="wb-lightbox-close" title="关闭" onClick={onClose}><X size={17} /></button>
      {kind === "video" ? (
        <video src={url} controls autoPlay playsInline preload="metadata" onClick={(event) => event.stopPropagation()} />
      ) : (
        <img src={url} alt="预览" onClick={(event) => event.stopPropagation()} />
      )}
    </div>
  );
}
