/** Image formats the asset API stores; anything else is converted in the browser before upload. */
const SERVER_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
type ServerImageType = typeof SERVER_IMAGE_TYPES[number];
const SERVER_IMAGE_EXTENSIONS: Record<ServerImageType, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
};
// Enough bytes for every signature below, including SVG prologs and ISO-BMFF brand lists.
const IMAGE_SNIFF_BYTES = 512;
// A stalled decoder must not block the rest of a multi-file import.
const IMAGE_DECODE_TIMEOUT_MS = 15_000;
// Converted images keep alpha; browsers without WebP encoding fall back to PNG.
const CONVERTED_IMAGE_TYPE = "image/webp";
const CONVERTED_IMAGE_QUALITY = 0.92;

export type SniffedImageType = ServerImageType | "image/bmp" | "image/x-icon" | "image/tiff" | "image/avif" | "image/heic" | "image/svg+xml";

const SNIFFED_FORMAT_LABELS: Record<string, string> = {
  "image/bmp": "BMP", "image/x-icon": "ICO", "image/tiff": "TIFF", "image/avif": "AVIF",
  "image/heic": "HEIC/HEIF（苹果相册）", "image/svg+xml": "SVG",
};

export type CanvasImageCodec = {
  /** Resolves the intrinsic size only when the browser can actually render the bytes. */
  decode(file: Blob): Promise<{ width: number; height: number }>;
  /** Re-encodes a decodable image into a format the asset API accepts. */
  convert(file: Blob, width: number, height: number): Promise<Blob>;
};

export type PreparedCanvasImage = { file: File; width: number; height: number; converted: boolean };

/** Reads the real format from file bytes; desktop, chat apps and web downloads often mislabel extensions. */
export function sniffImageType(bytes: Uint8Array): SniffedImageType | "" {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, 4) === "PNG" && bytes[4] === 0x0d && bytes[5] === 0x0a) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")) return "image/gif";
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 2 && ascii(0, 2) === "BM") return "image/bmp";
  if (bytes.length >= 4 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) return "image/x-icon";
  if (bytes.length >= 4 && (ascii(0, 4) === "II*\u0000" || ascii(0, 4) === "MM\u0000*")) return "image/tiff";
  if (bytes.length >= 12 && ascii(4, 8) === "ftyp") {
    const boxSize = Math.min(bytes.length, (bytes[0] << 24 | bytes[1] << 16 | bytes[2] << 8 | bytes[3]) >>> 0 || bytes.length);
    const brands = [ascii(8, 12)];
    for (let offset = 16; offset + 4 <= boxSize; offset += 4) brands.push(ascii(offset, offset + 4));
    if (brands.some(brand => brand === "avif" || brand === "avis")) return "image/avif";
    if (brands.some(brand => ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(brand))) return "image/heic";
    return "";
  }
  const text = new TextDecoder().decode(bytes).replace(/^\uFEFF/, "").trimStart().toLowerCase();
  if ((text.startsWith("<?xml") || text.startsWith("<svg") || text.startsWith("<!--")) && text.includes("<svg")) return "image/svg+xml";
  return "";
}

/** Files the canvas should inspect: labelled media, or unlabelled files that may still be images. */
export function isCanvasImportCandidate(file: File) {
  return /^(image|video|audio)\//.test(file.type) || !file.type || file.type === "application/octet-stream";
}

/**
 * Guarantees an imported image both renders in the browser and passes the asset API's
 * format check: mislabelled files are relabelled, other decodable formats are converted,
 * and unreadable ones are rejected before an empty node is created.
 */
export async function prepareCanvasImportImage(file: File, codec: CanvasImageCodec = browserImageCodec): Promise<PreparedCanvasImage> {
  if (!file.size) throw new Error("文件为空，可能还没有下载完成，请保存到本地后再导入");
  const sniffed = sniffImageType(new Uint8Array(await file.slice(0, IMAGE_SNIFF_BYTES).arrayBuffer()));
  if (!sniffed && !file.type.startsWith("image/")) throw new Error("不是可识别的图片文件");
  const label = SNIFFED_FORMAT_LABELS[sniffed] || "该";
  const size = await codec.decode(file).catch(() => null);
  if (!size || !(size.width > 0 && size.height > 0)) {
    throw new Error(sniffed && !isServerImageType(sniffed)
      ? `${label}格式浏览器无法读取，请先转换为 JPG 或 PNG 后再导入`
      : "图片无法读取，文件可能已损坏或没有下载完整");
  }
  if (sniffed && isServerImageType(sniffed)) {
    const name = withExtension(file.name, SERVER_IMAGE_EXTENSIONS[sniffed]);
    const relabelled = file.type === sniffed && name === file.name ? file : new File([file], name, { type: sniffed, lastModified: file.lastModified });
    return { file: relabelled, ...size, converted: false };
  }
  const blob = await codec.convert(file, size.width, size.height).catch(() => null);
  const type = blob?.type as ServerImageType | undefined;
  if (!blob?.size || !type || !isServerImageType(type)) throw new Error(`${label}格式转换失败，请先转换为 JPG 或 PNG 后再导入`);
  const converted = new File([blob], withExtension(file.name, SERVER_IMAGE_EXTENSIONS[type]), { type, lastModified: file.lastModified });
  return { file: converted, ...size, converted: true };
}

function isServerImageType(type: string): type is ServerImageType {
  return (SERVER_IMAGE_TYPES as readonly string[]).includes(type);
}

function withExtension(name: string, extension: string) {
  const base = name.replace(/\.[a-z0-9]{1,5}$/i, "").trim() || "image";
  return `${base}.${extension}`;
}

function loadImage(file: Blob) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    const timer = setTimeout(() => finish(new Error("Image decode timed out")), IMAGE_DECODE_TIMEOUT_MS);
    const finish = (error?: Error) => {
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      URL.revokeObjectURL(url);
      if (error) {
        image.src = "";
        reject(error);
      } else resolve(image);
    };
    image.onload = () => void image.decode().then(() => finish(), () => finish(new Error("Image decode failed")));
    image.onerror = () => finish(new Error("Image load failed"));
    image.src = url;
  });
}

const browserImageCodec: CanvasImageCodec = {
  async decode(file) {
    const image = await loadImage(file);
    return { width: image.naturalWidth, height: image.naturalHeight };
  },
  async convert(file, width, height) {
    const image = await loadImage(file);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is not available");
    context.drawImage(image, 0, 0, width, height);
    return new Promise<Blob>((resolve, reject) => canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error("Image encode failed")),
      CONVERTED_IMAGE_TYPE, CONVERTED_IMAGE_QUALITY,
    ));
  },
};
