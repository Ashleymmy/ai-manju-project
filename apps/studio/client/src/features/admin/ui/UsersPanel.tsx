import { Plus, UserCog } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import type {
  AdminUsersController,
  UserDialogDraft,
} from "../controllers/useAdminUsersController";
import { formatTime } from "../model/format";
import type { AdminUser } from "../services/adminApi";

export function UsersPanel({
  controller,
}: {
  controller: AdminUsersController;
}) {
  const {
    busy,
    closeDialog,
    dialogBusy,
    dialogDraft,
    dialogErrors,
    dialogMode,
    dialogOpen,
    openCreateDialog,
    openEditDialog,
    saveDialog,
    setDialogDraft,
    setDialogOpen,
    users,
  } = controller;

  return (
    <>
      <section className="real-admin-section">
        <div className="admin-panel-head">
          <div>
            <p className="eyebrow">IDENTITY / {users.length}</p>
            <h2>用户与权限</h2>
          </div>
          <button
            className="vermilion-button"
            onClick={openCreateDialog}
            disabled={dialogBusy}
          >
            <Plus size={16} /> 创建用户
          </button>
        </div>
        <div className="admin-table">
          <div className="admin-table-head">
            <span>用户</span>
            <span>角色</span>
            <span>状态</span>
            <span>更新时间</span>
            <span />
          </div>
          {users.map(user => (
            <div className="admin-table-row" key={user.id}>
              <span>
                <i>{user.username.slice(0, 1).toUpperCase()}</i>
                <b>{user.display_name || user.username}</b>
              </span>
              <span>
                <code>{user.role}</code>
              </span>
              <span>
                <em
                  className={user.status === "active" ? "active" : "suspended"}
                >
                  {user.status}
                </em>
              </span>
              <span>{formatTime(user.updated_at || user.created_at)}</span>
              <button
                onClick={() => openEditDialog(user)}
                disabled={dialogBusy || busy === `user-${user.id}`}
                title="编辑用户"
              >
                <UserCog size={15} />
              </button>
            </div>
          ))}
        </div>
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
          className="sm:max-w-[640px]"
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
              {dialogMode === "create" ? "创建用户" : "编辑用户"}
            </DialogTitle>
            <DialogDescription>
              {dialogMode === "create"
                ? "填写用户名、密码、角色与状态后创建新用户。"
                : "用户名只读，密码留空则保持不变。"}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <label className="grid gap-2 text-sm">
              <span>用户名</span>
              <Input
                value={dialogDraft.username}
                onChange={event =>
                  setDialogDraft(draft => ({
                    ...draft,
                    username: event.target.value,
                  }))
                }
                disabled={dialogBusy}
                readOnly={dialogMode === "edit"}
                placeholder="username"
              />
              {dialogErrors.username ? (
                <span className="text-sm text-destructive">
                  {dialogErrors.username}
                </span>
              ) : null}
            </label>

            <label className="grid gap-2 text-sm">
              <span>显示名称</span>
              <Input
                value={dialogDraft.display_name}
                onChange={event =>
                  setDialogDraft(draft => ({
                    ...draft,
                    display_name: event.target.value,
                  }))
                }
                disabled={dialogBusy}
                placeholder="可选"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm">
                <span>角色</span>
                <select
                  value={dialogDraft.role}
                  onChange={event =>
                    setDialogDraft(draft => ({
                      ...draft,
                      role: event.target.value as AdminUser["role"],
                    }))
                  }
                  disabled={dialogBusy}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="member">member</option>
                  <option value="super_admin">super_admin</option>
                </select>
              </label>

              <label className="grid gap-2 text-sm">
                <span>状态</span>
                <select
                  value={dialogDraft.status}
                  onChange={event =>
                    setDialogDraft(draft => ({
                      ...draft,
                      status: event.target.value as UserDialogDraft["status"],
                    }))
                  }
                  disabled={dialogBusy}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="active">active</option>
                  <option value="disabled">disabled</option>
                </select>
              </label>
            </div>

            <label className="grid gap-2 text-sm">
              <span>密码</span>
              <Input
                type="password"
                value={dialogDraft.password}
                onChange={event =>
                  setDialogDraft(draft => ({
                    ...draft,
                    password: event.target.value,
                  }))
                }
                disabled={dialogBusy}
                placeholder={
                  dialogMode === "create" ? "必填，至少 8 位" : "留空表示不修改"
                }
              />
              {dialogErrors.password ? (
                <span className="text-sm text-destructive">
                  {dialogErrors.password}
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
                ? "保存中…"
                : dialogMode === "create"
                  ? "创建用户"
                  : "保存修改"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
