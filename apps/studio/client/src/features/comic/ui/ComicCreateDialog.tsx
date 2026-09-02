import { Upload, X } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";

export type ComicCreationMode = "script" | "import" | "empty";

type ComicCreateDialogProps = {
  open: boolean;
  creationMode: ComicCreationMode;
  setCreationMode: Dispatch<SetStateAction<ComicCreationMode>>;
  projectTitle: string;
  setProjectTitle: Dispatch<SetStateAction<string>>;
  stylePreset: string;
  setStylePreset: Dispatch<SetStateAction<string>>;
  analysisModel: string;
  setAnalysisModel: Dispatch<SetStateAction<string>>;
  instruction: string;
  setInstruction: Dispatch<SetStateAction<string>>;
  scriptFile: File | null;
  setScriptFile: Dispatch<SetStateAction<File | null>>;
  workbookFile: File | null;
  setWorkbookFile: Dispatch<SetStateAction<File | null>>;
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
  analysisModel,
  setAnalysisModel,
  instruction,
  setInstruction,
  scriptFile,
  setScriptFile,
  workbookFile,
  setWorkbookFile,
  isParsingScript,
  onClose,
  onConfirm,
}: ComicCreateDialogProps) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="comic-create-dialog"
        onClick={event => event.stopPropagation()}
      >
        <div className="dialog-header">
          <h2>新建漫剧资产项目</h2>
          <button className="dialog-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="dialog-body">
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
                    !scriptFile &&
                    document.getElementById("script-file-input")?.click()
                  }
                  onDragOver={event => event.preventDefault()}
                  onDrop={event => {
                    event.preventDefault();
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

              <div className="dialog-section">
                <label className="dialog-label">本次脚本分析模板</label>
                <select
                  value={analysisModel}
                  onChange={event => setAnalysisModel(event.target.value)}
                >
                  <option value="gpt-5.6-scl">gpt-5.6-scl</option>
                  <option value="gpt-4">gpt-4</option>
                  <option value="claude-3">claude-3</option>
                </select>
              </div>

              {isParsingScript && (
                <div
                  className="dialog-section"
                  style={{
                    padding: "20px",
                    border: "1px solid rgba(125,211,252,.25)",
                    background: "rgba(125,211,252,.05)",
                    borderRadius: "8px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: "16px",
                    }}
                  >
                    <h3
                      style={{
                        margin: 0,
                        fontSize: "14px",
                        color: "#eff3ed",
                        fontWeight: 600,
                      }}
                    >
                      解析本分析已配置
                    </h3>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: "8px" }}
                    >
                      <div
                        style={{
                          width: "16px",
                          height: "16px",
                          border: "2px solid rgba(125,211,252,.3)",
                          borderTopColor: "#7dd3fc",
                          borderRadius: "50%",
                          animation: "spin 1s linear infinite",
                        }}
                      />
                      <span style={{ fontSize: "12px", color: "#7dd3fc" }}>
                        已耗时 32 秒
                      </span>
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      marginBottom: "16px",
                    }}
                  >
                    <ProgressStep state="done" label="读取文件" marker="✓" />
                    <ProgressLine active />
                    <ProgressStep state="done" label="提取文本" marker="✓" />
                    <ProgressLine active />
                    <ProgressStep state="active" label="提交分析" marker="⟳" />
                    <ProgressLine />
                    <ProgressStep state="waiting" label="解析返选" marker="5" />
                    <ProgressLine />
                    <ProgressStep state="waiting" label="完成" marker="6" />
                  </div>

                  <div
                    style={{
                      padding: "16px",
                      background: "rgba(0,0,0,.2)",
                      borderRadius: "6px",
                      marginBottom: "12px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: "8px",
                      }}
                    >
                      <span style={{ fontSize: "12px", color: "#b8c2bd" }}>
                        《穆陵全陪路、我爱是发错鱼成虎吗》20集剧本.docx
                      </span>
                      <span style={{ fontSize: "11px", color: "#7dd3fc" }}>
                        模型 gpt-5.6-luna
                      </span>
                      <span style={{ fontSize: "11px", color: "#9aa5a0" }}>
                        已解析 17460 字
                      </span>
                    </div>
                    <div
                      style={{
                        width: "100%",
                        height: "6px",
                        background: "rgba(255,255,255,.05)",
                        borderRadius: "3px",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: "49%",
                          height: "100%",
                          background: "linear-gradient(90deg, #7dd3fc, #a78bfa)",
                          transition: "width 0.3s ease",
                        }}
                      />
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "flex-end",
                        marginTop: "4px",
                      }}
                    >
                      <span style={{ fontSize: "11px", color: "#7dd3fc" }}>
                        49%
                      </span>
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "10px",
                      padding: "12px",
                      background: "rgba(255,193,7,.05)",
                      border: "1px solid rgba(255,193,7,.25)",
                      borderRadius: "6px",
                    }}
                  >
                    <span style={{ fontSize: "14px", color: "#ffc107" }}>⚠</span>
                    <div>
                      <p
                        style={{
                          margin: "0 0 6px",
                          fontSize: "12px",
                          color: "#eff3ed",
                          fontWeight: 500,
                        }}
                      >
                        分析已配置，来源文件和表格内容已经验，可随时查试
                      </p>
                      <p
                        style={{
                          margin: 0,
                          fontSize: "11px",
                          color: "#9aa5a0",
                          lineHeight: "1.6",
                        }}
                      >
                        来源文件和项目表将已经确，
                      </p>
                    </div>
                    <button
                      style={{
                        marginLeft: "auto",
                        padding: "6px 12px",
                        background: "transparent",
                        border: "1px solid rgba(125,211,252,.3)",
                        color: "#7dd3fc",
                        fontSize: "11px",
                        borderRadius: "4px",
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      ⟳ 重试分析
                    </button>
                  </div>
                </div>
              )}

              <div className="dialog-section">
                <label className="dialog-label">首轮分析要求</label>
                <p className="dialog-hint">
                  控制本次出图序列拆解人物、场景、道具场景必分项所以：不可删除。选择保留的关系分项和不想要的关系分项。
                </p>
                <div className="textarea-wrapper">
                  <textarea
                    rows={6}
                    value={instruction}
                    onChange={event => setInstruction(event.target.value)}
                    maxLength={4000}
                  />
                  <span className="char-count">{instruction.length} / 4000</span>
                </div>
                <div className="quick-tags">
                  <button className="quick-tag">
                    完整覆盖剧本中的人物架构，外观和关系文案前后守恒
                  </button>
                  <button className="quick-tag">
                    不要遗漏剧情道具比，关键房间段落和外观建筑
                  </button>
                  <button className="quick-tag">完整拆解每个非现实空间角色</button>
                </div>
                <div className="dialog-warning">
                  <span>⚠</span>
                  <p>模板或来源文件变化不会覆盖现有项目、批准提示词或已创建批次</p>
                </div>
              </div>

              <TemplateGrid />
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
                    !workbookFile &&
                    document.getElementById("workbook-file-input")?.click()
                  }
                  onDragOver={event => event.preventDefault()}
                  onDrop={event => {
                    event.preventDefault();
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

              <TemplateGrid />
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

              <TemplateGrid compact />
            </>
          )}
        </div>

        <div className="dialog-footer">
          <button className="outline-button" onClick={onClose}>
            取消
          </button>
          <button className="vermilion-button" onClick={onConfirm}>
            {creationMode === "empty" ? "创建空项目" : "解析并预览"}
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

function TemplateGrid({ compact = false }: { compact?: boolean }) {
  const categories = ["人物", "场景", "道具", "UI"];
  return (
    <div className={compact ? "templates-grid" : "dialog-section"}>
      <div className={compact ? undefined : "templates-grid"}>
        {categories.map(category => (
          <div className="template-item" key={category}>
            <label className={compact ? "template-label" : "dialog-label"}>
              {category}分类模板（可选）
            </label>
            {compact ? (
              <div className="template-hint">
                支持《美术风格》、《资产名称》、《资产类别》、《资产设定》、《状态》
              </div>
            ) : (
              <p className="template-hint">
                支持《美术风格》、《资产名称》、《资产类别》、《资产设定》、《状态》
              </p>
            )}
            <textarea rows={4} />
            <button className="template-upload-btn">
              <Upload size={compact ? 16 : 12} /> 载入{category}模板 TXT
              选择文件 未选择任何文件
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProgressStep({
  state,
  label,
  marker,
}: {
  state: "done" | "active" | "waiting";
  label: string;
  marker: string;
}) {
  const active = state === "active";
  const waiting = state === "waiting";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <div
        style={{
          width: "20px",
          height: "20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: active
            ? "#7dd3fc"
            : waiting
              ? "rgba(125,211,252,.05)"
              : "rgba(125,211,252,.15)",
          border: waiting ? "1px solid rgba(125,211,252,.2)" : undefined,
          borderRadius: "50%",
          fontSize: "10px",
          color: active ? "#1a2022" : waiting ? "#6b7671" : "#7dd3fc",
        }}
      >
        {marker}
      </div>
      <span
        style={{
          fontSize: "12px",
          color: active ? "#7dd3fc" : waiting ? "#6b7671" : "#b8c2bd",
        }}
      >
        {label}
      </span>
    </div>
  );
}

function ProgressLine({ active = false }: { active?: boolean }) {
  return (
    <div
      style={{
        width: "40px",
        height: "2px",
        background: active
          ? "rgba(125,211,252,.3)"
          : "rgba(125,211,252,.15)",
      }}
    />
  );
}
