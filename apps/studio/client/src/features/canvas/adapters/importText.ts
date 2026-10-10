/** Plain-text documents become text nodes; richer formats (html, docx, pdf) are not read. */
const CANVAS_TEXT_FILE_EXTENSIONS = new Set(["txt", "md", "markdown"]);
const CANVAS_TEXT_FILE_TYPES = new Set(["text/plain", "text/markdown", "text/x-markdown"]);
/** The whole text is stored in the node and saved with every canvas snapshot. */
export const CANVAS_TEXT_IMPORT_MAX_BYTES = 1024 * 1024;
/** Accept value for the canvas file picker, alongside media. */
export const CANVAS_TEXT_FILE_ACCEPT = ".txt,.md,.markdown,text/plain,text/markdown";

export function isCanvasTextFile(file: File): boolean {
  const extension = file.name.includes(".") ? file.name.split(".").at(-1)!.toLowerCase() : "";
  return CANVAS_TEXT_FILE_TYPES.has(file.type) || CANVAS_TEXT_FILE_EXTENSIONS.has(extension);
}

/** Reads UTF-8, falling back to GB18030 for files saved by Chinese Windows editors. */
export async function readCanvasTextFile(file: File): Promise<string> {
  if (file.size > CANVAS_TEXT_IMPORT_MAX_BYTES) throw new Error("文本文件超过 1 MB，请拆分后再导入");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("gb18030").decode(bytes);
  }
  text = text.replace(/\r\n?/g, "\n");
  if (!text.trim()) throw new Error("文本文件没有内容");
  return text;
}

/** Selected text dragged in from another page or app; links and images carry a URI list instead. */
export function droppedCanvasText(data: Pick<DataTransfer, "types" | "getData">): string {
  if (Array.from(data.types).includes("text/uri-list")) return "";
  return data.getData("text/plain").replace(/\r\n?/g, "\n");
}
