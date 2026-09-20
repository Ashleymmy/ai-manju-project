/** Recognized file formats when desktop clipboard files omit their MIME type. */
const MEDIA_MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml", avif: "image/avif",
  heic: "image/heic", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4",
  flac: "audio/flac", aac: "audio/aac",
};

export type CanvasClipboardContent = { files: File[]; text: string };

export function normalizeCanvasClipboardFile(file: File, index: number): File {
  const extension = file.name.split(".").at(-1)?.toLowerCase() || "";
  const type = file.type && file.type !== "application/octet-stream"
    ? file.type : MEDIA_MIME_BY_EXTENSION[extension] || file.type;
  const suffix = Object.entries(MEDIA_MIME_BY_EXTENSION).find(([, mime]) => mime === type)?.[0] || "bin";
  const name = file.name || `pasted-${type.split("/")[0] || "file"}-${index + 1}.${suffix}`;
  return name === file.name && type === file.type ? file : new File([file], name, { type, lastModified: file.lastModified });
}

/** Snapshot native clipboard files synchronously before the paste event expires. */
export function readCanvasClipboardData(data: DataTransfer): CanvasClipboardContent {
  const files = Array.from(data.files);
  if (!files.length) {
    for (const item of Array.from(data.items)) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return { files: files.map(normalizeCanvasClipboardFile), text: data.getData("text/plain").replace(/\r\n?/g, "\n") };
}

/** Menu actions need the permission-gated API; keyboard paste uses its native event. */
export async function readSystemCanvasClipboard(): Promise<CanvasClipboardContent> {
  if (!navigator.clipboard?.read) {
    if (navigator.clipboard?.readText) return { files: [], text: (await navigator.clipboard.readText()).replace(/\r\n?/g, "\n") };
    throw new Error("Clipboard read unavailable");
  }
  const items = await navigator.clipboard.read();
  const files: File[] = [];
  const texts: string[] = [];
  for (const item of items) {
    // A clipboard item can expose multiple encodings of the same image.
    const mediaType = item.types.find(type => /^(image|video|audio)\//.test(type));
    if (mediaType) {
      const blob = await item.getType(mediaType);
      files.push(normalizeCanvasClipboardFile(new File([blob], "", { type: mediaType }), files.length));
    } else if (item.types.includes("text/plain")) {
      texts.push(await (await item.getType("text/plain")).text());
    }
  }
  return { files, text: texts.join("\n").replace(/\r\n?/g, "\n") };
}
