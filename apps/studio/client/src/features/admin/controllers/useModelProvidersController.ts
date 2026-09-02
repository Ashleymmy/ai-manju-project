import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { publicApiError } from "@/shared/api/errors";

import {
  allConfiguredModelIds,
  applyProviderPreset,
  clearProviderSensitiveInputState,
  emptyProvider,
  imageProtocolModelIds,
} from "../model/provider";
import { adminQueryKeys } from "../model/queryKeys";
import {
  buildModelProviderPayload,
  createModelProvider,
  deleteModelProvider,
  fetchModelProviderModels,
  fetchModelProviderModelsById,
  listModelProviderPresets,
  listModelProviders,
  mergeProviderModels,
  testModelProvider,
  testModelProviderById,
  updateModelProvider,
  type ModelProviderConfig,
  type ModelProviderPreset,
  type ModelProviderTestResult,
} from "../services/adminApi";

export function useModelProvidersController(active: boolean) {
  const queryClient = useQueryClient();
  const providersQuery = useQuery({
    queryKey: adminQueryKeys.providers(),
    queryFn: listModelProviders,
    placeholderData: previous => previous,
  });
  const presetsQuery = useQuery({
    queryKey: adminQueryKeys.providerPresets(),
    queryFn: listModelProviderPresets,
    placeholderData: previous => previous,
  });
  const providers = providersQuery.data || [];
  const presets = presetsQuery.data || [];
  const [providerDraft, setProviderDraft] =
    useState<ModelProviderConfig>(emptyProvider);
  const [apiKey, setApiKey] = useState("");
  const [providerSecrets, setProviderSecrets] = useState<
    Record<string, string>
  >({});
  const [providerTestResult, setProviderTestResult] =
    useState<ModelProviderTestResult | null>(null);
  const [providerTestConfirmOpen, setProviderTestConfirmOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const wasActive = useRef(active);

  const clearSensitiveInputs = useCallback(() => {
    clearProviderSensitiveInputState(
      setApiKey,
      setProviderSecrets,
      setProviderTestResult
    );
  }, []);

  useEffect(() => {
    if (!providersQuery.data) return;
    setProviderDraft(current =>
      providersQuery.data.find(item => item.id === current.id) ||
      providersQuery.data[0] ||
      emptyProvider
    );
    clearSensitiveInputs();
  }, [clearSensitiveInputs, providersQuery.data]);

  useEffect(() => {
    if (wasActive.current && !active) clearSensitiveInputs();
    wasActive.current = active;
  }, [active, clearSensitiveInputs]);

  const activeProvider = useMemo(
    () => providers.find(provider => provider.id === providerDraft.id),
    [providerDraft.id, providers]
  );
  const selectedPreset = useMemo(
    () => presets.find(preset => preset.id === providerDraft.preset_id),
    [presets, providerDraft.preset_id]
  );
  const configuredModelIds = useMemo(
    () => allConfiguredModelIds(providerDraft),
    [providerDraft]
  );
  const protocolModelIds = useMemo(
    () => imageProtocolModelIds(providerDraft),
    [providerDraft]
  );

  const selectProvider = (provider: ModelProviderConfig) => {
    setProviderDraft(provider);
    clearSensitiveInputs();
  };

  const createProviderDraft = (source: ModelProviderConfig = emptyProvider) => {
    setProviderDraft({
      ...source,
      id: "",
      name:
        source === emptyProvider
          ? "新 Provider"
          : `${source.name || "Provider"} 副本`,
      api_key_configured: false,
      api_key_set: false,
      secrets_set: {},
      models_by_capability: { ...(source.models_by_capability || {}) },
      model_aliases: { ...(source.model_aliases || {}) },
      model_protocols: { ...(source.model_protocols || {}) },
      endpoint_overrides: { ...(source.endpoint_overrides || {}) },
      extra_headers: { ...(source.extra_headers || {}) },
    });
    clearSensitiveInputs();
  };

  const changePreset = (id: string) => {
    setProviderDraft(draft => applyProviderPreset(id, presets, draft));
    clearSensitiveInputs();
  };

  const saveProvider = async () => {
    if (!(providerDraft.name || "").trim()) {
      toast.error("请填写 Provider 名称");
      return;
    }
    if (!(providerDraft.base_url || "").trim()) {
      toast.error("请填写 Base URL");
      return;
    }
    setBusy("provider-save");
    try {
      const payload = buildModelProviderPayload(providerDraft, {
        apiKey,
        secrets: providerSecrets,
      });
      const saved = activeProvider?.id
        ? await updateModelProvider(activeProvider.id, payload)
        : await createModelProvider(payload);
      clearSensitiveInputs();
      toast.success("Provider 已保存");
      queryClient.setQueryData<ModelProviderConfig[]>(
        adminQueryKeys.providers(),
        items => {
          const current = items || [];
          return current.some(item => item.id === saved.id)
            ? current.map(item => (item.id === saved.id ? saved : item))
            : [saved, ...current];
        }
      );
      setProviderDraft(saved);
    } catch (error) {
      toast.error(publicApiError(error, "保存 Provider 失败"));
    } finally {
      setBusy("");
    }
  };

  const runProviderTest = async () => {
    setProviderTestConfirmOpen(false);
    setBusy("provider-test");
    setProviderTestResult(null);
    try {
      const payload = buildModelProviderPayload(providerDraft, {
        apiKey,
        secrets: providerSecrets,
      });
      const result = activeProvider?.id
        ? await testModelProviderById(activeProvider.id, payload)
        : await testModelProvider(payload);
      setProviderTestResult(result);
      if (result.ok) {
        toast.success(result.text || result.message || "连接测试通过");
      } else {
        toast.error(result.error || result.message || "连接测试未通过");
      }
    } catch (error) {
      toast.error(publicApiError(error, "Provider 测试失败"));
    } finally {
      setBusy("");
    }
  };

  const testProvider = () => {
    if ((providerDraft.capabilities || []).includes("text")) {
      setProviderTestConfirmOpen(true);
      return;
    }
    void runProviderTest();
  };

  const fetchModels = async () => {
    setBusy("provider-models");
    try {
      const payload = buildModelProviderPayload(providerDraft, {
        apiKey,
        secrets: providerSecrets,
      });
      const result = activeProvider?.id
        ? await fetchModelProviderModelsById(activeProvider.id, payload)
        : await fetchModelProviderModels(payload);
      setProviderDraft(draft => mergeProviderModels(draft, result));
      toast.success("模型列表已拉取");
    } catch (error) {
      toast.error(publicApiError(error, "拉取模型列表失败"));
    } finally {
      setBusy("");
    }
  };

  const openDeleteDialog = () => {
    if (!activeProvider?.id || activeProvider.id === "default") {
      toast.warning("默认 Provider 不可删除");
      return;
    }
    setDeleteTarget({
      id: activeProvider.id,
      name: activeProvider.name || activeProvider.id,
    });
    setDeleteError("");
    setDeleteOpen(true);
  };

  const closeDeleteDialog = () => {
    if (deleteBusy) return;
    setDeleteOpen(false);
    setDeleteTarget(null);
    setDeleteError("");
  };

  const confirmDelete = async () => {
    if (deleteBusy || !deleteTarget?.id) return;
    setDeleteBusy(true);
    setBusy("provider-delete");
    try {
      await deleteModelProvider(deleteTarget.id);
      queryClient.setQueryData<ModelProviderConfig[]>(
        adminQueryKeys.providers(),
        items => {
          const next = (items || []).filter(item => item.id !== deleteTarget.id);
          setProviderDraft(next[0] || emptyProvider);
          return next;
        }
      );
      clearSensitiveInputs();
      toast.success("Provider 已删除");
      setDeleteOpen(false);
      setDeleteTarget(null);
      setDeleteError("");
    } catch (error) {
      setDeleteError(publicApiError(error, "删除 Provider 失败"));
    } finally {
      setDeleteBusy(false);
      setBusy("");
    }
  };

  const reload = useCallback(async () => {
    await Promise.allSettled([providersQuery.refetch(), presetsQuery.refetch()]);
  }, [presetsQuery, providersQuery]);

  return {
    activeProvider,
    apiKey,
    busy,
    changePreset,
    configuredModelIds,
    confirmDelete,
    createProviderDraft,
    deleteBusy,
    deleteError,
    deleteOpen,
    deleteTarget,
    fetchModels,
    isPending: providersQuery.isPending || presetsQuery.isPending,
    openDeleteDialog,
    closeDeleteDialog,
    presets,
    protocolModelIds,
    providerDraft,
    providers,
    providerSecrets,
    providerTestConfirmOpen,
    providerTestResult,
    reload,
    runProviderTest,
    saveProvider,
    selectProvider,
    selectedPreset,
    setApiKey,
    setDeleteOpen,
    setProviderDraft,
    setProviderSecrets,
    setProviderTestConfirmOpen,
    testProvider,
  };
}

export type ModelProvidersController = ReturnType<
  typeof useModelProvidersController
>;
