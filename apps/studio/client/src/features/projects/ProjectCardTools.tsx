import { Image as ImageIcon, Pencil, Trash2 } from "lucide-react";

import "./styles.css";

export function ProjectCardTools({
  onCover,
  onRename,
  onDelete,
}: {
  onCover: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="project-card-tools"
      onClick={event => event.stopPropagation()}
    >
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
