import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import {
  EMPTY_LEDGER_DRAFT,
  LEDGER_USER_SEARCH_DELAY_MS,
  LEDGER_USER_SEARCH_PAGE_SIZE,
  resolveLedgerFilters,
  type LedgerFilterDraft,
} from "../model/ledgerFilters";
import {
  ADMIN_LIST_PAGE_SIZE,
  type AdminMemberUser,
} from "../model/memberAdmin";
import { adminQueryKeys } from "../model/queryKeys";
import {
  listAdminLedger,
  listAdminMemberUsers,
} from "../services/adminMemberApi";

export function useCreditLedgerController(active: boolean) {
  const [draft, setDraft] = useState(EMPTY_LEDGER_DRAFT);
  const [applied, setApplied] = useState(EMPTY_LEDGER_DRAFT);
  const [resolved, setResolved] = useState(() =>
    resolveLedgerFilters(EMPTY_LEDGER_DRAFT)
  );
  const [userSearch, setUserSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [validationError, setValidationError] = useState("");
  const [page, setPage] = useState(1);
  const [knownUsers, setKnownUsers] = useState<Record<string, AdminMemberUser>>(
    {}
  );

  useEffect(() => {
    const timer = setTimeout(
      () => setDebouncedSearch(userSearch.trim()),
      LEDGER_USER_SEARCH_DELAY_MS
    );
    return () => clearTimeout(timer);
  }, [userSearch]);

  const userQuery = useQuery({
    queryKey: ["admin", "ledger-user-search", debouncedSearch],
    queryFn: () =>
      listAdminMemberUsers(1, LEDGER_USER_SEARCH_PAGE_SIZE, {
        search: debouncedSearch || undefined,
      }),
    enabled: active,
  });
  const searchingUsers =
    userSearch.trim() !== debouncedSearch || userQuery.isFetching;
  useEffect(() => {
    if (!userQuery.data || userQuery.isError) return;
    setKnownUsers(previous => ({
      ...previous,
      ...Object.fromEntries(
        userQuery.data.items.map(user => [user.user_id, user])
      ),
    }));
  }, [userQuery.data, userQuery.isError]);
  const userOptions = useMemo(() => {
    const found =
      userSearch.trim() === debouncedSearch && !userQuery.isError
        ? userQuery.data?.items || []
        : [];
    return draft.user &&
      !found.some(user => user.user_id === draft.user?.user_id)
      ? [draft.user, ...found]
      : found;
  }, [
    draft.user,
    userSearch,
    debouncedSearch,
    userQuery.data,
    userQuery.isError,
  ]);

  const filters = { ...resolved.filters, page };
  const listQuery = useQuery({
    queryKey: adminQueryKeys.billingLedger(filters),
    queryFn: () => listAdminLedger(filters),
    placeholderData: previous => previous,
    enabled: active,
  });

  // Never present the previous filter's rows/statistics as the current result.
  const isPending =
    active && (listQuery.isPending || listQuery.isPlaceholderData);
  const items =
    isPending || listQuery.isError ? [] : listQuery.data?.items || [];
  // Missing server totals must not silently fall back to this page's amounts.
  const ledgerStats =
    isPending || listQuery.isError ? null : listQuery.data?.summary ?? null;
  const total =
    isPending || listQuery.isError ? 0 : (listQuery.data?.total ?? 0);
  const pageSize = listQuery.data?.page_size ?? ADMIN_LIST_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));

  const updateDraft = (patch: Partial<LedgerFilterDraft>) => {
    setDraft(previous => ({ ...previous, ...patch }));
    setValidationError("");
  };
  const searchUsers = (value: string) => {
    setUserSearch(value);
    updateDraft({ user: null });
  };
  const selectUser = (id: string) => {
    updateDraft({
      user: userOptions.find(user => user.user_id === id) || null,
    });
    if (!id) setUserSearch("");
  };
  const applyFilters = () => {
    if (userSearch.trim() && !draft.user) {
      setValidationError("请从匹配用户中选择一位，或清空搜索以查询全部用户");
      return;
    }
    const next = resolveLedgerFilters(draft);
    if (next.error) {
      setValidationError(next.error);
      return;
    }
    setValidationError("");
    setApplied(draft);
    setResolved(next);
    setPage(1);
    if (
      page === 1 &&
      JSON.stringify(next.filters) === JSON.stringify(resolved.filters) &&
      active
    ) {
      void listQuery.refetch();
    }
  };
  const resetFilters = () => {
    setDraft(EMPTY_LEDGER_DRAFT);
    setApplied(EMPTY_LEDGER_DRAFT);
    setResolved(resolveLedgerFilters(EMPTY_LEDGER_DRAFT));
    setUserSearch("");
    setDebouncedSearch("");
    setValidationError("");
    setPage(1);
  };

  return {
    draft,
    updateDraft,
    userSearch,
    searchUsers,
    selectUser,
    userOptions,
    knownUsers,
    searchingUsers,
    userSearchFailed:
      userQuery.isError && userSearch.trim() === debouncedSearch,
    userSearchTotal: userQuery.data?.total ?? 0,
    retryUserSearch: () => void userQuery.refetch(),
    appliedUser: applied.user,
    appliedSummary: resolved.summary || [],
    hasUnappliedChanges:
      JSON.stringify(draft) !== JSON.stringify(applied) ||
      Boolean(userSearch.trim() && !draft.user),
    validationError,
    applyFilters,
    resetFilters,
    isError: active && listQuery.isError,
    isPending,
    isFetching: active && listQuery.isFetching,
    items,
    ledgerStats,
    page,
    setPage,
    total,
    totalPages,
    reload: () => {
      if (active) void listQuery.refetch();
    },
  };
}

export type CreditLedgerController = ReturnType<
  typeof useCreditLedgerController
>;
