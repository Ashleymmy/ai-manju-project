import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  assetQueryKeys,
  deleteSeedanceAsset,
  deleteSeedanceAssetTag,
  getAdminSeedanceAsset,
  getSeedanceAssetReadiness,
  listAdminSeedanceAssets,
  listSeedanceAssetTags,
  pollSeedanceAssets,
  registerSeedanceAssetURL,
  syncSeedanceAssets,
  updateSeedanceAsset,
  uploadSeedanceAsset,
  upsertSeedanceAssetTag,
  type SeedanceAsset,
  type SeedanceAssetList,
  type SeedanceAssetTag,
} from "@/entities/asset";
import { publicApiError } from "@/shared/api/errors";

import {
  buildSeedanceAssetListParams,
  emptySeedanceEditDraft,
  emptySeedanceTagDraft,
  emptySeedanceUploadDraft,
  emptySeedanceUrlDraft,
  isSeedanceTagColor,
  paginateSeedanceAssets,
  seedanceEditDraft,
  SEEDANCE_REFRESH_ATTEMPTS,
  SEEDANCE_REFRESH_DELAY_MS,
  validateSeedanceUploadDraft,
  validateSeedanceUrlDraft,
  type SeedanceAssetFilters,
  type SeedanceEditDialogDraft,
  type SeedanceTagDialogDraft,
  type SeedanceUploadDialogDraft,
  type SeedanceUrlDialogDraft,
} from "../model/seedance";

type SeedanceUrlErrors = {
  source_url?: string;
  name?: string;
  description?: string;
  asset_type?: string;
  tag_ids?: string;
  form?: string;
};

type SeedanceUploadErrors = {
  file?: string;
  name?: string;
  description?: string;
  asset_type?: string;
  tag_ids?: string;
  form?: string;
};

type SeedanceTagErrors = {
  name?: string;
  color?: string;
  form?: string;
};

type SeedanceEditErrors = { name?: string; form?: string };

export function useSeedanceAssetsController() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [tagId, setTagId] = useState("");
  const [appliedFilters, setAppliedFilters] = useState<SeedanceAssetFilters>({});
  const [page, setPage] = useState(1);
  const [listLoading, setListLoading] = useState(false);
  const params = useMemo(
    () => buildSeedanceAssetListParams(appliedFilters),
    [appliedFilters]
  );
  const assetsQuery = useQuery({
    queryKey: assetQueryKeys.seedanceAdmin(params),
    queryFn: () => listAdminSeedanceAssets(params),
    placeholderData: previous => previous,
  });
  const readinessQuery = useQuery({
    queryKey: assetQueryKeys.seedanceReadiness(),
    queryFn: getSeedanceAssetReadiness,
  });
  const tagsQuery = useQuery({
    queryKey: assetQueryKeys.seedanceTags(),
    queryFn: listSeedanceAssetTags,
    placeholderData: previous => previous,
  });
  const assets = assetsQuery.data?.items || [];
  const total =
    assetsQuery.data?.total || assetsQuery.data?.items?.length || 0;
  const tags = tagsQuery.data?.items || [];
  const readiness = readinessQuery.data || null;
  const pageState = useMemo(
    () => paginateSeedanceAssets(assets, page),
    [assets, page]
  );
  const [busy, setBusy] = useState("");

  const [urlDialogOpen, setUrlDialogOpen] = useState(false);
  const [urlDraft, setUrlDraft] =
    useState<SeedanceUrlDialogDraft>(emptySeedanceUrlDraft);
  const [urlErrors, setUrlErrors] = useState<SeedanceUrlErrors>({});
  const [urlBusy, setUrlBusy] = useState(false);

  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadDraft, setUploadDraft] =
    useState<SeedanceUploadDialogDraft>(emptySeedanceUploadDraft);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadErrors, setUploadErrors] = useState<SeedanceUploadErrors>({});
  const [uploadBusy, setUploadBusy] = useState(false);

  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [tagDialogDraft, setTagDialogDraft] =
    useState<SeedanceTagDialogDraft>(emptySeedanceTagDraft);
  const [tagDialogErrors, setTagDialogErrors] =
    useState<SeedanceTagErrors>({});
  const [tagDialogBusy, setTagDialogBusy] = useState(false);
  const [tagDeleteOpen, setTagDeleteOpen] = useState(false);
  const [tagDeleteTarget, setTagDeleteTarget] =
    useState<SeedanceAssetTag | null>(null);
  const [tagDeleteError, setTagDeleteError] = useState("");
  const [tagDeleteBusy, setTagDeleteBusy] = useState(false);

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SeedanceAsset | null>(null);
  const [editDraft, setEditDraft] =
    useState<SeedanceEditDialogDraft>(emptySeedanceEditDraft);
  const [editErrors, setEditErrors] = useState<SeedanceEditErrors>({});
  const [editBusy, setEditBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SeedanceAsset | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);

  const setAssetsForParams = useCallback(
    (
      queryParams: ReturnType<typeof buildSeedanceAssetListParams>,
      result: SeedanceAssetList
    ) => {
      queryClient.setQueryData(
        assetQueryKeys.seedanceAdmin(queryParams),
        result
      );
    },
    [queryClient]
  );

  const loadAssets = useCallback(
    async (
      filters: SeedanceAssetFilters = { search, status, type, tagId }
    ) => {
      const nextParams = buildSeedanceAssetListParams(filters);
      setListLoading(true);
      try {
        const result = await listAdminSeedanceAssets(nextParams);
        setAssetsForParams(nextParams, result);
        setAppliedFilters(filters);
        setPage(1);
      } catch (error) {
        toast.error(publicApiError(error, "读取 Seedance 素材失败"));
      } finally {
        setListLoading(false);
      }
    },
    [search, setAssetsForParams, status, tagId, type]
  );

  const refreshSeedance = useCallback(async () => {
    const [nextReadiness, nextAssets, nextTags] = await Promise.all([
      getSeedanceAssetReadiness(),
      listAdminSeedanceAssets(params),
      listSeedanceAssetTags(),
    ]);
    queryClient.setQueryData(
      assetQueryKeys.seedanceReadiness(),
      nextReadiness
    );
    setAssetsForParams(params, nextAssets);
    queryClient.setQueryData(assetQueryKeys.seedanceTags(), nextTags);
    setPage(1);
  }, [params, queryClient, setAssetsForParams]);

  const refreshAfterMutation = useCallback(
    async (assetId?: string) => {
      try {
        if (assetId) {
          for (
            let attempt = 0;
            attempt < SEEDANCE_REFRESH_ATTEMPTS;
            attempt += 1
          ) {
            try {
              await pollSeedanceAssets();
            } catch {
              // 继续尝试 get / refresh
            }
            try {
              const asset = await getAdminSeedanceAsset(assetId);
              if (asset.status !== "pending") break;
            } catch {
              // 继续重试窗口
            }
            if (attempt < SEEDANCE_REFRESH_ATTEMPTS - 1) {
              await new Promise(resolve =>
                setTimeout(resolve, SEEDANCE_REFRESH_DELAY_MS)
              );
            }
          }
        }
        await refreshSeedance();
      } catch {
        toast.warning("操作已成功但列表刷新失败，请手动刷新");
      }
    },
    [refreshSeedance]
  );

  const syncSeedance = async (mode: "sync" | "poll") => {
    setBusy(`seedance-${mode}`);
    try {
      if (mode === "sync") await syncSeedanceAssets();
      else await pollSeedanceAssets();
      await loadAssets();
      toast.success("Seedance 素材状态已同步");
    } catch (error) {
      toast.error(publicApiError(error, "同步 Seedance 素材失败"));
    } finally {
      setBusy("");
    }
  };

  const openEditDialog = (asset: SeedanceAsset) => {
    if (urlBusy || uploadBusy || editBusy || deleteBusy) return;
    setEditTarget(asset);
    setEditDraft(seedanceEditDraft(asset));
    setEditErrors({});
    setEditDialogOpen(true);
  };

  const closeEditDialog = (force = false) => {
    if (editBusy && !force) return;
    setEditDialogOpen(false);
    setEditTarget(null);
    setEditDraft(emptySeedanceEditDraft());
    setEditErrors({});
  };

  const submitEditDialog = async () => {
    if (editBusy || !editTarget?.id) return;
    if (!editDraft.name.trim()) {
      setEditErrors({ name: "请输入素材名称" });
      return;
    }
    const targetId = editTarget.id;
    const payload = {
      name: editDraft.name.trim(),
      description: editDraft.description.trim(),
      tag_ids: editDraft.tag_ids,
    };
    let mutationSucceeded = false;
    setEditBusy(true);
    setBusy(`seedance-edit-${targetId}`);
    try {
      const saved = await updateSeedanceAsset(targetId, payload);
      queryClient.setQueryData<SeedanceAssetList>(
        assetQueryKeys.seedanceAdmin(params),
        current => ({
          items: (current?.items || []).map(item =>
            item.id === targetId ? saved : item
          ),
          total: current?.total || 0,
        })
      );
      toast.success("Seedance 素材已更新");
      closeEditDialog(true);
      mutationSucceeded = true;
    } catch (error) {
      setEditErrors(current => ({
        ...current,
        form: publicApiError(error, "更新 Seedance 素材失败"),
      }));
    } finally {
      setEditBusy(false);
      setBusy("");
    }
    if (mutationSucceeded) await refreshAfterMutation();
  };

  const openDeleteDialog = (asset: SeedanceAsset) => {
    if (urlBusy || uploadBusy || editBusy || deleteBusy) return;
    setDeleteTarget(asset);
    setDeleteError("");
    setDeleteOpen(true);
  };

  const closeDeleteDialog = (force = false) => {
    if (deleteBusy && !force) return;
    setDeleteOpen(false);
    setDeleteTarget(null);
    setDeleteError("");
  };

  const confirmDelete = async () => {
    if (deleteBusy || !deleteTarget?.id) return;
    const targetId = deleteTarget.id;
    let mutationSucceeded = false;
    setDeleteBusy(true);
    setBusy(`seedance-delete-${targetId}`);
    try {
      await deleteSeedanceAsset(targetId);
      queryClient.setQueryData<SeedanceAssetList>(
        assetQueryKeys.seedanceAdmin(params),
        current => ({
          items: (current?.items || []).filter(item => item.id !== targetId),
          total: current?.total || 0,
        })
      );
      toast.success("Seedance 素材已删除");
      closeDeleteDialog(true);
      mutationSucceeded = true;
    } catch (error) {
      setDeleteError(publicApiError(error, "删除 Seedance 素材失败"));
    } finally {
      setDeleteBusy(false);
      setBusy("");
    }
    if (mutationSucceeded) await refreshAfterMutation();
  };

  const openTagDialog = () => {
    if (busy.startsWith("seedance-") || tagDialogBusy || tagDeleteBusy) return;
    setTagDialogDraft(emptySeedanceTagDraft());
    setTagDialogErrors({});
    setTagDialogOpen(true);
  };

  const closeTagDialog = (force = false) => {
    if (tagDialogBusy && !force) return;
    setTagDialogOpen(false);
    setTagDialogDraft(emptySeedanceTagDraft());
    setTagDialogErrors({});
  };

  const submitTagDialog = async () => {
    if (tagDialogBusy) return;
    const nextErrors: SeedanceTagErrors = {};
    if (!tagDialogDraft.name.trim()) nextErrors.name = "请输入标签名称";
    if (!isSeedanceTagColor(tagDialogDraft.color)) {
      nextErrors.color = "颜色格式需为 #RRGGBB";
    }
    if (Object.keys(nextErrors).length > 0) {
      setTagDialogErrors(nextErrors);
      return;
    }
    let mutationSucceeded = false;
    setTagDialogBusy(true);
    setBusy("seedance-tag-create");
    try {
      const saved = await upsertSeedanceAssetTag({
        name: tagDialogDraft.name.trim(),
        color: tagDialogDraft.color.trim(),
      });
      queryClient.setQueryData<{ items: SeedanceAssetTag[] }>(
        assetQueryKeys.seedanceTags(),
        current => ({
          items: (current?.items || []).some(item => item.id === saved.id)
            ? (current?.items || []).map(item =>
                item.id === saved.id ? saved : item
              )
            : [saved, ...(current?.items || [])],
        })
      );
      toast.success("标签已创建");
      closeTagDialog(true);
      mutationSucceeded = true;
    } catch (error) {
      setTagDialogErrors(current => ({
        ...current,
        form: publicApiError(error, "保存 Seedance 标签失败"),
      }));
    } finally {
      setTagDialogBusy(false);
      setBusy("");
    }
    if (mutationSucceeded) await refreshAfterMutation();
  };

  const openTagDeleteDialog = (tag: SeedanceAssetTag) => {
    if (busy.startsWith("seedance-") || tagDialogBusy || tagDeleteBusy) return;
    setTagDeleteTarget(tag);
    setTagDeleteError("");
    setTagDeleteOpen(true);
  };

  const closeTagDeleteDialog = (force = false) => {
    if (tagDeleteBusy && !force) return;
    setTagDeleteOpen(false);
    setTagDeleteTarget(null);
    setTagDeleteError("");
  };

  const confirmTagDelete = async () => {
    if (tagDeleteBusy || !tagDeleteTarget?.id) return;
    const targetId = tagDeleteTarget.id;
    let mutationSucceeded = false;
    setTagDeleteBusy(true);
    setBusy(`seedance-tag-${targetId}`);
    try {
      await deleteSeedanceAssetTag(targetId);
      queryClient.setQueryData<{ items: SeedanceAssetTag[] }>(
        assetQueryKeys.seedanceTags(),
        current => ({
          items: (current?.items || []).filter(item => item.id !== targetId),
        })
      );
      queryClient.setQueryData<SeedanceAssetList>(
        assetQueryKeys.seedanceAdmin(params),
        current => ({
          items: (current?.items || []).map(asset => ({
            ...asset,
            tags: (asset.tags || []).filter(tag => tag.id !== targetId),
          })),
          total: current?.total || 0,
        })
      );
      toast.success("标签已删除");
      closeTagDeleteDialog(true);
      mutationSucceeded = true;
    } catch (error) {
      setTagDeleteError(publicApiError(error, "删除 Seedance 标签失败"));
    } finally {
      setTagDeleteBusy(false);
      setBusy("");
    }
    if (mutationSucceeded) await refreshAfterMutation();
  };

  const openUrlDialog = () => {
    if (urlBusy || uploadBusy) return;
    setUrlDraft(emptySeedanceUrlDraft());
    setUrlErrors({});
    setUrlDialogOpen(true);
  };

  const closeUrlDialog = (force = false) => {
    if (urlBusy && !force) return;
    setUrlDialogOpen(false);
    setUrlDraft(emptySeedanceUrlDraft());
    setUrlErrors({});
  };

  const submitUrlDialog = async () => {
    if (urlBusy) return;
    const nextErrors = validateSeedanceUrlDraft(urlDraft);
    if (Object.keys(nextErrors).length > 0) {
      setUrlErrors(nextErrors);
      return;
    }
    if (!readiness?.provider_configured) {
      setUrlErrors(current => ({
        ...current,
        form: "当前 Provider 未配置，暂不能注册 URL 资产",
      }));
      return;
    }
    setUrlBusy(true);
    setBusy("seedance-register-url");
    try {
      const asset = await registerSeedanceAssetURL({
        source_url: urlDraft.source_url.trim(),
        name: urlDraft.name.trim() || undefined,
        description: urlDraft.description.trim() || undefined,
        asset_type: urlDraft.asset_type,
        tag_ids: urlDraft.tag_ids,
      });
      toast.success("Seedance URL 资产已注册");
      closeUrlDialog(true);
      await refreshAfterMutation(asset.id);
    } catch (error) {
      setUrlErrors(current => ({
        ...current,
        form: publicApiError(error, "注册 Seedance URL 失败"),
      }));
    } finally {
      setUrlBusy(false);
      setBusy("");
    }
  };

  const openUploadDialog = () => {
    if (urlBusy || uploadBusy) return;
    setUploadDraft(emptySeedanceUploadDraft());
    setUploadFile(null);
    setUploadErrors({});
    setUploadDialogOpen(true);
  };

  const closeUploadDialog = (force = false) => {
    if (uploadBusy && !force) return;
    setUploadDialogOpen(false);
    setUploadDraft(emptySeedanceUploadDraft());
    setUploadFile(null);
    setUploadErrors({});
  };

  const submitUploadDialog = async () => {
    if (uploadBusy) return;
    const nextErrors = validateSeedanceUploadDraft(uploadDraft, uploadFile);
    if (Object.keys(nextErrors).length > 0) {
      setUploadErrors(nextErrors);
      return;
    }
    if (!readiness?.provider_configured) {
      setUploadErrors(current => ({
        ...current,
        form: "当前 Provider 未配置，暂不能上传 Seedance 资产",
      }));
      return;
    }
    if (readiness.upload_registration_available === false) {
      setUploadErrors(current => ({
        ...current,
        form: "当前环境未开放上传注册，请先同步或稍后重试",
      }));
      return;
    }
    if (!uploadFile) return;
    const formData = new FormData();
    formData.append("file", uploadFile);
    formData.append("name", uploadDraft.name.trim() || uploadFile.name);
    formData.append("description", uploadDraft.description.trim());
    formData.append("asset_type", uploadDraft.asset_type);
    formData.append("tag_ids", uploadDraft.tag_ids.join(","));
    setUploadBusy(true);
    setBusy("seedance-upload");
    try {
      const asset = await uploadSeedanceAsset(formData);
      toast.success("Seedance 资产已上传");
      closeUploadDialog(true);
      await refreshAfterMutation(asset.id);
    } catch (error) {
      setUploadErrors(current => ({
        ...current,
        form: publicApiError(error, "上传 Seedance 资产失败"),
      }));
    } finally {
      setUploadBusy(false);
      setBusy("");
    }
  };

  const reload = useCallback(async () => {
    await refreshSeedance();
  }, [refreshSeedance]);

  return {
    assets,
    busy,
    closeDeleteDialog,
    closeEditDialog,
    closeTagDeleteDialog,
    closeTagDialog,
    closeUploadDialog,
    closeUrlDialog,
    confirmDelete,
    confirmTagDelete,
    deleteBusy,
    deleteError,
    deleteOpen,
    deleteTarget,
    editBusy,
    editDialogOpen,
    editDraft,
    editErrors,
    editTarget,
    isPending:
      assetsQuery.isPending || readinessQuery.isPending || tagsQuery.isPending,
    listLoading: listLoading || assetsQuery.isFetching,
    loadAssets,
    openDeleteDialog,
    openEditDialog,
    openTagDeleteDialog,
    openTagDialog,
    openUploadDialog,
    openUrlDialog,
    page,
    pageState,
    readiness,
    reload,
    search,
    setDeleteOpen,
    setEditDialogOpen,
    setEditDraft,
    setEditErrors,
    setPage,
    setSearch,
    setStatus,
    setTagDeleteOpen,
    setTagDialogDraft,
    setTagDialogErrors,
    setTagDialogOpen,
    setTagId,
    setType,
    setUploadDialogOpen,
    setUploadDraft,
    setUploadErrors,
    setUploadFile,
    setUrlDialogOpen,
    setUrlDraft,
    setUrlErrors,
    status,
    submitEditDialog,
    submitTagDialog,
    submitUploadDialog,
    submitUrlDialog,
    syncSeedance,
    tagDeleteBusy,
    tagDeleteError,
    tagDeleteOpen,
    tagDeleteTarget,
    tagDialogBusy,
    tagDialogDraft,
    tagDialogErrors,
    tagDialogOpen,
    tagId,
    tags,
    total,
    type,
    uploadBusy,
    uploadDialogOpen,
    uploadDraft,
    uploadErrors,
    uploadFile,
    urlBusy,
    urlDialogOpen,
    urlDraft,
    urlErrors,
  };
}

export type SeedanceAssetsController = ReturnType<
  typeof useSeedanceAssetsController
>;
