import type { Asset } from "./model";

// Display names are editable and extension-free; downloaded files still need
// their format. Dots in names such as "镜头1.2" are not file extensions.
const MEDIA_EXTENSION = /\.(png|jpe?g|webp|gif|avif|bmp|tiff?|svg|heic|heif|mp4|m4v|mov|webm|mkv|avi|mp3|wav|ogg|opus|aac|flac|m4a|pcm)$/i;
const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif",
  "image/svg+xml": "svg", "image/bmp": "bmp", "image/tiff": "tiff", "image/heic": "heic", "image/heif": "heif",
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/x-matroska": "mkv",
  "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/ogg": "ogg",
  "audio/opus": "opus", "audio/aac": "aac", "audio/flac": "flac", "audio/mp4": "m4a", "audio/pcm": "pcm",
};
export function assetDownloadFileName(asset: Pick<Asset, "name" | "type" | "content_type">, contentType = asset.content_type || "") {
  const name = asset.name.trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-") || "素材";
  if (MEDIA_EXTENSION.test(name)) return name;
  const mime = contentType.split(";")[0].trim().toLowerCase();
  const extension = MIME_EXTENSIONS[mime] || (asset.type === "image" ? "png" : asset.type === "video" ? "mp4" : "mp3");
  return `${name}.${extension}`;
}
