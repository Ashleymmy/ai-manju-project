import { Uint8ArrayReader, ZipReader } from "@zip.js/zip.js";
import { AGENT_DOCUMENT_LIMITS, validateAgentDocument } from "./documents";

async function validateOfficeArchive(bytes: Uint8Array, required: string) {
  const reader = new ZipReader(new Uint8ArrayReader(bytes), { useWebWorkers: false });
  let expanded = 0;
  const names = new Set<string>();
  try {
    for await (const entry of reader.getEntriesGenerator()) {
      if (entry.encrypted) throw new Error("请先解除文件密码保护");
      expanded += entry.uncompressedSize;
      if (names.has(entry.filename) || names.size >= AGENT_DOCUMENT_LIMITS.zipEntries || expanded > AGENT_DOCUMENT_LIMITS.expandedBytes) {
        throw new Error("文档展开后过大或结构异常，请拆分文件后导入");
      }
      names.add(entry.filename);
    }
    if (!names.has(required)) throw new Error("文件格式与扩展名不符，或文件已经损坏");
  } finally {
    await reader.close();
  }
}

function decodeText(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return new TextDecoder("gb18030", { fatal: true }).decode(bytes); }
}

export async function parseAgentDocument(name: string, buffer: ArrayBuffer): Promise<string> {
  const extension = validateAgentDocument({ name, size: buffer.byteLength });
  const bytes = new Uint8Array(buffer);
  let text: string;
  if (extension === ".docx") {
    await validateOfficeArchive(bytes, "word/document.xml");
    const mammoth = await import("mammoth");
    text = (await mammoth.extractRawText({ arrayBuffer: buffer })).value;
  } else if (extension === ".xlsx" || extension === ".xls") {
    if (extension === ".xlsx") await validateOfficeArchive(bytes, "xl/workbook.xml");
    else if (![0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((value, i) => bytes[i] === value)) {
      throw new Error("XLS 格式无效，请用 Excel 另存为 XLSX 后导入");
    }
    const XLSX = await import("@e965/xlsx");
    const workbook = XLSX.read(buffer, { type: "array", cellHTML: false, cellFormula: true });
    let cells = 0;
    const sheets: string[] = [];
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name];
      if (!sheet["!ref"]) continue;
      const range = XLSX.utils.decode_range(sheet["!ref"]);
      cells += (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1);
      if (cells > AGENT_DOCUMENT_LIMITS.cells) throw new Error("表格范围过大，请拆分工作表或清除多余的空行空列");
      // Preserve formulas without cached values as source text; never execute them.
      for (const [key, cell] of Object.entries(sheet)) {
        if (!key.startsWith("!") && cell.f && cell.v == null) sheet[key] = { t: "s", v: `=${cell.f}` };
      }
      const rows = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
      if (rows.trim()) sheets.push(`工作表：${name}\n${rows}`);
    }
    text = sheets.join("\n\n");
  } else {
    text = decodeText(bytes);
    if (/[\x00-\x08\x0e-\x1f]/.test(text)) throw new Error("文件包含二进制内容，无法作为文本读取");
  }
  text = text.replace(/\r\n?/g, "\n").trim();
  if (!text) throw new Error("文件没有可读取的文字内容");
  if (text.length > AGENT_DOCUMENT_LIMITS.chars) throw new Error("文件文字超过 60,000 字符，请拆分后导入");
  return text;
}
