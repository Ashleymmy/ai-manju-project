import { Loader2, X } from "lucide-react";
import { useEffect } from "react";

import type { Asset } from "@/entities/asset";

export function AssetPreviewLightbox({
  asset,
  url,
  onClose,
}: {
  asset: Asset | null;
  url: string;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!asset) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [asset, onClose]);

  if (!asset) return null;

  return (
    <div className="asset-lightbox" role="presentation" onClick={onClose}>
      <div className="asset-lightbox-toolbar" onClick={(event) => event.stopPropagation()}>
        <span>{asset.name}</span>
        <button type="button" title="关闭" onClick={onClose}><X size={16} /></button>
      </div>
      <div className="asset-lightbox-stage">
        {url ? (
          asset.type === "video" ? (
            <video src={url} controls autoPlay playsInline preload="metadata" onClick={(event) => event.stopPropagation()} />
          ) : (
            <img src={url} alt={asset.name} onClick={(event) => event.stopPropagation()} />
          )
        ) : (
          <Loader2 className="spin" size={28} />
        )}
      </div>
    </div>
  );
}
