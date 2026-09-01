import { Film, RotateCcw } from "lucide-react";

import type { VideoWorkbenchConversation, VideoWorkbenchMessage } from "@/services/video-conversations";

/* 任务历史视图：汇总所有对话里的任务卡，可跳回对话或重试。 */

export function HistoryPanel({
  conversations,
  onOpenConversation,
  onRetry,
}: {
  conversations: VideoWorkbenchConversation[];
  onOpenConversation: (conversationId: string) => void;
  onRetry: (conversationId: string, message: VideoWorkbenchMessage) => void;
}) {
  const tasks = conversations
    .flatMap((conversation) => conversation.messages
      .filter((message) => message.role === "system" && message.taskId)
      .map((message) => ({ conversation, message })))
    .sort((left, right) => right.message.createdAt - left.message.createdAt);

  return (
    <div className="wb-history">
      <div className="wb-history-head">
        <b>任务记录 {tasks.length}</b>
        <span>全部对话的生成任务按时间汇总</span>
      </div>
      <div className="wb-history-list">
        {tasks.map(({ conversation, message }) => (
          <div key={message.id} className="wb-history-row">
            <span className={`wb-history-status ${message.taskStatus || "queued"}`}>{statusLabel(message.taskStatus)}</span>
            <div className="wb-history-copy">
              <b>{message.text || "视频生成任务"}</b>
              <span>{conversation.title} · {message.model || "未知模型"} · {new Date(message.createdAt).toLocaleString("zh-CN")}</span>
            </div>
            <button type="button" className="outline-button small" onClick={() => onOpenConversation(conversation.id)}>
              <Film size={13} /> 打开对话
            </button>
            {message.taskStatus === "failed" || message.taskStatus === "canceled" ? (
              <button type="button" className="outline-button small" onClick={() => onRetry(conversation.id, message)}>
                <RotateCcw size={13} /> 重试
              </button>
            ) : null}
          </div>
        ))}
        {!tasks.length ? (
          <div className="wb-picker-empty"><Film size={22} /><p>暂无视频任务记录</p></div>
        ) : null}
      </div>
    </div>
  );
}

function statusLabel(status?: string) {
  if (status === "succeeded") return "成功";
  if (status === "failed") return "失败";
  if (status === "canceled") return "已取消";
  if (status === "running") return "运行中";
  return "排队中";
}
