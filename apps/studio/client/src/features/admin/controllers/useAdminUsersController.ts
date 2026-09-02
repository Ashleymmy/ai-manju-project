import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { publicApiError } from "@/shared/api/errors";

import { adminQueryKeys } from "../model/queryKeys";
import {
  createAdminUser,
  listAdminUsers,
  updateAdminUser,
  type AdminUser,
  type AdminUserPayload,
} from "../services/adminApi";

export type UserDialogDraft = {
  username: string;
  display_name: string;
  role: AdminUser["role"];
  status: "active" | "disabled";
  password: string;
};

export type UserDialogErrors = {
  username?: string;
  password?: string;
  form?: string;
};

export const emptyUserDraft = (): UserDialogDraft => ({
  username: "",
  display_name: "",
  role: "member",
  status: "active",
  password: "",
});

export function useAdminUsersController() {
  const queryClient = useQueryClient();
  const usersQuery = useQuery({
    queryKey: adminQueryKeys.users(),
    queryFn: listAdminUsers,
    placeholderData: previous => previous,
  });
  const [busy, setBusy] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [dialogDraft, setDialogDraft] = useState<UserDialogDraft>(
    emptyUserDraft
  );
  const [dialogErrors, setDialogErrors] = useState<UserDialogErrors>({});
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogTargetId, setDialogTargetId] = useState("");

  const openCreateDialog = () => {
    if (dialogBusy) return;
    setDialogMode("create");
    setDialogTargetId("");
    setDialogDraft(emptyUserDraft());
    setDialogErrors({});
    setDialogOpen(true);
  };

  const openEditDialog = (user: AdminUser) => {
    if (dialogBusy) return;
    setDialogMode("edit");
    setDialogTargetId(user.id);
    setDialogDraft({
      username: user.username,
      display_name: user.display_name || "",
      role: user.role,
      status: user.status === "disabled" ? "disabled" : "active",
      password: "",
    });
    setDialogErrors({});
    setDialogOpen(true);
  };

  const closeDialog = (force = false) => {
    if (dialogBusy && !force) return;
    setDialogOpen(false);
    setDialogErrors({});
    setDialogDraft(emptyUserDraft());
    setDialogTargetId("");
  };

  const saveDialog = async () => {
    if (dialogBusy) return;
    const username = dialogDraft.username.trim();
    const displayName = dialogDraft.display_name.trim();
    const password = dialogDraft.password.trim();
    const nextErrors: UserDialogErrors = {};
    if (dialogMode === "create" && !username) {
      nextErrors.username = "请输入用户名";
    }
    if (dialogMode === "create" && !password) {
      nextErrors.password = "请输入初始密码";
    }
    if (password && password.length < 8) {
      nextErrors.password = "密码至少 8 个字符";
    }
    if (Object.keys(nextErrors).length > 0) {
      setDialogErrors(nextErrors);
      return;
    }

    setDialogBusy(true);
    setBusy(
      dialogMode === "create"
        ? "user-create"
        : `user-${dialogTargetId || username}`
    );
    try {
      const payload: AdminUserPayload | Partial<AdminUserPayload> =
        dialogMode === "create"
          ? {
              username,
              display_name: displayName || undefined,
              role: dialogDraft.role,
              status: dialogDraft.status,
              password,
            }
          : {
              display_name: displayName || undefined,
              role: dialogDraft.role,
              status: dialogDraft.status,
              ...(password ? { password } : {}),
            };
      const saved =
        dialogMode === "create"
          ? await createAdminUser(payload as AdminUserPayload)
          : await updateAdminUser(
              dialogTargetId,
              payload as Partial<AdminUserPayload>
            );
      queryClient.setQueryData<AdminUser[]>(adminQueryKeys.users(), items => {
        const current = items || [];
        return dialogMode === "create"
          ? [saved, ...current]
          : current.map(item => (item.id === saved.id ? saved : item));
      });
      toast.success(dialogMode === "create" ? "用户已创建" : "用户已更新");
      closeDialog(true);
    } catch (error) {
      setDialogErrors(current => ({
        ...current,
        form: publicApiError(
          error,
          dialogMode === "create" ? "创建用户失败" : "更新用户失败"
        ),
      }));
    } finally {
      setDialogBusy(false);
      setBusy("");
    }
  };

  const reload = useCallback(async () => {
    await usersQuery.refetch();
  }, [usersQuery]);

  return {
    busy,
    closeDialog,
    dialogBusy,
    dialogDraft,
    dialogErrors,
    dialogMode,
    dialogOpen,
    isPending: usersQuery.isPending,
    openCreateDialog,
    openEditDialog,
    reload,
    saveDialog,
    setDialogDraft,
    setDialogErrors,
    setDialogOpen,
    users: usersQuery.data || [],
  };
}

export type AdminUsersController = ReturnType<typeof useAdminUsersController>;
