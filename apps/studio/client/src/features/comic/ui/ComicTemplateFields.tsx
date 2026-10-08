import { FileText, Upload } from "lucide-react";
import {
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type SetStateAction,
} from "react";
import { toast } from "sonner";

import type { ComicAssetClass } from "@/entities/comic";

import {
  COMIC_CLASS_LABELS,
  COMIC_TEMPLATE_FILE_MAX_BYTES,
} from "../model/constants";
import type { ComicTemplateDraft } from "../model/workflow";

const TEMPLATE_CLASSES: ComicAssetClass[] = [
  "character",
  "environment",
  "prop",
  "ui",
];

const TEMPLATE_HINT =
  "支持《美术风格》、《资产名称》、《资产类别》、《资产设定》、《状态》";

/** Windows editors still save Chinese TXT as GB18030 by default, so UTF-8 is tried strictly first. */
export async function readComicTemplateFile(file: File): Promise<string> {
  if (!/\.txt$/i.test(file.name)) throw new Error("请选择 TXT 格式的模板文件");
  if (file.size > COMIC_TEMPLATE_FILE_MAX_BYTES) {
    throw new Error(
      `模板文件不能超过 ${COMIC_TEMPLATE_FILE_MAX_BYTES / 1024} KB`
    );
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("gb18030").decode(bytes);
  }
  text = text.replace(/^\uFEFF/, "").trim();
  if (!text) throw new Error("模板文件内容为空");
  return text;
}

export function ComicTemplateFields({
  value,
  onChange,
  variant,
  compact = false,
  disabled = false,
}: {
  value: ComicTemplateDraft;
  onChange: Dispatch<SetStateAction<ComicTemplateDraft>>;
  variant: "dialog" | "panel";
  compact?: boolean;
  disabled?: boolean;
}) {
  const inputs = useRef<Partial<Record<ComicAssetClass, HTMLInputElement>>>(
    {}
  );
  const [fileNames, setFileNames] = useState<
    Partial<Record<ComicAssetClass, string>>
  >({});

  const setTemplate = (key: ComicAssetClass, text: string) =>
    onChange(current => ({ ...current, [key]: text }));
  const setFileName = (key: ComicAssetClass, name: string) =>
    setFileNames(current => ({ ...current, [key]: name }));

  const loadFile = async (
    key: ComicAssetClass,
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    // Reset so choosing the same file again still fires a change event.
    input.value = "";
    if (!file) return;
    try {
      setTemplate(key, await readComicTemplateFile(file));
      setFileName(key, file.name);
      toast.success(`已载入${COMIC_CLASS_LABELS[key]}模板`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "模板文件读取失败");
    }
  };

  const textareaProps = (key: ComicAssetClass) => ({
    value: value[key] ?? "",
    disabled,
    onChange: (event: ChangeEvent<HTMLTextAreaElement>) => {
      setTemplate(key, event.target.value);
      if (fileNames[key]) setFileName(key, "");
    },
  });

  const uploadButton = (key: ComicAssetClass, className: string, iconSize: number) => {
    const fileName = fileNames[key];
    return (
      <>
        <button
          type="button"
          className={`${className}${fileName ? " is-loaded" : ""}`}
          disabled={disabled}
          title={fileName ? `已载入 ${fileName}，点击重新选择` : undefined}
          onClick={() => inputs.current[key]?.click()}
        >
          {fileName ? <FileText size={iconSize} /> : <Upload size={iconSize} />}
          <span>{fileName || `载入${COMIC_CLASS_LABELS[key]}模板 TXT`}</span>
        </button>
        <input
          ref={element => {
            if (element) inputs.current[key] = element;
          }}
          type="file"
          accept=".txt,text/plain"
          hidden
          onChange={event => void loadFile(key, event)}
        />
      </>
    );
  };

  if (variant === "panel") {
    return (
      <div className="template-upload-section">
        {TEMPLATE_CLASSES.map(key => (
          <div className="template-upload-item" key={key}>
            <p className="template-label">{COMIC_CLASS_LABELS[key]}分类模板（可选）</p>
            <div className="template-upload-box">
              <p className="template-hint">{TEMPLATE_HINT}</p>
              <textarea className="template-input" placeholder="输入分类字段或粘贴模板内容..." rows={3} {...textareaProps(key)} />
              {uploadButton(key, "template-upload-button", 14)}
            </div>
          </div>
        ))}
      </div>
    );
  }

  const items = TEMPLATE_CLASSES.map(key => (
    <div className="template-item" key={key}>
      <label className={compact ? "template-label" : "dialog-label"}>
        {COMIC_CLASS_LABELS[key]}分类模板（可选）
      </label>
      <p className="template-hint">{TEMPLATE_HINT}</p>
      <textarea rows={4} {...textareaProps(key)} />
      {uploadButton(key, "template-upload-btn", compact ? 16 : 12)}
    </div>
  ));
  /* 四个分类必须是 .templates-grid 的直接子节点，才能排成 2×2；
     中间再套一层无 class 的 wrapper 时，网格只剩一列，右侧会空出来 */
  return compact ? (
    <div className="templates-grid">{items}</div>
  ) : (
    <div className="dialog-section">
      <div className="templates-grid">{items}</div>
    </div>
  );
}
