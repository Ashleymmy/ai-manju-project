import { Film } from "lucide-react";
import { useState } from "react";
import { API_BASE_URL } from "@/shared/config";

/** Only Studio assets have authenticated posters; never send credentials to an external URL. */
export function videoPosterUrl(source: string) {
  try {
    const url = new URL(source, `${API_BASE_URL}/`);
    if (url.origin !== new URL(API_BASE_URL).origin || !/^\/api\/assets\/[^/]+\/content$/.test(url.pathname)) return undefined;
    url.searchParams.set("poster", "1");
    url.searchParams.delete("download");
    url.searchParams.delete("thumbnail");
    url.hash = "";
    return url.toString();
  } catch { return undefined; }
}

/** Browsing a history list must never fetch each original video. */
export function VideoThumbnail({ src, alt = "视频封面" }: { src: string; alt?: string }) {
  const poster = videoPosterUrl(src);
  const [failed, setFailed] = useState<string>();
  return poster && failed !== poster
    ? <img src={poster} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(poster)} />
    : <Film size={24} aria-label={alt} />;
}
