import { Plus } from "lucide-react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import type {
  AnnouncementDialogDraft,
  AnnouncementsController,
} from "../controllers/useAnnouncementsController";
import { formatTime } from "../model/format";

export function AnnouncementsPanel({
  controller,
}: {
  controller: AnnouncementsController;
}) {
  const {
    announcements,
    busy,
    closeDialog,
    closeRevokeDialog,
    confirmRevoke,
    dialogBusy,
    dialogDraft,
    dialogErrors,
    dialogMode,
    dialogOpen,
    dialogTarget,
    openCreateDialog,
    openEditDialog,
    openRevokeDialog,
    revokeBusy,
    revokeError,
    revokeOpen,
    revokeTarget,
    saveDialog,
    setDialogDraft,
    setDialogOpen,
    setRevokeOpen,
  } = controller;

  return (
    <>
      <section className="real-admin-section">
        <div className="admin-panel-head">
          <div>
            <p className="eyebrow">ANNOUNCEMENTS / {announcements.length}</p>
            <h2>系统公告</h2>
          </div>
          <button
            className="vermilion-button"
            onClick={openCreateDialog}
            disabled={
              dialogBusy || revokeBusy || dialogOpen || revokeOpen
            }
          >
            <Plus size={16} /> 发布公告
          </button>
        </div>
        {announcements.map(item => (
          <article className="announcement-card" key={item.id}>
            <div>
              <span
                className={`status-chip ${
                  item.status === "active" ? "running" : "canceled"
                }`}
              >
                {item.status}
              </span>
              <b>{item.title}</b>
              <p>{item.content}</p>
            </div>
            <aside>
              <small>{formatTime(item.published_at || item.created_at)}</small>
              <button
                onClick={() => openEditDialog(item)}
                disabled={
                  dialogBusy ||
                  revokeBusy ||
                  dialogOpen ||
                  revokeOpen ||
                  busy === `announcement-${item.id}`
                }
              >
                编辑并重发
              </button>
              {item.status === "active" ? (
                <button
                  onClick={() => openRevokeDialog(item)}
                  disabled={
                    dialogBusy ||
                    revokeBusy ||
                    dialogOpen ||
                    revokeOpen ||
                    busy === `announcement-revoke-${item.id}`
                  }
                >
                  撤销
                </button>
              ) : null}
            </aside>
          </article>
        ))}
      </section>

      <Dialog
        open={dialogOpen}
        onOpenChange={nextOpen => {
          if (!nextOpen) {
            if (dialogBusy) return;
            closeDialog();
            return;
          }
          setDialogOpen(true);
        }}
      >
        <DialogContent
          className="sm:max-w-[680px]"
          showCloseButton={!dialogBusy}
          onEscapeKeyDown={event => {
            if (dialogBusy) event.preventDefault();
          }}
          onPointerDownOutside={event => {
            if (dialogBusy) event.preventDefault();
          }}
          onInteractOutside={event => {
            if (dialogBusy) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {dialogMode === "create" ? "发布公告" : "编辑并重新发布"}
            </DialogTitle>
            <DialogDescription>
              {dialogMode === "create"
                ? "创建一条面向普通用户展示的系统公告。"
                : `基于「${dialogTarget?.title || "原公告"}」重新发布，提交会调用 republish 接口。`}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <label className="grid gap-2 text-sm">
              <span>公告类型</span>
              <select
                value={dialogDraft.kind}
                onChange={event =>
                  setDialogDraft(draft => ({
                    ...draft,
                    kind: event.target.value as AnnouncementDialogDraft["kind"],
                  }))
                }
                disabled={dialogBusy}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="update">update</option>
                <option value="maintenance">maintenance</option>
                <option value="notice">notice</option>
              </select>
              {dialogErrors.kind ? (
                <span className="text-sm text-destructive">
                  {dialogErrors.kind}
                </span>
              ) : null}
            </label>

            <label className="grid gap-2 text-sm">
              <span>标题</span>
              <Input
                value={dialogDraft.title}
                onChange={event =>
                  setDialogDraft(draft => ({
                    ...draft,
                    title: event.target.value,
                  }))
                }
                disabled={dialogBusy}
                maxLength={80}
                placeholder="最多 80 个字符"
              />
              <small>{dialogDraft.title.length}/80</small>
              {dialogErrors.title ? (
                <span className="text-sm text-destructive">
                  {dialogErrors.title}
                </span>
              ) : null}
            </label>

            <label className="grid gap-2 text-sm">
              <span>内容</span>
              <Textarea
                value={dialogDraft.content}
                onChange={event =>
                  setDialogDraft(draft => ({
                    ...draft,
                    content: event.target.value,
                  }))
                }
                disabled={dialogBusy}
                maxLength={1000}
                placeholder="最多 1000 个字符"
                rows={6}
              />
              <small>{dialogDraft.content.length}/1000</small>
              {dialogErrors.content ? (
                <span className="text-sm text-destructive">
                  {dialogErrors.content}
                </span>
              ) : null}
            </label>

            {dialogErrors.form ? (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {dialogErrors.form}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <button
              className="outline-button small"
              type="button"
              onClick={() => closeDialog()}
              disabled={dialogBusy}
            >
              取消
            </button>
            <button
              className="vermilion-button"
              type="button"
              onClick={() => void saveDialog()}
              disabled={dialogBusy}
            >
              {dialogBusy
                ? "提交中…"
                : dialogMode === "create"
                  ? "发布公告"
                  : "编辑并重发"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={revokeOpen}
        onOpenChange={nextOpen => {
          if (!nextOpen) {
            if (revokeBusy) return;
            closeRevokeDialog();
            return;
          }
          setRevokeOpen(true);
        }}
      >
        <AlertDialogContent
          onEscapeKeyDown={event => {
            if (revokeBusy) event.preventDefault();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>撤销公告</AlertDialogTitle>
            <AlertDialogDescription>
              {revokeTarget
                ? `确认撤销公告「${revokeTarget.title}」（${revokeTarget.id}）？撤销后普通用户不再看到该公告。`
                : "请选择要撤销的公告。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {revokeError ? (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {revokeError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={revokeBusy}
              onClick={event => {
                if (revokeBusy) event.preventDefault();
                else closeRevokeDialog();
              }}
            >
              取消
            </AlertDialogCancel>
            <button
              className="vermilion-button"
              type="button"
              onClick={() => void confirmRevoke()}
              disabled={revokeBusy || !revokeTarget?.id}
            >
              {revokeBusy ? "撤销中…" : "确认撤销"}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
