import { useQuery } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { publicApiError } from "@/shared/api/errors";

import {
  createAdjustNonce,
  type AdminMemberUser,
} from "../model/memberAdmin";
import { adminQueryKeys } from "../model/queryKeys";
import {
  adjustMemberUserCredits,
  listAdminMemberUsers,
  resetMemberUserInviteCode,
} from "../services/adminMemberApi";

export type AdjustCreditsDraft = {
  /** 有符号整数字符串（正增负减），提交时转 number。 */
  delta: string;
  reason: string;
};

export type AdjustCreditsErrors = { delta?: string; reason?: string; form?: string };

/**
 * 模块1 会员用户列表控制器。
 * 契约缺口：后端 /admin/member-users 暂无会员等级/账号状态查询参数，
 * 两个筛选为当前页内过滤（已记录在 memberAdmin.ts 头注释）。
 */
export function useMemberUsersController(active: boolean) {
  const [page, setPage] = useState(1);
  const [memberLevel, setMemberLevel] = useState("");
  const [status, setStatus] = useState("");
	const [search, setSearch] = useState("");
	const [appliedSearch, setAppliedSearch] = useState("");
	const adjustmentAttempt = useRef<{ fingerprint: string; nonce: string } | null>(null);

  const listQuery = useQuery({
    queryKey: [...adminQueryKeys.memberUsers(page), memberLevel, status, appliedSearch],
    queryFn: () => listAdminMemberUsers(page, undefined, { search: appliedSearch, level: memberLevel, status }),
    placeholderData: previous => previous,
    enabled: active,
  });

  const [adjustTarget, setAdjustTarget] = useState<AdminMemberUser | null>(null);
  const [adjustDraft, setAdjustDraft] = useState<AdjustCreditsDraft>({ delta: "", reason: "" });
  const [adjustErrors, setAdjustErrors] = useState<AdjustCreditsErrors>({});
  const [adjustBusy, setAdjustBusy] = useState(false);

  const [resetTarget, setResetTarget] = useState<AdminMemberUser | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState("");

  const rows = listQuery.data?.items || [];

  const total = listQuery.data?.total ?? 0;
  const pageSize = listQuery.data?.page_size ?? 20;
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));

  const openAdjustDialog = (user: AdminMemberUser) => {
    if (adjustBusy) return;
    setAdjustTarget(user);
    setAdjustDraft({ delta: "", reason: "" });
    setAdjustErrors({});
    adjustmentAttempt.current = null;
  };

  const closeAdjustDialog = (force = false) => {
    if (adjustBusy && !force) return;
    setAdjustTarget(null);
    setAdjustDraft({ delta: "", reason: "" });
    setAdjustErrors({});
  };

  /** 调积分提交：nonce 每次提交自动生成（UUID 幂等键）。 */
  const submitAdjust = async () => {
    if (adjustBusy || !adjustTarget) return;
    const nextErrors: AdjustCreditsErrors = {};
    const delta = Number(adjustDraft.delta.trim());
    if (!adjustDraft.delta.trim() || !Number.isInteger(delta) || delta === 0) {
      nextErrors.delta = "请输入非 0 的整数（正数调增，负数调减）";
    }
    if (Object.keys(nextErrors).length > 0) {
      setAdjustErrors(nextErrors);
      return;
    }
    setAdjustBusy(true);
    try {
		const fingerprint = JSON.stringify([adjustTarget.user_id, delta, adjustDraft.reason.trim()]);
		if (adjustmentAttempt.current?.fingerprint !== fingerprint) adjustmentAttempt.current = { fingerprint, nonce: createAdjustNonce() };
      await adjustMemberUserCredits(adjustTarget.user_id, {
        delta,
        reason: adjustDraft.reason.trim(),
        nonce: adjustmentAttempt.current.nonce,
      });
      toast.success(`已为用户 ${adjustTarget.username} 调整积分 ${delta > 0 ? "+" : ""}${delta}`);
      closeAdjustDialog(true);
      await listQuery.refetch();
    } catch (error) {
      setAdjustErrors(current => ({ ...current, form: publicApiError(error, "调整积分失败") }));
    } finally {
      setAdjustBusy(false);
    }
  };

  const openResetDialog = (user: AdminMemberUser) => {
    if (resetBusy) return;
    setResetTarget(user);
    setResetError("");
  };

  const closeResetDialog = (force = false) => {
    if (resetBusy && !force) return;
    setResetTarget(null);
    setResetError("");
  };

  /** 重置邀请码：确认后调用，成功后 toast 展示新 code。 */
  const confirmResetInvite = async () => {
    if (resetBusy || !resetTarget) return;
    setResetBusy(true);
    try {
      const result = await resetMemberUserInviteCode(resetTarget.user_id);
      toast.success(`邀请码已重置：${result.invite_code}`);
      closeResetDialog(true);
      await listQuery.refetch();
    } catch (error) {
      setResetError(publicApiError(error, "重置邀请码失败"));
    } finally {
      setResetBusy(false);
    }
  };

  const reload = useCallback(async () => {
    if (!active) return;
    await listQuery.refetch();
  }, [active, listQuery]);

  return {
    adjustBusy,
    adjustDraft,
    adjustErrors,
    adjustTarget,
    closeAdjustDialog,
    closeResetDialog,
    confirmResetInvite,
    isError: active && listQuery.isError,
    isPending: active && listQuery.isPending,
    memberLevel,
    openAdjustDialog,
    openResetDialog,
    page,
    reload,
    resetBusy,
    resetError,
    resetTarget,
    rows,
    setAdjustDraft,
    setMemberLevel: (value: string) => { setMemberLevel(value); setPage(1); },
    setPage,
    setStatus: (value: string) => { setStatus(value); setPage(1); },
	search, setSearch,
	applySearch: () => { setAppliedSearch(search.trim()); setPage(1); },
    status,
    submitAdjust,
    total,
    totalPages,
  };
}

export type MemberUsersController = ReturnType<typeof useMemberUsersController>;
