import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import {
  announcementQueryKeys,
  createAdminAnnouncement,
  listAdminAnnouncements,
  republishAdminAnnouncement,
  revokeAdminAnnouncement,
  type SystemAnnouncement,
} from "@/entities/announcement";
import { publicApiError } from "@/shared/api/errors";

export type AnnouncementDialogDraft = {
  title: string;
  content: string;
  kind: SystemAnnouncement["kind"];
};

export type AnnouncementDialogErrors = {
  title?: string;
  content?: string;
  kind?: string;
  form?: string;
};

export const emptyAnnouncementDraft = (): AnnouncementDialogDraft => ({
  title: "",
  content: "",
  kind: "notice",
});

export function validateAnnouncementDraft(draft: AnnouncementDialogDraft) {
  const errors: AnnouncementDialogErrors = {};
  const title = draft.title.trim();
  const content = draft.content.trim();
  if (!title) errors.title = "请输入公告标题";
  if (title.length > 80) errors.title = "标题不能超过 80 个字符";
  if (!content) errors.content = "请输入公告内容";
  if (content.length > 1000) errors.content = "内容不能超过 1000 个字符";
  if (!["update", "maintenance", "notice"].includes(draft.kind)) {
    errors.kind = "请选择公告类型";
  }
  return errors;
}

export function useAnnouncementsController() {
  const queryClient = useQueryClient();
  const announcementsQuery = useQuery({
    queryKey: announcementQueryKeys.adminList(),
    queryFn: listAdminAnnouncements,
    placeholderData: previous => previous,
  });
  const [busy, setBusy] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [dialogDraft, setDialogDraft] = useState<AnnouncementDialogDraft>(
    emptyAnnouncementDraft
  );
  const [dialogErrors, setDialogErrors] =
    useState<AnnouncementDialogErrors>({});
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogTarget, setDialogTarget] =
    useState<SystemAnnouncement | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] =
    useState<SystemAnnouncement | null>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeError, setRevokeError] = useState("");

  const openCreateDialog = () => {
    if (dialogBusy || revokeBusy) return;
    setDialogMode("create");
    setDialogTarget(null);
    setDialogDraft(emptyAnnouncementDraft());
    setDialogErrors({});
    setDialogOpen(true);
  };

  const openEditDialog = (announcement: SystemAnnouncement) => {
    if (dialogBusy || revokeBusy) return;
    setDialogMode("edit");
    setDialogTarget(announcement);
    setDialogDraft({
      title: announcement.title,
      content: announcement.content,
      kind: announcement.kind,
    });
    setDialogErrors({});
    setDialogOpen(true);
  };

  const closeDialog = (force = false) => {
    if (dialogBusy && !force) return;
    setDialogOpen(false);
    setDialogTarget(null);
    setDialogDraft(emptyAnnouncementDraft());
    setDialogErrors({});
  };

  const refreshAfterMutation = async () => {
    try {
      await queryClient.fetchQuery({
        queryKey: announcementQueryKeys.adminList(),
        queryFn: listAdminAnnouncements,
      });
      await queryClient.invalidateQueries({
        queryKey: announcementQueryKeys.current(),
      });
    } catch {
      toast.warning("操作已成功但列表刷新失败，请手动刷新");
    }
  };

  const saveDialog = async () => {
    if (dialogBusy) return;
    const nextErrors = validateAnnouncementDraft(dialogDraft);
    if (Object.keys(nextErrors).length > 0) {
      setDialogErrors(nextErrors);
      return;
    }
    const payload = {
      title: dialogDraft.title.trim(),
      content: dialogDraft.content.trim(),
      kind: dialogDraft.kind,
    } as const;
    let mutationSucceeded = false;
    setDialogBusy(true);
    setBusy(
      dialogMode === "create"
        ? "announcement-create"
        : `announcement-${dialogTarget?.id || "edit"}`
    );
    try {
      if (dialogMode === "create") {
        await createAdminAnnouncement(payload);
      } else if (dialogTarget) {
        await republishAdminAnnouncement(dialogTarget.id, payload);
      }
      toast.success(
        dialogMode === "create" ? "公告已发布" : "公告已重新发布"
      );
      closeDialog(true);
      mutationSucceeded = true;
    } catch (error) {
      setDialogErrors(current => ({
        ...current,
        form: publicApiError(
          error,
          dialogMode === "create" ? "发布公告失败" : "重新发布公告失败"
        ),
      }));
    } finally {
      setDialogBusy(false);
      setBusy("");
    }
    if (mutationSucceeded) await refreshAfterMutation();
  };

  const openRevokeDialog = (announcement: SystemAnnouncement) => {
    if (dialogBusy || revokeBusy || announcement.status !== "active") return;
    setRevokeTarget(announcement);
    setRevokeError("");
    setRevokeOpen(true);
  };

  const closeRevokeDialog = (force = false) => {
    if (revokeBusy && !force) return;
    setRevokeOpen(false);
    setRevokeTarget(null);
    setRevokeError("");
  };

  const confirmRevoke = async () => {
    if (revokeBusy || !revokeTarget?.id) return;
    let mutationSucceeded = false;
    setRevokeBusy(true);
    setBusy(`announcement-revoke-${revokeTarget.id}`);
    try {
      await revokeAdminAnnouncement(revokeTarget.id);
      toast.success("公告已撤销");
      closeRevokeDialog(true);
      mutationSucceeded = true;
    } catch (error) {
      setRevokeError(publicApiError(error, "撤销公告失败"));
    } finally {
      setRevokeBusy(false);
      setBusy("");
    }
    if (mutationSucceeded) await refreshAfterMutation();
  };

  const reload = useCallback(async () => {
    await announcementsQuery.refetch();
  }, [announcementsQuery]);

  return {
    announcements: announcementsQuery.data || [],
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
    isPending: announcementsQuery.isPending,
    openCreateDialog,
    openEditDialog,
    openRevokeDialog,
    reload,
    revokeBusy,
    revokeError,
    revokeOpen,
    revokeTarget,
    saveDialog,
    setDialogDraft,
    setDialogErrors,
    setDialogOpen,
    setRevokeOpen,
  };
}

export type AnnouncementsController = ReturnType<
  typeof useAnnouncementsController
>;
