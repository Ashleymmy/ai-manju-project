import { unzipSync } from "fflate";

export const COMIC_SOURCE_MAX_BYTES = 40 * 1024 * 1024;
export const COMIC_SCRIPT_MAX_CHARS = 120_000;
export const COMIC_IMPORT_MAX_ASSETS = 500;

const classPrefixes = {
  character: "C",
  environment: "S",
  prop: "P",
  ui: "U",
};

const headerAliases = {
  code: ["资产id", "资产编号", "编号", "id"],
  name: ["资产名称", "名称", "首次出场集数+资产名称"],
  class: ["资产类别", "类别", "类型"],
  state: ["状态/版本", "资产状态", "状态"],
  setting: ["资产设定/状态", "资产设定", "视觉设定", "设定"],
  prompt: ["生图提示词", "c列生图提示词", "提示词"],
  changeRequest: ["修改需求", "变更需求"],
  firstAppearance: ["首次出场", "首次出场集数"],
  sourceQuote: ["剧本原文出处", "原文出处", "剧本原文"],
  episodes: ["全部出场集数", "出场集数"],
  purpose: ["剧情/连续性用途", "剧情用途", "连续性用途"],
  priority: ["生产优先级", "优先级"],
  family: ["场景家族", "资产家族"],
  anchors: ["连续性锚点", "锚点"],
  notes: ["备注", "说明"],
};

export async function extractComicScript(file) {
  assertSourceSize(file);
  const extension = fileExtension(file.name);
  let text = "";
  if (extension === ".txt" || extension === ".md") {
    text = await file.text();
  } else if (extension === ".docx") {
    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
    const documentXML = entries["word/document.xml"];
    if (!documentXML) throw new Error("DOCX 中未找到 word/document.xml");
    const xml = new TextDecoder().decode(documentXML);
    const paragraphs = [...xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)].map(
      (match) => xmlText(match[1]).replace(/\s+/g, " ").trim(),
    );
    text = paragraphs.filter(Boolean).join("\n");
  } else {
    throw new Error("剧本仅支持 DOCX、TXT 或 MD");
  }
  text = text.replace(/\r\n?/g, "\n").trim();
  if (!text) throw new Error("剧本没有可读取的文字内容");
  const truncated = text.length > COMIC_SCRIPT_MAX_CHARS;
  return {
    text: truncated ? text.slice(0, COMIC_SCRIPT_MAX_CHARS) : text,
    truncated,
  };
}

export async function parseComicWorkbook(file) {
  assertSourceSize(file);
  if (fileExtension(file.name) !== ".xlsx") {
    throw new Error("资产表仅支持 XLSX");
  }
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const sharedStrings = parseSharedStrings(entries["xl/sharedStrings.xml"]);
  const sheets = workbookSheets(entries);
  const candidates = [];
  for (const sheet of sheets) {
    const data = entries[sheet.path];
    if (!data) continue;
    const rows = parseSheetRows(new TextDecoder().decode(data), sharedStrings);
    const headerIndex = rows.findIndex((row) =>
      row.some((value) => {
        const header = normalizeHeader(value);
        return (
          headerAliases.name.includes(header) ||
          headerAliases.prompt.includes(header)
        );
      }),
    );
    if (headerIndex < 0) continue;
    const headers = rows[headerIndex].map(normalizeHeader);
    const sheetClass = classFromValue(sheet.name);
    for (const row of rows.slice(headerIndex + 1)) {
      const rawName = readCell(row, headers, headerAliases.name);
      const name = cleanImportedName(rawName);
      if (!name) continue;
      const assetClass =
        classFromValue(readCell(row, headers, headerAliases.class)) ||
        sheetClass;
      if (!assetClass) continue;
      const setting = readCell(row, headers, headerAliases.setting);
      const metadata = [
        ["首次出场", readCell(row, headers, headerAliases.firstAppearance)],
        ["剧本原文", readCell(row, headers, headerAliases.sourceQuote)],
        ["全部出场", readCell(row, headers, headerAliases.episodes)],
        ["剧情用途", readCell(row, headers, headerAliases.purpose)],
        ["生产优先级", readCell(row, headers, headerAliases.priority)],
        ["资产家族", readCell(row, headers, headerAliases.family)],
        ["连续性锚点", readCell(row, headers, headerAliases.anchors)],
        ["备注", readCell(row, headers, headerAliases.notes)],
      ]
        .filter(([, value]) => value)
        .map(([label, value]) => `${label}：${value}`);
      candidates.push({
        key: cryptoKey(),
        code: readCell(row, headers, headerAliases.code),
        class: assetClass,
        name,
        state: readCell(row, headers, headerAliases.state) || "默认",
        description: [setting, ...metadata].filter(Boolean).join("\n"),
        visual_description: setting,
        change_request: readCell(row, headers, headerAliases.changeRequest),
        source_prompt: readCell(row, headers, headerAliases.prompt),
        prompt_template: "",
        archive_status: "待生图",
      });
    }
  }
  if (!candidates.length) {
    throw new Error("没有在资产表中找到可导入的资产；请检查 Sheet 和中文表头");
  }
  return finalizeCandidates(candidates);
}

export function parseComicAiCandidates(raw) {
  const text = String(raw || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const attempts = [text];
  const objectStart = text.indexOf("{");
  const objectEnd = text.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart)
    attempts.push(text.slice(objectStart, objectEnd + 1));
  const arrayStart = text.indexOf("[");
  const arrayEnd = text.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart)
    attempts.push(text.slice(arrayStart, arrayEnd + 1));
  let parsed;
  for (const candidate of attempts) {
    try {
      parsed = JSON.parse(candidate);
      break;
    } catch {}
  }
  const values = Array.isArray(parsed) ? parsed : parsed?.assets;
  if (!Array.isArray(values))
    throw new Error("文本模型没有返回合法的资产 JSON");
  const candidates = values
    .slice(0, COMIC_IMPORT_MAX_ASSETS)
    .map((value) => normalizeCandidate(value))
    .filter(Boolean);
  if (!candidates.length) throw new Error("文本模型没有识别出可确认的资产");
  return finalizeCandidates(candidates);
}

export function createEmptyComicCandidate(assetClass = "character") {
  return finalizeCandidates([
    {
      key: cryptoKey(),
      code: "",
      class: classFromValue(assetClass) || "character",
      name: "待填写资产",
      state: "默认",
      description: "",
      visual_description: "",
      change_request: "",
      source_prompt: "",
      prompt_template: "",
      archive_status: "待生图",
    },
  ])[0];
}

function normalizeCandidate(value) {
  if (!value || typeof value !== "object") return null;
  const assetClass = classFromValue(
    value.class || value.asset_class || value.category || value["资产类别"],
  );
  const name = String(
    value.name || value.asset_name || value["资产名称"] || "",
  ).trim();
  if (!assetClass || !name) return null;
  const setting = String(
    value.visual_description ||
      value.description ||
      value.setting ||
      value["资产设定"] ||
      "",
  ).trim();
  return {
    key: cryptoKey(),
    code: String(value.code || value.asset_id || value["资产ID"] || "").trim(),
    class: assetClass,
    name,
    state: String(value.state || value["状态"] || "默认").trim() || "默认",
    description: String(value.description || setting).trim(),
    visual_description: setting,
    change_request: String(value.change_request || "").trim(),
    source_prompt: String(
      value.source_prompt || value.prompt || value["生图提示词"] || "",
    ).trim(),
    prompt_template: "",
    archive_status: "待生图",
  };
}

function finalizeCandidates(values) {
  if (values.length > COMIC_IMPORT_MAX_ASSETS)
    throw new Error(`单次最多导入 ${COMIC_IMPORT_MAX_ASSETS} 项资产`);
  const sequences = { character: 0, environment: 0, prop: 0, ui: 0 };
  const usedCodes = new Set();
  return values.map((value) => {
    sequences[value.class] += 1;
    let code = String(value.code || "")
      .trim()
      .toUpperCase();
    if (!code)
      code = `${classPrefixes[value.class]}${String(sequences[value.class]).padStart(3, "0")}`;
    const base = code;
    let suffix = 2;
    while (usedCodes.has(code)) code = `${base}-${suffix++}`;
    usedCodes.add(code);
    return { ...value, key: value.key || cryptoKey(), code };
  });
}

function workbookSheets(entries) {
  const workbook = decodeEntry(entries["xl/workbook.xml"]);
  const relationships = decodeEntry(entries["xl/_rels/workbook.xml.rels"]);
  const targets = new Map();
  for (const match of relationships.matchAll(
    /<Relationship\b([^>]*)\/?\s*>/g,
  )) {
    const attrs = xmlAttributes(match[1]);
    if (attrs.Id && attrs.Target)
      targets.set(attrs.Id, normalizeSheetPath(attrs.Target));
  }
  const sheets = [];
  for (const match of workbook.matchAll(/<sheet\b([^>]*)\/?\s*>/g)) {
    const attrs = xmlAttributes(match[1]);
    const relationshipID = attrs["r:id"];
    const path = targets.get(relationshipID);
    if (path) sheets.push({ name: decodeXML(attrs.name || ""), path });
  }
  if (sheets.length) return sheets;
  return Object.keys(entries)
    .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(path))
    .sort()
    .map((path) => ({ name: path, path }));
}

function normalizeSheetPath(target) {
  const clean = String(target).replace(/^\//, "");
  if (clean.startsWith("xl/")) return clean;
  return `xl/${clean.replace(/^\.\.\//, "")}`;
}

function parseSharedStrings(data) {
  const xml = decodeEntry(data);
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) =>
    xmlText(match[1]),
  );
}

function parseSheetRows(xml, sharedStrings) {
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cellMatch of rowMatch[1].matchAll(
      /<c\b([^>]*)>([\s\S]*?)<\/c>/g,
    )) {
      const attrs = xmlAttributes(cellMatch[1]);
      const column = columnIndex(attrs.r || "");
      if (column < 0) continue;
      const body = cellMatch[2];
      let value = "";
      if (attrs.t === "inlineStr") value = xmlText(body);
      else {
        const raw = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] || "";
        value =
          attrs.t === "s" ? sharedStrings[Number(raw)] || "" : decodeXML(raw);
      }
      row[column] = String(value).trim();
    }
    rows.push(row);
  }
  return rows;
}

function readCell(row, headers, aliases) {
  const index = headers.findIndex((header) => aliases.includes(header));
  return index >= 0 ? String(row[index] || "").trim() : "";
}

function classFromValue(value) {
  const text = String(value || "")
    .trim()
    .toLowerCase();
  if (["character", "人物", "角色"].some((item) => text.includes(item)))
    return "character";
  if (["environment", "场景", "环境"].some((item) => text.includes(item)))
    return "environment";
  if (["prop", "道具", "物件"].some((item) => text.includes(item)))
    return "prop";
  if (["ui", "界面"].some((item) => text.includes(item))) return "ui";
  return "";
}

function cleanImportedName(value) {
  return String(value || "")
    .replace(/^第?\s*\d+\s*集\s*[+＋:：\-—]?\s*/i, "")
    .trim();
}

function normalizeHeader(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\s（）()_\-—:：]/g, "");
}

function columnIndex(reference) {
  const letters = String(reference)
    .match(/^[A-Z]+/i)?.[0]
    ?.toUpperCase();
  if (!letters) return -1;
  let index = 0;
  for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64;
  return index - 1;
}

function xmlText(fragment) {
  return [
    ...String(fragment).matchAll(
      /<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g,
    ),
  ]
    .map((match) => decodeXML(match[1]))
    .join("");
}

function xmlAttributes(fragment) {
  const result = {};
  for (const match of String(fragment).matchAll(
    /([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/g,
  )) {
    result[match[1]] = decodeXML(match[3]);
  }
  return result;
}

function decodeXML(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function decodeEntry(data) {
  return data ? new TextDecoder().decode(data) : "";
}

function fileExtension(name) {
  const index = String(name || "").lastIndexOf(".");
  return index >= 0 ? String(name).slice(index).toLowerCase() : "";
}

function assertSourceSize(file) {
  if (!file || !file.name) throw new Error("请选择来源文件");
  if (file.size > COMIC_SOURCE_MAX_BYTES)
    throw new Error("来源文件不能超过 40 MiB");
}

function cryptoKey() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `candidate-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}
