import { FileText, LoaderCircle, X } from "lucide-react";
import type { AgentDocument, AgentDocumentDraft } from "./documents";

export function AgentDocumentStrip({ documents, onRemove }: { documents: (AgentDocument | AgentDocumentDraft)[]; onRemove?: (id: string) => void }) {
  if (!documents.length) return null;
  return <div className="agent-documents" aria-label={onRemove ? "待发送文件" : "消息文件"}>
    {documents.map(file => {
      const status = "status" in file ? file.status : "ready";
      return <div className={`agent-document is-${status}`} key={file.id}>
        {status === "reading" ? <LoaderCircle size={16} className="agent-document-loading" /> : <FileText size={16} />}
        <div className="agent-document-content">
          <details>
            <summary title={file.name}>{file.name}</summary>
            {file.text && <pre>{file.text}</pre>}
          </details>
          <small role={status === "error" ? "alert" : "status"}>{status === "reading" ? "正在读取…" : status === "error" && "error" in file ? file.error : `${file.text?.length.toLocaleString()} 字符`}</small>
        </div>
        {onRemove && <button type="button" title={`移除文件：${file.name}`} aria-label={`移除文件：${file.name}`} onClick={() => onRemove(file.id)}><X size={14} /></button>}
      </div>;
    })}
  </div>;
}
