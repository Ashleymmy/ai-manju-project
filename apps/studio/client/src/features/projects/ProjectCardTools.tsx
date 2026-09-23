import { Copy, Image as ImageIcon, Loader2, Pencil, Trash2 } from "lucide-react";

import "./styles.css";

export function ProjectCardTools({
  onCover,
  onRename,
  onDelete,
  onCopy,
  copying = false,
  copyDisabled = false,
}: {
  onCover: () => void;
  onRename: () => void;
  onDelete: () => void;
  onCopy?: () => void;
  copying?: boolean;
  copyDisabled?: boolean;
}) {
  return (
    <div
      className="project-card-tools"
      onClick={event => event.stopPropagation()}
    >
      {onCopy ? <button type="button" title="复制画布" aria-label="复制画布" disabled={copyDisabled || copying} onClick={onCopy}>
        {copying ? <Loader2 size={13} className="spin" /> : <Copy size={13} />}
      </button> : null}
      <button
        type="button"
        title="设置封面"
        aria-label="设置封面"
        onClick={onCover}
      >
        <ImageIcon size={13} />
      </button>
      <button
        type="button"
        title="重命名"
        aria-label="重命名"
        onClick={onRename}
      >
        <Pencil size={13} />
      </button>
      <button type="button" title="删除" aria-label="删除" onClick={onDelete}>
        <Trash2 size={13} />
      </button>
    </div>
  );
}
