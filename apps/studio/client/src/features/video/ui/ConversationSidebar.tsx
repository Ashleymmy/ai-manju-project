import { Film, History, MessageSquarePlus, Pencil, Trash2, Wand2 } from "lucide-react";

import type { VideoWorkbenchConversation } from "../repositories/conversationRepository";

/* 对话式视频工作台左侧栏：对话列表 + 视图切换（生成器/任务历史/工具箱）。 */

export type WorkbenchView = "generator" | "history" | "toolkit";

export function ConversationSidebar({
  conversations,
  currentId,
  view,
  thumbnails,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onViewChange,
}: {
  conversations: VideoWorkbenchConversation[];
  currentId: string;
  view: WorkbenchView;
  /** 对话缩略图（最新成功视频的首帧 Object URL），key = 对话 id */
  thumbnails: Record<string, string>;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (conversation: VideoWorkbenchConversation) => void;
  onDelete: (conversation: VideoWorkbenchConversation) => void;
  onViewChange: (view: WorkbenchView) => void;
}) {
  return (
    <aside className="wb-sidebar">
      <button type="button" className="wb-new-chat" onClick={onCreate}>
        <MessageSquarePlus size={15} /> 新建对话
      </button>
      <div className="wb-conv-list">
        {conversations.map((conversation) => (
          <div
            key={conversation.id}
            role="button"
            tabIndex={0}
            className={`wb-conv-item ${conversation.id === currentId ? "active" : ""}`}
            onClick={() => onSelect(conversation.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(conversation.id);
              }
            }}
          >
            <span className="wb-conv-thumb">
              {thumbnails[conversation.id]
                ? <video src={thumbnails[conversation.id]} muted preload="metadata" />
                : <Film size={15} />}
            </span>
            <span className="wb-conv-copy">
              <b>{conversation.title || "新对话"}</b>
              <small>{new Date(conversation.updatedAt).toLocaleDateString("zh-CN")}</small>
            </span>
            <span className="wb-conv-actions">
              <button
                type="button"
                title="重命名对话"
                onClick={(event) => { event.stopPropagation(); onRename(conversation); }}
              ><Pencil size={12} /></button>
              <button
                type="button"
                title="删除对话"
                onClick={(event) => { event.stopPropagation(); onDelete(conversation); }}
              ><Trash2 size={12} /></button>
            </span>
          </div>
        ))}
        {!conversations.length ? (
          <div className="wb-conv-empty">
            <Film size={22} />
            <p>暂无对话</p>
          </div>
        ) : null}
      </div>
      <nav className="wb-view-nav">
        <button type="button" className={view === "generator" ? "active" : ""} onClick={() => onViewChange("generator")}>
          <Wand2 size={14} /> 生成器
        </button>
        <button type="button" className={view === "history" ? "active" : ""} onClick={() => onViewChange("history")}>
          <History size={14} /> 任务历史
        </button>
        <button type="button" className={view === "toolkit" ? "active" : ""} onClick={() => onViewChange("toolkit")}>
          <Film size={14} /> 工具箱
        </button>
      </nav>
    </aside>
  );
}
