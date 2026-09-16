import { useEffect, useRef, useState } from "react";
import { getAssetContentObjectUrl } from "@/entities/asset";
import type { WorkspaceScope } from "@/shared/config";

/** Request thumbnails near the viewport; one slow image cannot hold up its siblings. */
export function AssetThumbnail({ id, scope, name, className, onDoubleClick }: {
  id: string;
  scope: WorkspaceScope;
  name: string;
  className?: string;
  onDoubleClick?: () => void;
}) {
  const ref = useRef<HTMLImageElement>(null);
  const [url, setUrl] = useState("");
  useEffect(() => {
    setUrl("");
    const controller = new AbortController();
    let objectUrl = "";
    let started = false;
    const load = () => {
      if (started) return;
      started = true;
      void getAssetContentObjectUrl(id, scope, 320, controller.signal).then(value => {
        if (controller.signal.aborted) { URL.revokeObjectURL(value); return; }
        objectUrl = value;
        setUrl(value);
      }).catch(() => undefined);
    };
    // Older browsers and test environments still load a usable preview.
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer?.disconnect(); load(); }
    });
    if (observer && ref.current) observer.observe(ref.current);
    else load();
    return () => {
      controller.abort();
      observer?.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, scope]);
  return <img ref={ref} className={className} src={url || undefined} alt={name} decoding="async" onDoubleClick={onDoubleClick} />;
}
