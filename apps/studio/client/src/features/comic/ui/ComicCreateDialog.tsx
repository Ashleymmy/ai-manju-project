import { Loader2, Upload, X } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";

import type { CapabilityModelCatalog } from "@/entities/model";
import { modelName, resolveModel } from "@/shared/lib/modelSelection";
import type { ComicTemplateDraft } from "../model/workflow";
import { ComicAnalysisSettings } from "./ComicAnalysisSettings";
import { ComicTemplateFields } from "./ComicTemplateFields";

export type ComicCreationMode = "script" | "import" | "empty";

type ComicCreateDialogProps = {
  open: boolean;
  creationMode: ComicCreationMode;
  setCreationMode: Dispatch<SetStateAction<ComicCreationMode>>;
  projectTitle: string;
  setProjectTitle: Dispatch<SetStateAction<string>>;
  stylePreset: string;
  setStylePreset: Dispatch<SetStateAction<string>>;
  modelCatalog: CapabilityModelCatalog | null;
  modelsLoading: boolean;
  modelsError: boolean;
  onRefreshModels: () => void;
  analysisModel: string;
  setAnalysisModel: Dispatch<SetStateAction<string>>;
  instruction: string;
  setInstruction: Dispatch<SetStateAction<string>>;
  scriptFile: File | null;
  setScriptFile: Dispatch<SetStateAction<File | null>>;
  workbookFile: File | null;
  setWorkbookFile: Dispatch<SetStateAction<File | null>>;
  templates: ComicTemplateDraft;
  setTemplates: Dispatch<SetStateAction<ComicTemplateDraft>>;
  isParsingScript: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export function ComicCreateDialog({
  open,
  creationMode,
  setCreationMode,
  projectTitle,
  setProjectTitle,
  stylePreset,
  setStylePreset,
  modelCatalog,
  modelsLoading,
  modelsError,
  onRefreshModels,
  analysisModel,
  setAnalysisModel,
  instruction,
  setInstruction,
  scriptFile,
  setScriptFile,
  workbookFile,
  setWorkbookFile,
  templates,
  setTemplates,
  isParsingScript,
  onClose,
  onConfirm,
}: ComicCreateDialogProps) {
  if (!open) return null;
  const modelReady = !modelsLoading && !modelsError && Boolean(resolveModel(modelCatalog?.models || [], analysisModel));
  const canConfirm = Boolean(projectTitle.trim()) && !isParsingScript && (creationMode === "empty" || (creationMode === "import" ? workbookFile : scriptFile && modelReady && instruction.trim()));
  const close = () => { if (!isParsingScript) onClose(); };

  return (
    <div className="modal-backdrop" onClick={close}>
      <div
        className="comic-create-dialog"
        role="dialog" aria-modal="true" aria-labelledby="comic-create-title"
        onClick={event => event.stopPropagation()}
      >
        <div className="dialog-header">
          <h2 id="comic-create-title">新建漫剧资产项目</h2>
          <button className="dialog-close" onClick={close} disabled={isParsingScript} aria-label="关闭新建项目">
            <X size={20} />
          </button>
        </div>

        <fieldset className="dialog-body" disabled={isParsingScript}>
          <div className="dialog-section">
            <label className="dialog-label">创建方式</label>
            <div className="creation-mode-tabs">
              <button
                className={`mode-tab ${creationMode === "script" ? "active" : ""}`}
                onClick={() => setCreationMode("script")}
              >
                从剧本创建
              </button>
              <button
                className={`mode-tab ${creationMode === "import" ? "active" : ""}`}
                onClick={() => setCreationMode("import")}
              >
                导入资产表
              </button>
              <button
                className={`mode-tab ${creationMode === "empty" ? "active" : ""}`}
                onClick={() => setCreationMode("empty")}
              >
                创建空项目
              </button>
            </div>
          </div>

          {creationMode === "script" && (
            <>
              <div className="dialog-row">
                <div className="dialog-field">
                  <label className="dialog-label">项目名称</label>
                  <input
                    type="text"
                    placeholder="例如：画家故国第一季"
                    value={projectTitle}
                    onChange={event => setProjectTitle(event.target.value)}
                  />
                </div>
                <div className="dialog-field">
                  <label className="dialog-label">全局美术风格</label>
                  <input
                    type="text"
                    list="art-style-options"
                    placeholder="选择预设风格或直接输入自定义风格"
                    value={stylePreset}
                    onChange={event => setStylePreset(event.target.value)}
                  />
                  <datalist id="art-style-options">
                    <option value="3D动漫PBR" />
                    <option value="国风动画" />
                    <option value="二维赛璐璐" />
                    <option value="微写实动画" />
                    <option value="东方赛博水墨" />
                  </datalist>
                </div>
              </div>

              <div className="dialog-section">
                <label className="dialog-label">
                  选择剧本（DOCX / TXT / MD）
                </label>
                <div
                  className="file-upload-area"
                  onClick={() =>
                    !isParsingScript && !scriptFile &&
                    document.getElementById("script-file-input")?.click()
                  }
                  onDragOver={event => event.preventDefault()}
                  onDrop={event => {
                    event.preventDefault();
                    if (isParsingScript) return;
                    const file = event.dataTransfer.files[0];
                    if (file) setScriptFile(file);
                  }}
                  style={{ cursor: scriptFile ? "default" : "pointer" }}
                >
                  <Upload size={20} />
                  <p>
                    {scriptFile
                      ? `${scriptFile.name} ${(scriptFile.size / 1024).toFixed(2)}KB`
                      : "点击选择文件 或将任何文件拖拽至此处"}
                  </p>
                  <small>最大 40 MB</small>
                  {scriptFile && (
                    <button
                      onClick={event => {
                        event.stopPropagation();
                        setScriptFile(null);
                      }}
                      style={{
                        position: "absolute",
                        top: "10px",
                        right: "10px",
                        padding: "4px 8px",
                        background: "rgba(255,68,68,0.1)",
                        border: "1px solid rgba(255,68,68,0.3)",
                        color: "#ff4444",
                        cursor: "pointer",
                        fontSize: "12px",
                        borderRadius: "4px",
                      }}
                    >
                      删除
                    </button>
                  )}
                </div>
                <input
                  id="script-file-input"
                  type="file"
                  accept=".docx,.txt,.md"
                  style={{ display: "none" }}
                  onChange={event => {
                    const file = event.target.files?.[0];
                    if (file) setScriptFile(file);
                  }}
                />
              </div>

              <ComicAnalysisSettings
                catalog={modelCatalog} loading={modelsLoading} error={modelsError} disabled={isParsingScript}
                onRefresh={onRefreshModels} model={analysisModel} onModelChange={setAnalysisModel}
                instruction={instruction} onInstructionChange={setInstruction}
              />
              {isParsingScript && <div className="comic-analysis-progress" role="status">
                <Loader2 size={18} className="animate-spin" />
                <div><strong>正在分析剧本…</strong><p>{scriptFile?.name} · {modelName(analysisModel)}</p></div>
              </div>}

              <ComicTemplateFields variant="dialog" value={templates} onChange={setTemplates} />
            </>
          )}

          {creationMode === "import" && (
            <>
              <ProjectFields
                title={projectTitle}
                setTitle={setProjectTitle}
                stylePreset={stylePreset}
                setStylePreset={setStylePreset}
                datalistId="art-style-options-import"
              />

              <div className="dialog-section">
                <label className="dialog-label">选择资产表（XLSX）</label>
                <div
                  className="file-upload-area"
                  onClick={() =>
                    !isParsingScript && !workbookFile &&
                    document.getElementById("workbook-file-input")?.click()
                  }
                  onDragOver={event => event.preventDefault()}
                  onDrop={event => {
                    event.preventDefault();
                    if (isParsingScript) return;
                    const file = event.dataTransfer.files[0];
                    if (file) setWorkbookFile(file);
                  }}
                  style={{ cursor: workbookFile ? "default" : "pointer" }}
                >
                  <Upload size={20} />
                  <p>
                    {workbookFile
                      ? `${workbookFile.name} ${(workbookFile.size / 1024).toFixed(2)}KB`
                      : "点击选择文件 或将任何文件拖拽至此处"}
                  </p>
                  <small>最大 40 MB</small>
                  {workbookFile && (
                    <button
                      onClick={event => {
                        event.stopPropagation();
                        setWorkbookFile(null);
                      }}
                      style={{
                        position: "absolute",
                        top: "10px",
                        right: "10px",
                        padding: "4px 8px",
                        background: "rgba(255,68,68,0.1)",
                        border: "1px solid rgba(255,68,68,0.3)",
                        color: "#ff4444",
                        cursor: "pointer",
                        fontSize: "12px",
                        borderRadius: "4px",
                      }}
                    >
                      删除
                    </button>
                  )}
                </div>
                <input
                  id="workbook-file-input"
                  type="file"
                  accept=".xlsx"
                  style={{ display: "none" }}
                  onChange={event => {
                    const file = event.target.files?.[0];
                    if (file) setWorkbookFile(file);
                  }}
                />
                <p className="dialog-hint" style={{ marginTop: "8px" }}>
                  支持人物、场景、道具、UI四 Sheet 列同步标版表中文本文；解释不两用模板。
                </p>
              </div>

              <div className="dialog-warning">
                <span>⚠</span>
                <p>模板或来源文件变化不会覆盖现有项目，批准提示词或已创建批次</p>
              </div>

              <ComicTemplateFields variant="dialog" value={templates} onChange={setTemplates} />
            </>
          )}

          {creationMode === "empty" && (
            <>
              <ProjectFields
                title={projectTitle}
                setTitle={setProjectTitle}
                stylePreset={stylePreset}
                setStylePreset={setStylePreset}
                datalistId="art-style-options-empty"
              />

              <div className="dialog-warning">
                <span>⚠</span>
                <p>模板或来源文件变化不会覆盖现有项目、批准提示词或已创建批次</p>
              </div>

              <ComicTemplateFields variant="dialog" compact value={templates} onChange={setTemplates} />
            </>
          )}
        </fieldset>

        <div className="dialog-footer">
          <button className="outline-button" onClick={close} disabled={isParsingScript}>
            取消
          </button>
          <button className="vermilion-button" onClick={onConfirm} disabled={!canConfirm}>
            {isParsingScript ? "处理中…" : creationMode === "empty" ? "创建空项目" : creationMode === "import" ? "导入资产表" : "解析并预览"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProjectFields({
  title,
  setTitle,
  stylePreset,
  setStylePreset,
  datalistId,
}: {
  title: string;
  setTitle: Dispatch<SetStateAction<string>>;
  stylePreset: string;
  setStylePreset: Dispatch<SetStateAction<string>>;
  datalistId: string;
}) {
  return (
    <div className="dialog-row">
      <div className="dialog-field">
        <label className="dialog-label">项目名称</label>
        <input
          type="text"
          placeholder="例如：画家故国第一季"
          value={title}
          onChange={event => setTitle(event.target.value)}
        />
      </div>
      <div className="dialog-field">
        <label className="dialog-label">全局美术风格</label>
        <input
          type="text"
          list={datalistId}
          placeholder="选择预设风格或直接输入自定义风格"
          value={stylePreset}
          onChange={event => setStylePreset(event.target.value)}
        />
        <datalist id={datalistId}>
          <option value="3D动漫PBR" />
          <option value="国风动画" />
          <option value="二维赛璐璐" />
          <option value="微写实动画" />
          <option value="东方赛博水墨" />
        </datalist>
      </div>
    </div>
  );
}
