import {
  Activity,
  Bell,
  Check,
  ChevronLeft,
  ChevronRight,
  CopyPlus,
  Database,
  Hash,
  KeyRound,
  Loader2,
  Plus,
  RefreshCcw,
  Save,
  Search,
  ServerCog,
  ShieldCheck,
  Trash2,
  TestTube2,
  UserCog,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
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
import {
  buildModelProviderPayload,
  createAdminAnnouncement,
  createAdminUser,
  createModelProvider,
  deleteModelProvider,
  deleteSeedanceAsset,
  deleteSeedanceAssetTag,
  fetchAdminMonitoring,
  fetchModelProviderModels,
  fetchModelProviderModelsById,
  getSeedanceAssetReadiness,
  getAdminSeedanceAsset,
  listAdminAnnouncements,
  listAdminSeedanceAssets,
  listAdminUsers,
  listModelProviderPresets,
  listModelProviders,
  listSeedanceAssetTags,
  mergeProviderModels,
  pollSeedanceAssets,
  publicApiError,
  registerSeedanceAssetURL,
  republishAdminAnnouncement,
  revokeAdminAnnouncement,
  syncSeedanceAssets,
  testModelProvider,
  testModelProviderById,
  updateSeedanceAsset,
  updateAdminUser,
  updateModelProvider,
  uploadSeedanceAsset,
  upsertSeedanceAssetTag,
  type AdminMonitoringData,
  type AdminUser,
  type ImageGenerationProtocol,
  type ModelCapability,
  type ModelProviderConfig,
  type ModelProviderPreset,
  type ModelProviderTestResult,
  type SeedanceAsset,
  type SeedanceAssetReadiness,
  type SeedanceAssetTag,
  type SystemAnnouncement,
} from "@/services/api";

type AdminTab = "users" | "providers" | "announcements" | "monitoring" | "seedance";

type SeedanceAssetFilters = {
  search?: string;
  status?: string;
  type?: string;
  tagId?: string;
};

const seedanceFetchLimit = 100;
const seedancePageSize = 10;

export function buildSeedanceAssetListParams(filters: SeedanceAssetFilters = {}) {
  const search = filters.search?.trim();
  return {
    ...(search ? { search } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.tagId ? { tag_id: filters.tagId } : {}),
    limit: seedanceFetchLimit,
  };
}

export function paginateSeedanceAssets<T>(items: readonly T[], page: number, pageSize = seedancePageSize) {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), pageCount);
  const start = (currentPage - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), page: currentPage, pageCount };
}

const adminTabPaths: Record<AdminTab, string> = {
  users: "/admin/users",
  providers: "/admin/model-provider",
  announcements: "/admin/announcements",
  monitoring: "/admin",
  seedance: "/admin/seedance-assets",
};

export function adminTabFromLocation(pathname: string, hash: string): AdminTab {
  if (pathname === "/admin/users") return "users";
  if (pathname === "/admin/model-provider") return "providers";
  if (pathname === "/admin/announcements") return "announcements";
  if (pathname === "/admin/seedance-assets") return "seedance";
  if (hash === "#monitoring" || pathname === "/admin") return "monitoring";
  return "monitoring";
}

export function clearProviderSensitiveInputState(
  setApiKey: Dispatch<SetStateAction<string>>,
  setProviderSecrets: Dispatch<SetStateAction<Record<string, string>>>,
  setProviderTestResult: Dispatch<SetStateAction<ModelProviderTestResult | null>>,
) {
  setApiKey("");
  setProviderSecrets({});
  setProviderTestResult(null);
}

const capabilityOptions: Array<{ value: ModelCapability; label: string }> = [
  { value: "text", label: "文本" },
  { value: "image", label: "图像" },
  { value: "video", label: "视频" },
  { value: "audio", label: "音频" },
];

const imageProtocolOptions: Array<{ value: ImageGenerationProtocol; label: string }> = [
  { value: "auto", label: "自动识别" },
  { value: "openai_images", label: "OpenAI Images" },
  { value: "openai_responses", label: "OpenAI Responses" },
  { value: "openai_chat_completions", label: "OpenAI Chat Completions" },
  { value: "gemini_generate_content", label: "Gemini generateContent" },
  { value: "dashscope_multimodal", label: "DashScope Multimodal" },
  { value: "stability_image", label: "Stability Image" },
];

const emptyProvider: ModelProviderConfig = {
  id: "",
  name: "新 Provider",
  preset_id: "",
  provider_type: "openai_compatible",
  mode: "openai_compatible",
  base_url: "",
  auth_type: "bearer",
  text_model: "",
  image_model: "",
  video_model: "",
  audio_model: "",
  capabilities: ["text", "image"],
  models_by_capability: {},
  model_aliases: {},
  model_protocols: {},
  default_for: [],
  endpoint_overrides: {},
  extra_headers: {},
  timeout_ms: 120_000,
  max_concurrency: 3,
  enabled: true,
};

type UserDialogDraft = {
  username: string;
  display_name: string;
  role: AdminUser["role"];
  status: "active" | "disabled";
  password: string;
};

const emptyUserDraft = (): UserDialogDraft => ({
  username: "",
  display_name: "",
  role: "member",
  status: "active",
  password: "",
});

type AnnouncementDialogDraft = {
  title: string;
  content: string;
  kind: SystemAnnouncement["kind"];
};

const emptyAnnouncementDraft = (): AnnouncementDialogDraft => ({
  title: "",
  content: "",
  kind: "notice",
});

type SeedanceUrlDialogDraft = {
  source_url: string;
  name: string;
  description: string;
  asset_type: "Image" | "Video";
  tag_ids: string[];
};

type SeedanceUploadDialogDraft = {
  name: string;
  description: string;
  asset_type: "Image" | "Video";
  tag_ids: string[];
};

const emptySeedanceUrlDraft = (): SeedanceUrlDialogDraft => ({
  source_url: "",
  name: "",
  description: "",
  asset_type: "Image",
  tag_ids: [],
});

const emptySeedanceUploadDraft = (): SeedanceUploadDialogDraft => ({
  name: "",
  description: "",
  asset_type: "Image",
  tag_ids: [],
});

type SeedanceTagDialogDraft = {
  name: string;
  color: string;
};

const seedanceTagDefaultColor = "#7dd3fc";

const emptySeedanceTagDraft = (): SeedanceTagDialogDraft => ({
  name: "",
  color: seedanceTagDefaultColor,
});

function isSeedanceTagColor(value: string) {
  return /^#[0-9a-f]{6}$/i.test(value.trim());
}

type SeedanceEditDialogDraft = {
  name: string;
  description: string;
  tag_ids: string[];
};

const emptySeedanceEditDraft = (): SeedanceEditDialogDraft => ({
  name: "",
  description: "",
  tag_ids: [],
});

function splitModels(value: string) {
  return value
    .split(/[\n,，;；]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinModels(values: string[] = []) {
  return values.join("\n");
}

function normalizeAliasMap(value: Record<string, string> = {}) {
  return Object.fromEntries(
    Object.entries(value)
      .map(([model, alias]) => [model.trim(), alias.trim()])
      .filter(([model, alias]) => model && alias),
  );
}

function allConfiguredModelIds(config: ModelProviderConfig) {
  return Array.from(new Set([
    ...Object.values(config.models_by_capability || {}).flatMap((models) => models || []),
    config.text_model || "",
    config.image_model || "",
    config.video_model || "",
    config.audio_model || "",
    ...Object.keys(config.model_aliases || {}),
    ...Object.keys(config.model_protocols || {}),
  ].map((item) => item.trim()).filter(Boolean)));
}

function imageProtocolModelIds(config: ModelProviderConfig) {
  return Array.from(new Set([
    ...(config.models_by_capability?.image || []),
    config.image_model || "",
    ...Object.keys(config.model_protocols || {}),
  ].map((item) => item.trim()).filter(Boolean)));
}

export default function AdminWorkspaceView() {
  const [location, navigate] = useLocation();
  const [hash, setHash] = useState(() => window.location.hash);
  const [tab, setTab] = useState<AdminTab>(() => adminTabFromLocation(location.split("?")[0], window.location.hash));
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [providers, setProviders] = useState<ModelProviderConfig[]>([]);
  const [presets, setPresets] = useState<ModelProviderPreset[]>([]);
  const [providerDraft, setProviderDraft] = useState<ModelProviderConfig>(emptyProvider);
  const [apiKey, setApiKey] = useState("");
  const [providerSecrets, setProviderSecrets] = useState<Record<string, string>>({});
  const [providerTestResult, setProviderTestResult] = useState<ModelProviderTestResult | null>(null);
  const [providerTestConfirmOpen, setProviderTestConfirmOpen] = useState(false);
  const [announcements, setAnnouncements] = useState<SystemAnnouncement[]>([]);
  const [monitoring, setMonitoring] = useState<AdminMonitoringData | null>(null);
  const [monitoringHours, setMonitoringHours] = useState(24);
  const [monitoringRefreshing, setMonitoringRefreshing] = useState(false);
  const [seedanceAssets, setSeedanceAssets] = useState<SeedanceAsset[]>([]);
  const [seedanceTotal, setSeedanceTotal] = useState(0);
  const [seedanceSearch, setSeedanceSearch] = useState("");
  const [seedanceStatus, setSeedanceStatus] = useState("");
  const [seedanceType, setSeedanceType] = useState("");
  const [seedanceTagId, setSeedanceTagId] = useState("");
  const [seedancePage, setSeedancePage] = useState(1);
  const [seedanceListLoading, setSeedanceListLoading] = useState(false);
  const [seedanceReadiness, setSeedanceReadiness] = useState<SeedanceAssetReadiness | null>(null);
  const [seedanceTags, setSeedanceTags] = useState<SeedanceAssetTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [userDialogMode, setUserDialogMode] = useState<"create" | "edit">("create");
  const [userDialogDraft, setUserDialogDraft] = useState<UserDialogDraft>(emptyUserDraft);
  const [userDialogErrors, setUserDialogErrors] = useState<{ username?: string; password?: string; form?: string }>({});
  const [userDialogBusy, setUserDialogBusy] = useState(false);
  const [userDialogTargetId, setUserDialogTargetId] = useState("");
  const [providerDeleteOpen, setProviderDeleteOpen] = useState(false);
  const [providerDeleteTarget, setProviderDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [providerDeleteBusy, setProviderDeleteBusy] = useState(false);
  const [providerDeleteError, setProviderDeleteError] = useState("");
  const [announcementDialogOpen, setAnnouncementDialogOpen] = useState(false);
  const [announcementDialogMode, setAnnouncementDialogMode] = useState<"create" | "edit">("create");
  const [announcementDialogDraft, setAnnouncementDialogDraft] = useState<AnnouncementDialogDraft>(emptyAnnouncementDraft);
  const [announcementDialogErrors, setAnnouncementDialogErrors] = useState<{ title?: string; content?: string; kind?: string; form?: string }>({});
  const [announcementDialogBusy, setAnnouncementDialogBusy] = useState(false);
  const [announcementDialogTarget, setAnnouncementDialogTarget] = useState<SystemAnnouncement | null>(null);
  const [announcementRevokeOpen, setAnnouncementRevokeOpen] = useState(false);
  const [announcementRevokeTarget, setAnnouncementRevokeTarget] = useState<SystemAnnouncement | null>(null);
  const [announcementRevokeBusy, setAnnouncementRevokeBusy] = useState(false);
  const [announcementRevokeError, setAnnouncementRevokeError] = useState("");
  const [seedanceUrlDialogOpen, setSeedanceUrlDialogOpen] = useState(false);
  const [seedanceUrlDraft, setSeedanceUrlDraft] = useState<SeedanceUrlDialogDraft>(emptySeedanceUrlDraft);
  const [seedanceUrlErrors, setSeedanceUrlErrors] = useState<{ source_url?: string; name?: string; description?: string; asset_type?: string; tag_ids?: string; form?: string }>({});
  const [seedanceUrlBusy, setSeedanceUrlBusy] = useState(false);
  const [seedanceUploadDialogOpen, setSeedanceUploadDialogOpen] = useState(false);
  const [seedanceUploadDraft, setSeedanceUploadDraft] = useState<SeedanceUploadDialogDraft>(emptySeedanceUploadDraft);
  const [seedanceUploadFile, setSeedanceUploadFile] = useState<File | null>(null);
  const [seedanceUploadErrors, setSeedanceUploadErrors] = useState<{ file?: string; name?: string; description?: string; asset_type?: string; tag_ids?: string; form?: string }>({});
  const [seedanceUploadBusy, setSeedanceUploadBusy] = useState(false);
  const [seedanceTagDialogOpen, setSeedanceTagDialogOpen] = useState(false);
  const [seedanceTagDialogDraft, setSeedanceTagDialogDraft] = useState<SeedanceTagDialogDraft>(emptySeedanceTagDraft);
  const [seedanceTagDialogErrors, setSeedanceTagDialogErrors] = useState<{ name?: string; color?: string; form?: string }>({});
  const [seedanceTagDialogBusy, setSeedanceTagDialogBusy] = useState(false);
  const [seedanceTagDeleteOpen, setSeedanceTagDeleteOpen] = useState(false);
  const [seedanceTagDeleteTarget, setSeedanceTagDeleteTarget] = useState<SeedanceAssetTag | null>(null);
  const [seedanceTagDeleteError, setSeedanceTagDeleteError] = useState("");
  const [seedanceTagDeleteBusy, setSeedanceTagDeleteBusy] = useState(false);
  const [seedanceEditDialogOpen, setSeedanceEditDialogOpen] = useState(false);
  const [seedanceEditTarget, setSeedanceEditTarget] = useState<SeedanceAsset | null>(null);
  const [seedanceEditDraft, setSeedanceEditDraft] = useState<SeedanceEditDialogDraft>(emptySeedanceEditDraft);
  const [seedanceEditErrors, setSeedanceEditErrors] = useState<{ name?: string; form?: string }>({});
  const [seedanceEditBusy, setSeedanceEditBusy] = useState(false);
  const [seedanceDeleteOpen, setSeedanceDeleteOpen] = useState(false);
  const [seedanceDeleteTarget, setSeedanceDeleteTarget] = useState<SeedanceAsset | null>(null);
  const [seedanceDeleteError, setSeedanceDeleteError] = useState("");
  const [seedanceDeleteBusy, setSeedanceDeleteBusy] = useState(false);

  const activeProvider = useMemo(() => providers.find((provider) => provider.id === providerDraft.id), [providerDraft.id, providers]);
  const selectedPreset = useMemo(() => presets.find((preset) => preset.id === providerDraft.preset_id), [presets, providerDraft.preset_id]);
  const configuredModelIds = useMemo(() => allConfiguredModelIds(providerDraft), [providerDraft]);
  const protocolModelIds = useMemo(() => imageProtocolModelIds(providerDraft), [providerDraft]);
  const monitoringSummary = monitoring?.summary;
  const monitoringSuccessRate = monitoringSummary?.total_requests ? (monitoringSummary.success_requests / monitoringSummary.total_requests) * 100 : 100;
  const monitoringErrorRate = monitoringSummary?.total_requests ? (monitoringSummary.error_requests / monitoringSummary.total_requests) * 100 : 0;
  const monitoringAverageDuration = monitoringSummary?.total_requests ? monitoringSummary.total_duration_ms / monitoringSummary.total_requests : 0;
  const latestMonitoringErrors = useMemo(() => (monitoring?.recent || []).filter((item) => item.status === "error").slice(0, 6), [monitoring]);
  const seedancePageState = useMemo(() => paginateSeedanceAssets(seedanceAssets, seedancePage), [seedanceAssets, seedancePage]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [userList, providerList, presetList, announcementList, monitoringData, seedanceList, readiness, tagList] = await Promise.allSettled([
        listAdminUsers(),
        listModelProviders(),
        listModelProviderPresets(),
        listAdminAnnouncements(),
        fetchAdminMonitoring(24),
        listAdminSeedanceAssets(buildSeedanceAssetListParams()),
        getSeedanceAssetReadiness(),
        listSeedanceAssetTags(),
      ]);
      if (userList.status === "fulfilled") setUsers(userList.value);
      if (providerList.status === "fulfilled") {
        setProviders(providerList.value);
        setProviderDraft((current) => providerList.value.find((item) => item.id === current.id) || providerList.value[0] || emptyProvider);
        setApiKey("");
        setProviderSecrets({});
        setProviderTestResult(null);
      }
      if (presetList.status === "fulfilled") setPresets(presetList.value);
      if (announcementList.status === "fulfilled") setAnnouncements(announcementList.value);
      if (monitoringData.status === "fulfilled") setMonitoring(monitoringData.value);
      if (seedanceList.status === "fulfilled") {
        setSeedanceAssets(seedanceList.value.items || []);
        setSeedanceTotal(seedanceList.value.total || seedanceList.value.items?.length || 0);
      }
      if (readiness.status === "fulfilled") setSeedanceReadiness(readiness.value);
      if (tagList.status === "fulfilled") setSeedanceTags(tagList.value.items || []);
    } catch (error) {
      toast.error(publicApiError(error, "读取管理后台数据失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMonitoring = useCallback(async (hours: number, silent = false) => {
    if (silent) setMonitoringRefreshing(true);
    try {
      setMonitoring(await fetchAdminMonitoring(hours));
    } catch (error) {
      if (!silent) toast.error(publicApiError(error, "监控数据加载失败"));
    } finally {
      if (silent) setMonitoringRefreshing(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    const handleHashChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    setTab(adminTabFromLocation(location.split("?")[0], hash));
  }, [location, hash]);

  useEffect(() => {
    if (tab !== "monitoring") return;
    void loadMonitoring(monitoringHours, true);
    const tick = () => {
      if (document.visibilityState === "visible") void loadMonitoring(monitoringHours, true);
    };
    const timer = window.setInterval(tick, 15_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [loadMonitoring, monitoringHours, tab]);

  const loadSeedanceAssets = async (filters: SeedanceAssetFilters = {
    search: seedanceSearch,
    status: seedanceStatus,
    type: seedanceType,
    tagId: seedanceTagId,
  }) => {
    setSeedanceListLoading(true);
    try {
      const result = await listAdminSeedanceAssets(buildSeedanceAssetListParams(filters));
      setSeedanceAssets(result.items || []);
      setSeedanceTotal(result.total || result.items?.length || 0);
      setSeedancePage(1);
    } catch (error) {
      toast.error(publicApiError(error, "读取 Seedance 素材失败"));
    } finally {
      setSeedanceListLoading(false);
    }
  };

  const openCreateUserDialog = () => {
    if (userDialogBusy) return;
    setUserDialogMode("create");
    setUserDialogTargetId("");
    setUserDialogDraft(emptyUserDraft());
    setUserDialogErrors({});
    setUserDialogOpen(true);
  };

  const openEditUserDialog = (user: AdminUser) => {
    if (userDialogBusy) return;
    setUserDialogMode("edit");
    setUserDialogTargetId(user.id);
    setUserDialogDraft({
      username: user.username,
      display_name: user.display_name || "",
      role: user.role,
      status: user.status === "disabled" ? "disabled" : "active",
      password: "",
    });
    setUserDialogErrors({});
    setUserDialogOpen(true);
  };

  const closeUserDialog = (force = false) => {
    if (userDialogBusy && !force) return;
    setUserDialogOpen(false);
    setUserDialogErrors({});
    setUserDialogDraft(emptyUserDraft());
    setUserDialogTargetId("");
  };

  const saveUserDialog = async () => {
    if (userDialogBusy) return;
    const username = userDialogDraft.username.trim();
    const displayName = userDialogDraft.display_name.trim();
    const password = userDialogDraft.password.trim();
    const nextErrors: { username?: string; password?: string; form?: string } = {};
    if (userDialogMode === "create" && !username) nextErrors.username = "请输入用户名";
    if (userDialogMode === "create" && !password) nextErrors.password = "请输入初始密码";
    if (password && password.length < 8) nextErrors.password = "密码至少 8 个字符";
    if (Object.keys(nextErrors).length > 0) {
      setUserDialogErrors(nextErrors);
      return;
    }
    setUserDialogBusy(true);
    setBusy(userDialogMode === "create" ? "user-create" : `user-${userDialogTargetId || username}`);
    try {
      const payload: Parameters<typeof createAdminUser>[0] | Parameters<typeof updateAdminUser>[1] = userDialogMode === "create"
        ? {
          username,
          display_name: displayName || undefined,
          role: userDialogDraft.role,
          status: userDialogDraft.status,
          password,
        }
        : {
          display_name: displayName || undefined,
          role: userDialogDraft.role,
          status: userDialogDraft.status,
          ...(password ? { password } : {}),
        };
      const saved = userDialogMode === "create"
        ? await createAdminUser(payload as Parameters<typeof createAdminUser>[0])
        : await updateAdminUser(userDialogTargetId, payload as Parameters<typeof updateAdminUser>[1]);
      if (userDialogMode === "create") {
        setUsers((items) => [saved, ...items]);
      } else {
        setUsers((items) => items.map((item) => item.id === saved.id ? saved : item));
      }
      toast.success(userDialogMode === "create" ? "用户已创建" : "用户已更新");
      closeUserDialog(true);
    } catch (error) {
      setUserDialogErrors((current) => ({ ...current, form: publicApiError(error, userDialogMode === "create" ? "创建用户失败" : "更新用户失败") }));
    } finally {
      setUserDialogBusy(false);
      setBusy("");
    }
  };

  const clearProviderSensitiveInputs = () => {
    clearProviderSensitiveInputState(setApiKey, setProviderSecrets, setProviderTestResult);
  };

  const selectProvider = (provider: ModelProviderConfig) => {
    setProviderDraft(provider);
    clearProviderSensitiveInputs();
  };

  const createProviderDraft = (source: ModelProviderConfig = emptyProvider) => {
    setProviderDraft({
      ...source,
      id: "",
      name: source === emptyProvider ? "新 Provider" : `${source.name || "Provider"} 副本`,
      api_key_configured: false,
      api_key_set: false,
      secrets_set: {},
      models_by_capability: { ...(source.models_by_capability || {}) },
      model_aliases: { ...(source.model_aliases || {}) },
      model_protocols: { ...(source.model_protocols || {}) },
      endpoint_overrides: { ...(source.endpoint_overrides || {}) },
      extra_headers: { ...(source.extra_headers || {}) },
    });
    clearProviderSensitiveInputs();
  };

  const saveProvider = async () => {
    if (!(providerDraft.name || "").trim()) return toast.error("请填写 Provider 名称");
    if (!(providerDraft.base_url || "").trim()) return toast.error("请填写 Base URL");
    setBusy("provider-save");
    try {
      const payload = buildModelProviderPayload(providerDraft, { apiKey, secrets: providerSecrets });
      const saved = activeProvider?.id ? await updateModelProvider(activeProvider.id, payload) : await createModelProvider(payload);
      clearProviderSensitiveInputs();
      toast.success("Provider 已保存");
      setProviders((items) => {
        const exists = items.some((item) => item.id === saved.id);
        return exists ? items.map((item) => item.id === saved.id ? saved : item) : [saved, ...items];
      });
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
      const payload = buildModelProviderPayload(providerDraft, { apiKey, secrets: providerSecrets });
      const result = activeProvider?.id
        ? await testModelProviderById(activeProvider.id, payload)
        : await testModelProvider(payload);
      setProviderTestResult(result);
      if (result.ok) toast.success(result.text || result.message || "连接测试通过");
      else toast.error(result.error || result.message || "连接测试未通过");
    } catch (error) {
      toast.error(publicApiError(error, "Provider 测试失败"));
    } finally {
      setBusy("");
    }
  };

  const fetchModels = async () => {
    setBusy("provider-models");
    try {
      const payload = buildModelProviderPayload(providerDraft, { apiKey, secrets: providerSecrets });
      const result = activeProvider?.id
        ? await fetchModelProviderModelsById(activeProvider.id, payload)
        : await fetchModelProviderModels(payload);
      setProviderDraft((draft) => mergeProviderModels(draft, result));
      toast.success("模型列表已拉取");
    } catch (error) {
      toast.error(publicApiError(error, "拉取模型列表失败"));
    } finally {
      setBusy("");
    }
  };

  const openProviderDeleteDialog = () => {
    if (!activeProvider?.id || activeProvider.id === "default") return toast.warning("默认 Provider 不可删除");
    setProviderDeleteTarget({ id: activeProvider.id, name: activeProvider.name || activeProvider.id });
    setProviderDeleteError("");
    setProviderDeleteOpen(true);
  };

  const closeProviderDeleteDialog = () => {
    if (providerDeleteBusy) return;
    setProviderDeleteOpen(false);
    setProviderDeleteTarget(null);
    setProviderDeleteError("");
  };

  const confirmProviderDelete = async () => {
    if (providerDeleteBusy) return;
    if (!providerDeleteTarget?.id) return;
    setProviderDeleteBusy(true);
    setBusy("provider-delete");
    try {
      await deleteModelProvider(providerDeleteTarget.id);
      setProviders((items) => {
        const next = items.filter((item) => item.id !== providerDeleteTarget.id);
        setProviderDraft(next[0] || emptyProvider);
        return next;
      });
      clearProviderSensitiveInputs();
      toast.success("Provider 已删除");
      setProviderDeleteOpen(false);
      setProviderDeleteTarget(null);
      setProviderDeleteError("");
    } catch (error) {
      setProviderDeleteError(publicApiError(error, "删除 Provider 失败"));
    } finally {
      setProviderDeleteBusy(false);
      setBusy("");
    }
  };

  const openCreateAnnouncementDialog = () => {
    if (announcementDialogBusy || announcementRevokeBusy) return;
    setAnnouncementDialogMode("create");
    setAnnouncementDialogTarget(null);
    setAnnouncementDialogDraft(emptyAnnouncementDraft());
    setAnnouncementDialogErrors({});
    setAnnouncementDialogOpen(true);
  };

  const openEditAnnouncementDialog = (announcement: SystemAnnouncement) => {
    if (announcementDialogBusy || announcementRevokeBusy) return;
    setAnnouncementDialogMode("edit");
    setAnnouncementDialogTarget(announcement);
    setAnnouncementDialogDraft({
      title: announcement.title,
      content: announcement.content,
      kind: announcement.kind,
    });
    setAnnouncementDialogErrors({});
    setAnnouncementDialogOpen(true);
  };

  const closeAnnouncementDialog = (force = false) => {
    if (announcementDialogBusy && !force) return;
    setAnnouncementDialogOpen(false);
    setAnnouncementDialogTarget(null);
    setAnnouncementDialogDraft(emptyAnnouncementDraft());
    setAnnouncementDialogErrors({});
  };

  const validateAnnouncementDraft = () => {
    const nextErrors: { title?: string; content?: string; kind?: string; form?: string } = {};
    const title = announcementDialogDraft.title.trim();
    const content = announcementDialogDraft.content.trim();
    if (!title) nextErrors.title = "请输入公告标题";
    if (title.length > 80) nextErrors.title = "标题不能超过 80 个字符";
    if (!content) nextErrors.content = "请输入公告内容";
    if (content.length > 1000) nextErrors.content = "内容不能超过 1000 个字符";
    if (!["update", "maintenance", "notice"].includes(announcementDialogDraft.kind)) nextErrors.kind = "请选择公告类型";
    return nextErrors;
  };

  const refreshAnnouncementsAfterMutation = async () => {
    try {
      const nextAnnouncements = await listAdminAnnouncements();
      setAnnouncements(nextAnnouncements);
    } catch {
      toast.warning("操作已成功但列表刷新失败，请手动刷新");
    }
  };

  const saveAnnouncementDialog = async () => {
    if (announcementDialogBusy) return;
    const nextErrors = validateAnnouncementDraft();
    if (Object.keys(nextErrors).length > 0) {
      setAnnouncementDialogErrors(nextErrors);
      return;
    }
    const payload = {
      title: announcementDialogDraft.title.trim(),
      content: announcementDialogDraft.content.trim(),
      kind: announcementDialogDraft.kind,
    } as const;
    let mutationSucceeded = false;
    setAnnouncementDialogBusy(true);
    setBusy(announcementDialogMode === "create" ? "announcement-create" : `announcement-${announcementDialogTarget?.id || "edit"}`);
    try {
      if (announcementDialogMode === "create") {
        await createAdminAnnouncement(payload);
      } else if (announcementDialogTarget) {
        await republishAdminAnnouncement(announcementDialogTarget.id, payload);
      }
      toast.success(announcementDialogMode === "create" ? "公告已发布" : "公告已重新发布");
      closeAnnouncementDialog(true);
      mutationSucceeded = true;
    } catch (error) {
      setAnnouncementDialogErrors((current) => ({ ...current, form: publicApiError(error, announcementDialogMode === "create" ? "发布公告失败" : "重新发布公告失败") }));
    } finally {
      setAnnouncementDialogBusy(false);
      setBusy("");
    }
    if (mutationSucceeded) {
      await refreshAnnouncementsAfterMutation();
    }
  };

  const openRevokeAnnouncementDialog = (announcement: SystemAnnouncement) => {
    if (announcementDialogBusy || announcementRevokeBusy) return;
    if (announcement.status !== "active") return;
    setAnnouncementRevokeTarget(announcement);
    setAnnouncementRevokeError("");
    setAnnouncementRevokeOpen(true);
  };

  const closeRevokeAnnouncementDialog = (force = false) => {
    if (announcementRevokeBusy && !force) return;
    setAnnouncementRevokeOpen(false);
    setAnnouncementRevokeTarget(null);
    setAnnouncementRevokeError("");
  };

  const confirmAnnouncementRevoke = async () => {
    if (announcementRevokeBusy) return;
    if (!announcementRevokeTarget?.id) return;
    let mutationSucceeded = false;
    setAnnouncementRevokeBusy(true);
    setBusy(`announcement-revoke-${announcementRevokeTarget.id}`);
    try {
      await revokeAdminAnnouncement(announcementRevokeTarget.id);
      toast.success("公告已撤销");
      closeRevokeAnnouncementDialog(true);
      mutationSucceeded = true;
    } catch (error) {
      setAnnouncementRevokeError(publicApiError(error, "撤销公告失败"));
    } finally {
      setAnnouncementRevokeBusy(false);
      setBusy("");
    }
    if (mutationSucceeded) {
      await refreshAnnouncementsAfterMutation();
    }
  };

  const syncSeedance = async (mode: "sync" | "poll") => {
    setBusy(`seedance-${mode}`);
    try {
      if (mode === "sync") await syncSeedanceAssets();
      else await pollSeedanceAssets();
      await loadSeedanceAssets();
      toast.success("Seedance 素材状态已同步");
    } catch (error) {
      toast.error(publicApiError(error, "同步 Seedance 素材失败"));
    } finally {
      setBusy("");
    }
  };

  const refreshSeedance = async () => {
    const [readiness, assets, tags] = await Promise.all([
      getSeedanceAssetReadiness(),
      listAdminSeedanceAssets(buildSeedanceAssetListParams({ search: seedanceSearch, status: seedanceStatus, type: seedanceType, tagId: seedanceTagId })),
      listSeedanceAssetTags(),
    ]);
    setSeedanceReadiness(readiness);
    setSeedanceAssets(assets.items || []);
    setSeedanceTotal(assets.total || assets.items?.length || 0);
    setSeedancePage(1);
    setSeedanceTags(tags.items || []);
  };

  const openEditSeedanceAssetDialog = (asset: SeedanceAsset) => {
    if (seedanceUrlBusy || seedanceUploadBusy || seedanceEditBusy || seedanceDeleteBusy) return;
    setSeedanceEditTarget(asset);
    setSeedanceEditDraft({
      name: asset.name,
      description: asset.description || "",
      tag_ids: (asset.tags || []).map((tag) => tag.id),
    });
    setSeedanceEditErrors({});
    setSeedanceEditDialogOpen(true);
  };

  const closeEditSeedanceAssetDialog = (force = false) => {
    if (seedanceEditBusy && !force) return;
    setSeedanceEditDialogOpen(false);
    setSeedanceEditTarget(null);
    setSeedanceEditDraft(emptySeedanceEditDraft());
    setSeedanceEditErrors({});
  };

  const validateSeedanceEditDraft = () => {
    const nextErrors: { name?: string; form?: string } = {};
    if (!seedanceEditDraft.name.trim()) nextErrors.name = "请输入素材名称";
    return nextErrors;
  };

  const submitSeedanceEditDialog = async () => {
    if (seedanceEditBusy) return;
    if (!seedanceEditTarget?.id) return;
    const nextErrors = validateSeedanceEditDraft();
    if (Object.keys(nextErrors).length > 0) {
      setSeedanceEditErrors(nextErrors);
      return;
    }
    const targetId = seedanceEditTarget.id;
    const payload = {
      name: seedanceEditDraft.name.trim(),
      description: seedanceEditDraft.description.trim(),
      tag_ids: seedanceEditDraft.tag_ids,
    };
    let mutationSucceeded = false;
    setSeedanceEditBusy(true);
    setBusy(`seedance-edit-${targetId}`);
    try {
      const saved = await updateSeedanceAsset(targetId, payload);
      setSeedanceAssets((items) => items.map((item) => item.id === targetId ? saved : item));
      toast.success("Seedance 素材已更新");
      closeEditSeedanceAssetDialog(true);
      mutationSucceeded = true;
    } catch (error) {
      setSeedanceEditErrors((current) => ({ ...current, form: publicApiError(error, "更新 Seedance 素材失败") }));
    } finally {
      setSeedanceEditBusy(false);
      setBusy("");
    }
    if (mutationSucceeded) {
      await refreshSeedanceAfterMutation();
    }
  };

  const openRemoveSeedanceAssetDialog = (asset: SeedanceAsset) => {
    if (seedanceUrlBusy || seedanceUploadBusy || seedanceEditBusy || seedanceDeleteBusy) return;
    setSeedanceDeleteTarget(asset);
    setSeedanceDeleteError("");
    setSeedanceDeleteOpen(true);
  };

  const closeRemoveSeedanceAssetDialog = (force = false) => {
    if (seedanceDeleteBusy && !force) return;
    setSeedanceDeleteOpen(false);
    setSeedanceDeleteTarget(null);
    setSeedanceDeleteError("");
  };

  const confirmRemoveSeedanceAsset = async () => {
    if (seedanceDeleteBusy) return;
    if (!seedanceDeleteTarget?.id) return;
    const targetId = seedanceDeleteTarget.id;
    let mutationSucceeded = false;
    setSeedanceDeleteBusy(true);
    setBusy(`seedance-delete-${targetId}`);
    try {
      await deleteSeedanceAsset(targetId);
      setSeedanceAssets((items) => items.filter((item) => item.id !== targetId));
      toast.success("Seedance 素材已删除");
      closeRemoveSeedanceAssetDialog(true);
      mutationSucceeded = true;
    } catch (error) {
      setSeedanceDeleteError(publicApiError(error, "删除 Seedance 素材失败"));
    } finally {
      setSeedanceDeleteBusy(false);
      setBusy("");
    }
    if (mutationSucceeded) {
      await refreshSeedanceAfterMutation();
    }
  };

  const openCreateSeedanceTagDialog = () => {
    if (busy.startsWith("seedance-") || seedanceTagDialogBusy || seedanceTagDeleteBusy) return;
    setSeedanceTagDialogDraft(emptySeedanceTagDraft());
    setSeedanceTagDialogErrors({});
    setSeedanceTagDialogOpen(true);
  };

  const closeSeedanceTagDialog = (force = false) => {
    if (seedanceTagDialogBusy && !force) return;
    setSeedanceTagDialogOpen(false);
    setSeedanceTagDialogDraft(emptySeedanceTagDraft());
    setSeedanceTagDialogErrors({});
  };

  const validateSeedanceTagDraft = () => {
    const nextErrors: { name?: string; color?: string; form?: string } = {};
    if (!seedanceTagDialogDraft.name.trim()) nextErrors.name = "请输入标签名称";
    if (!isSeedanceTagColor(seedanceTagDialogDraft.color)) nextErrors.color = "颜色格式需为 #RRGGBB";
    return nextErrors;
  };

  const submitSeedanceTagDialog = async () => {
    if (seedanceTagDialogBusy) return;
    const nextErrors = validateSeedanceTagDraft();
    if (Object.keys(nextErrors).length > 0) {
      setSeedanceTagDialogErrors(nextErrors);
      return;
    }
    const payload = {
      name: seedanceTagDialogDraft.name.trim(),
      color: seedanceTagDialogDraft.color.trim(),
    };
    let mutationSucceeded = false;
    setSeedanceTagDialogBusy(true);
    setBusy("seedance-tag-create");
    try {
      const saved = await upsertSeedanceAssetTag(payload);
      setSeedanceTags((items) => items.some((item) => item.id === saved.id)
        ? items.map((item) => item.id === saved.id ? saved : item)
        : [saved, ...items]);
      toast.success("标签已创建");
      closeSeedanceTagDialog(true);
      mutationSucceeded = true;
    } catch (error) {
      setSeedanceTagDialogErrors((current) => ({ ...current, form: publicApiError(error, "保存 Seedance 标签失败") }));
    } finally {
      setSeedanceTagDialogBusy(false);
      setBusy("");
    }
    if (mutationSucceeded) {
      await refreshSeedanceAfterMutation();
    }
  };

  const testProvider = () => {
    if ((providerDraft.capabilities || []).includes("text")) {
      setProviderTestConfirmOpen(true);
      return;
    }
    void runProviderTest();
  };

  const openRemoveSeedanceTagDialog = (tag: SeedanceAssetTag) => {
    if (busy.startsWith("seedance-") || seedanceTagDialogBusy || seedanceTagDeleteBusy) return;
    setSeedanceTagDeleteTarget(tag);
    setSeedanceTagDeleteError("");
    setSeedanceTagDeleteOpen(true);
  };

  const closeRemoveSeedanceTagDialog = (force = false) => {
    if (seedanceTagDeleteBusy && !force) return;
    setSeedanceTagDeleteOpen(false);
    setSeedanceTagDeleteTarget(null);
    setSeedanceTagDeleteError("");
  };

  const confirmRemoveSeedanceTag = async () => {
    if (seedanceTagDeleteBusy) return;
    if (!seedanceTagDeleteTarget?.id) return;
    const targetId = seedanceTagDeleteTarget.id;
    let mutationSucceeded = false;
    setSeedanceTagDeleteBusy(true);
    setBusy(`seedance-tag-${targetId}`);
    try {
      await deleteSeedanceAssetTag(targetId);
      setSeedanceTags((items) => items.filter((item) => item.id !== targetId));
      setSeedanceAssets((items) => items.map((asset) => ({
        ...asset,
        tags: (asset.tags || []).filter((tag) => tag.id !== targetId),
      })));
      toast.success("标签已删除");
      closeRemoveSeedanceTagDialog(true);
      mutationSucceeded = true;
    } catch (error) {
      setSeedanceTagDeleteError(publicApiError(error, "删除 Seedance 标签失败"));
    } finally {
      setSeedanceTagDeleteBusy(false);
      setBusy("");
    }
    if (mutationSucceeded) {
      await refreshSeedanceAfterMutation();
    }
  };

  const openSeedanceUrlDialog = () => {
    if (seedanceUrlBusy || seedanceUploadBusy) return;
    setSeedanceUrlDraft(emptySeedanceUrlDraft());
    setSeedanceUrlErrors({});
    setSeedanceUrlDialogOpen(true);
  };

  const closeSeedanceUrlDialog = (force = false) => {
    if (seedanceUrlBusy && !force) return;
    setSeedanceUrlDialogOpen(false);
    setSeedanceUrlDraft(emptySeedanceUrlDraft());
    setSeedanceUrlErrors({});
  };

  const validateSeedanceUrlDraft = () => {
    const nextErrors: { source_url?: string; name?: string; description?: string; asset_type?: string; tag_ids?: string; form?: string } = {};
    const sourceURL = seedanceUrlDraft.source_url.trim();
    if (!sourceURL) nextErrors.source_url = "请输入 Source URL";
    else {
      try {
        const parsed = new URL(sourceURL);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          nextErrors.source_url = "Source URL 仅支持 http 或 https";
        }
      } catch {
        nextErrors.source_url = "请输入有效的 http/https 地址";
      }
    }
    if (!seedanceUrlDraft.asset_type) nextErrors.asset_type = "请选择资产类型";
    return nextErrors;
  };

  const refreshSeedanceAfterMutation = async (assetId?: string) => {
    try {
      if (assetId) {
        for (let attempt = 0; attempt < 3; attempt += 1) {
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
          if (attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        }
      }
      await refreshSeedance();
    } catch {
      toast.warning("操作已成功但列表刷新失败，请手动刷新");
    }
  };

  const submitSeedanceUrlDialog = async () => {
    if (seedanceUrlBusy) return;
    const nextErrors = validateSeedanceUrlDraft();
    if (Object.keys(nextErrors).length > 0) {
      setSeedanceUrlErrors(nextErrors);
      return;
    }
    if (!seedanceReadiness?.provider_configured) {
      setSeedanceUrlErrors((current) => ({ ...current, form: "当前 Provider 未配置，暂不能注册 URL 资产" }));
      return;
    }
    const payload = {
      source_url: seedanceUrlDraft.source_url.trim(),
      name: seedanceUrlDraft.name.trim() || undefined,
      description: seedanceUrlDraft.description.trim() || undefined,
      asset_type: seedanceUrlDraft.asset_type,
      tag_ids: seedanceUrlDraft.tag_ids,
    };
    setSeedanceUrlBusy(true);
    setBusy("seedance-register-url");
    try {
      const asset = await registerSeedanceAssetURL(payload);
      toast.success("Seedance URL 资产已注册");
      closeSeedanceUrlDialog(true);
      await refreshSeedanceAfterMutation(asset.id);
    } catch (error) {
      setSeedanceUrlErrors((current) => ({ ...current, form: publicApiError(error, "注册 Seedance URL 失败") }));
    } finally {
      setSeedanceUrlBusy(false);
      setBusy("");
    }
  };

  const openSeedanceUploadDialog = () => {
    if (seedanceUrlBusy || seedanceUploadBusy) return;
    setSeedanceUploadDraft(emptySeedanceUploadDraft());
    setSeedanceUploadFile(null);
    setSeedanceUploadErrors({});
    setSeedanceUploadDialogOpen(true);
  };

  const closeSeedanceUploadDialog = (force = false) => {
    if (seedanceUploadBusy && !force) return;
    setSeedanceUploadDialogOpen(false);
    setSeedanceUploadDraft(emptySeedanceUploadDraft());
    setSeedanceUploadFile(null);
    setSeedanceUploadErrors({});
  };

  const validateSeedanceUploadDraft = () => {
    const nextErrors: { file?: string; name?: string; description?: string; asset_type?: string; tag_ids?: string; form?: string } = {};
    if (!seedanceUploadFile) {
      nextErrors.file = "请选择图片或视频文件";
    } else if (!(seedanceUploadFile.type.startsWith("image/") || seedanceUploadFile.type.startsWith("video/"))) {
      nextErrors.file = "仅支持 image/* 或 video/*";
    }
    if (!seedanceUploadDraft.asset_type) nextErrors.asset_type = "请选择资产类型";
    return nextErrors;
  };

  const submitSeedanceUploadDialog = async () => {
    if (seedanceUploadBusy) return;
    const nextErrors = validateSeedanceUploadDraft();
    if (Object.keys(nextErrors).length > 0) {
      setSeedanceUploadErrors(nextErrors);
      return;
    }
    if (!seedanceReadiness?.provider_configured) {
      setSeedanceUploadErrors((current) => ({ ...current, form: "当前 Provider 未配置，暂不能上传 Seedance 资产" }));
      return;
    }
    if (seedanceReadiness?.upload_registration_available === false) {
      setSeedanceUploadErrors((current) => ({ ...current, form: "当前环境未开放上传注册，请先同步或稍后重试" }));
      return;
    }
    if (!seedanceUploadFile) return;
    const formData = new FormData();
    formData.append("file", seedanceUploadFile);
    formData.append("name", seedanceUploadDraft.name.trim() || seedanceUploadFile.name);
    formData.append("description", seedanceUploadDraft.description.trim());
    formData.append("asset_type", seedanceUploadDraft.asset_type);
    formData.append("tag_ids", seedanceUploadDraft.tag_ids.join(","));
    setSeedanceUploadBusy(true);
    setBusy("seedance-upload");
    try {
      const asset = await uploadSeedanceAsset(formData);
      toast.success("Seedance 资产已上传");
      closeSeedanceUploadDialog(true);
      await refreshSeedanceAfterMutation(asset.id);
    } catch (error) {
      setSeedanceUploadErrors((current) => ({ ...current, form: publicApiError(error, "上传 Seedance 资产失败") }));
    } finally {
      setSeedanceUploadBusy(false);
      setBusy("");
    }
  };

  const tabs: Array<[AdminTab, string, typeof Users]> = [
    ["users", "用户", Users],
    ["providers", "模型提供商", ServerCog],
    ["announcements", "系统公告", Bell],
    ["monitoring", "运行监控", Activity],
    ["seedance", "Seedance 素材", Database],
  ];

  return (
    <div className="feature-page admin-page real-admin-page">
      <div className="feature-title">
        <div><p className="eyebrow">SYSTEM / SUPER ADMIN</p><h1>管理后台</h1><p>用户、Provider、公告、监控和素材库均连接真实后端。</p></div>
        <button className="outline-button small" onClick={() => void reload()} disabled={loading}><RefreshCcw size={15} /> 刷新</button>
      </div>
      <div className="admin-workspace">
        <aside className="admin-nav">
          {tabs.map(([key, label, Icon]) => <button key={key} className={tab === key ? "selected" : ""} onClick={() => navigate(adminTabPaths[key])}><Icon size={17} />{label}</button>)}
        </aside>
        <section className="admin-panel">
          {loading ? <div className="empty-output"><Loader2 className="spin" size={26} /><p>正在读取管理数据…</p></div> : null}

          {tab === "users" && <section className="real-admin-section">
            <div className="admin-panel-head"><div><p className="eyebrow">IDENTITY / {users.length}</p><h2>用户与权限</h2></div><button className="vermilion-button" onClick={openCreateUserDialog} disabled={userDialogBusy}><Plus size={16} /> 创建用户</button></div>
            <div className="admin-table">
              <div className="admin-table-head"><span>用户</span><span>角色</span><span>状态</span><span>更新时间</span><span /></div>
              {users.map((user) => <div className="admin-table-row" key={user.id}><span><i>{user.username.slice(0, 1).toUpperCase()}</i><b>{user.display_name || user.username}</b></span><span><code>{user.role}</code></span><span><em className={user.status === "active" ? "active" : "suspended"}>{user.status}</em></span><span>{formatTime(user.updated_at || user.created_at)}</span><button onClick={() => openEditUserDialog(user)} disabled={userDialogBusy || busy === `user-${user.id}`} title="编辑用户"><UserCog size={15} /></button></div>)}
            </div>
          </section>}

          {tab === "providers" && <section className="real-admin-section provider-editor">
            <div className="admin-panel-head"><div><p className="eyebrow">PROVIDERS / {providers.length}</p><h2>模型提供商</h2></div><button className="vermilion-button" onClick={() => createProviderDraft()}><Plus size={16} /> 新建 Provider</button></div>
            <div className="provider-editor-layout">
              <aside className="provider-list compact">
                {providers.map((provider) => <button className={provider.id === activeProvider?.id ? "selected" : ""} key={provider.id} onClick={() => selectProvider(provider)}><ServerCog size={17} /><span><b>{provider.name}</b><small>{provider.provider_type} · {provider.capabilities?.join("/")}</small></span><em className={provider.enabled ? "active" : "pending"}>{provider.enabled ? "启用" : "停用"}</em></button>)}
              </aside>
              <section className="provider-form">
                <label>预设<select value={providerDraft.preset_id || ""} onChange={(event) => { applyPreset(event.target.value, presets, setProviderDraft); clearProviderSensitiveInputs(); }}><option value="">不使用预设</option>{presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label>
                <label className="provider-switch-label">启用<input type="checkbox" checked={providerDraft.enabled !== false} onChange={(event) => setProviderDraft((draft) => ({ ...draft, enabled: event.target.checked }))} /></label>
                <label>名称<input value={providerDraft.name || ""} onChange={(event) => setProviderDraft((draft) => ({ ...draft, name: event.target.value }))} /></label>
                <label>Provider ID<input value={providerDraft.id || ""} disabled={Boolean(activeProvider?.id)} onChange={(event) => setProviderDraft((draft) => ({ ...draft, id: event.target.value }))} placeholder="留空自动生成" /></label>
                <label>Base URL<input value={providerDraft.base_url || ""} onChange={(event) => setProviderDraft((draft) => ({ ...draft, base_url: event.target.value }))} /></label>
                <label>模式<select value={providerDraft.mode} onChange={(event) => setProviderDraft((draft) => ({ ...draft, mode: event.target.value as ModelProviderConfig["mode"] }))}><option value="openai_compatible">OpenAI Compatible</option><option value="local_openai">Local OpenAI</option></select></label>
                <label>Provider 类型<select value={providerDraft.provider_type || "openai_compatible"} onChange={(event) => setProviderDraft((draft) => ({ ...draft, provider_type: event.target.value as NonNullable<ModelProviderConfig["provider_type"]> }))}><option value="openai_compatible">openai_compatible</option><option value="volcengine_ark">volcengine_ark</option><option value="gemini_media">gemini_media</option><option value="kling_video">kling_video</option><option value="minimax_hailuo">minimax_hailuo</option><option value="fal_happyhorse">fal_happyhorse</option><option value="xai_imagine">xai_imagine</option><option value="aliyun_yike">阿里云 Yike / Wan 视频</option></select></label>
                <label>鉴权方式<select value={providerDraft.auth_type} onChange={(event) => setProviderDraft((draft) => ({ ...draft, auth_type: event.target.value as ModelProviderConfig["auth_type"] }))}><option value="bearer">Bearer</option><option value="x_api_key">X-API-Key</option><option value="x_goog_api_key">Google API Key</option><option value="auto_api_key">自动兼容 API Key</option><option value="custom_header">自定义 Header</option><option value="query_param">Query 参数</option><option value="none">None</option></select></label>
                {providerDraft.auth_type === "custom_header" && <label>自定义 Header<input value={providerDraft.custom_auth_header || ""} onChange={(event) => setProviderDraft((draft) => ({ ...draft, custom_auth_header: event.target.value }))} placeholder="X-API-Key" /></label>}
                {providerDraft.auth_type === "query_param" && <label>Query 参数<input value={providerDraft.auth_query_param || ""} onChange={(event) => setProviderDraft((draft) => ({ ...draft, auth_query_param: event.target.value }))} placeholder="key" /></label>}
                <label>API Key<KeyRound size={13} /><input type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={activeProvider?.api_key_configured ? "留空则保留已有密钥" : "保存或测试时可填入"} /></label>
                {selectedPreset?.secrets?.map((secret) => <label key={secret.key}>{secret.label}<input type="password" autoComplete="new-password" value={providerSecrets[secret.key] || ""} onChange={(event) => setProviderSecrets((current) => ({ ...current, [secret.key]: event.target.value }))} placeholder={activeProvider?.secrets_set?.[secret.key] ? "已配置，留空保持当前值" : secret.placeholder || "请输入密钥"} /></label>)}
                <label>文本模型<input value={providerDraft.text_model || ""} onChange={(event) => setProviderDraft((draft) => ({ ...draft, text_model: event.target.value }))} /></label>
                <label>图像模型<input value={providerDraft.image_model || ""} onChange={(event) => setProviderDraft((draft) => ({ ...draft, image_model: event.target.value }))} /></label>
                <label>视频模型<input value={providerDraft.video_model || ""} onChange={(event) => setProviderDraft((draft) => ({ ...draft, video_model: event.target.value }))} /></label>
                <label>音频模型<input value={providerDraft.audio_model || ""} onChange={(event) => setProviderDraft((draft) => ({ ...draft, audio_model: event.target.value }))} /></label>
                <label>超时时间 ms<input type="number" min={30000} max={600000} step={1000} value={providerDraft.timeout_ms || 300000} onChange={(event) => setProviderDraft((draft) => ({ ...draft, timeout_ms: Number(event.target.value) || 300000 }))} /></label>
                <label>并发上限<input type="number" min={1} max={8} value={providerDraft.max_concurrency || 1} onChange={(event) => setProviderDraft((draft) => ({ ...draft, max_concurrency: Number(event.target.value) || 1 }))} /></label>
                <div className="provider-form-full provider-chip-section">
                  <span>启用能力</span>
                  {capabilityOptions.map((item) => {
                    const checked = (providerDraft.capabilities || []).includes(item.value);
                    return <button key={item.value} type="button" className={checked ? "active" : ""} onClick={() => setProviderDraft((draft) => ({ ...draft, capabilities: checked ? (draft.capabilities || []).filter((value) => value !== item.value) : [...(draft.capabilities || []), item.value] }))}>{item.label}</button>;
                  })}
                  <span>默认入口</span>
                  {capabilityOptions.map((item) => {
                    const checked = (providerDraft.default_for || []).includes(item.value);
                    return <button key={`default-${item.value}`} type="button" className={checked ? "active" : ""} onClick={() => setProviderDraft((draft) => ({ ...draft, default_for: checked ? (draft.default_for || []).filter((value) => value !== item.value) : [...(draft.default_for || []), item.value] }))}>{item.label}</button>;
                  })}
                </div>
                <div className="provider-form-full">
                  <div className="provider-section-head">
                    <div><b>能力模型列表</b><small>可手动输入模型 ID；逗号、分号或换行分隔。拉取模型不会覆盖手填项。</small></div>
                    <span className="status-chip blue">{configuredModelIds.length} 个模型</span>
                  </div>
                  <div className="provider-capability-grid">
                    {capabilityOptions.map((item) => (
                      <label key={item.value}>
                        {item.label}模型列表
                        <textarea
                          value={joinModels(providerDraft.models_by_capability?.[item.value] || [])}
                          onChange={(event) => setProviderDraft((draft) => ({
                            ...draft,
                            models_by_capability: {
                              ...(draft.models_by_capability || {}),
                              [item.value]: splitModels(event.target.value),
                            },
                          }))}
                          placeholder={`每行一个 ${item.label} 模型 ID`}
                        />
                      </label>
                    ))}
                  </div>
                </div>
                <div className="provider-form-full">
                  <div className="provider-section-head">
                    <div><b>模型显示名称映射</b><small>格式：真实模型 ID = 显示名称。只影响下拉展示，不改变请求模型。</small></div>
                    <Hash size={15} />
                  </div>
                  <textarea
                    className="provider-map-textarea"
                    value={Object.entries(providerDraft.model_aliases || {}).map(([model, alias]) => `${model} = ${alias}`).join("\n")}
                    onChange={(event) => setProviderDraft((draft) => ({
                      ...draft,
                      model_aliases: normalizeAliasMap(Object.fromEntries(splitLines(event.target.value).map((line) => {
                        const index = line.indexOf("=");
                        if (index < 0) return [line, line];
                        return [line.slice(0, index), line.slice(index + 1)];
                      }))),
                    }))}
                    placeholder={"wan3.0 = Wan 3.0\nbanana-pro = Banana Pro"}
                  />
                </div>
                <div className="provider-form-full">
                  <div className="provider-section-head">
                    <div><b>图片模型调用协议</b><small>按真实模型 ID 指定协议；中转站 Gemini / Banana 通常选择 OpenAI Chat Completions。</small></div>
                    <span className="status-chip blue">{protocolModelIds.length} 个图片模型</span>
                  </div>
                  {protocolModelIds.length ? <div className="provider-protocol-grid">{protocolModelIds.map((modelID) => <label key={modelID}><span>{modelID}</span><select value={providerDraft.model_protocols?.[modelID] || "auto"} onChange={(event) => setProviderDraft((draft) => ({ ...draft, model_protocols: { ...(draft.model_protocols || {}), [modelID]: event.target.value as ImageGenerationProtocol } }))}>{imageProtocolOptions.map((protocol) => <option key={protocol.value} value={protocol.value}>{protocol.label}</option>)}</select></label>)}</div> : <div className="empty-output"><p>请先拉取模型或填写图像模型。</p></div>}
                </div>
                <div className="provider-form-full">
                  <div className="provider-section-head">
                    <div><b>Endpoint Overrides</b><small>格式：video_create = /contents/generations/tasks；每行一个覆盖路径。</small></div>
                    <Hash size={15} />
                  </div>
                  <textarea
                    className="provider-map-textarea"
                    value={Object.entries(providerDraft.endpoint_overrides || {}).map(([key, value]) => `${key} = ${value}`).join("\n")}
                    onChange={(event) => setProviderDraft((draft) => ({
                      ...draft,
                      endpoint_overrides: normalizeAliasMap(Object.fromEntries(splitLines(event.target.value).map((line) => {
                        const index = line.indexOf("=");
                        if (index < 0) return [line, ""];
                        return [line.slice(0, index), line.slice(index + 1)];
                      }))),
                    }))}
                    placeholder={"video_create = /contents/generations/tasks\nvideo_get = /contents/generations/tasks/{id}"}
                  />
                </div>
                <div className="provider-form-full">
                  <div className="provider-section-head">
                    <div><b>Extra Headers</b><small>格式：Header-Name = value；空项不会提交。</small></div>
                    <Hash size={15} />
                  </div>
                  <textarea
                    className="provider-map-textarea"
                    value={Object.entries(providerDraft.extra_headers || {}).map(([key, value]) => `${key} = ${value}`).join("\n")}
                    onChange={(event) => setProviderDraft((draft) => ({
                      ...draft,
                      extra_headers: normalizeAliasMap(Object.fromEntries(splitLines(event.target.value).map((line) => {
                        const index = line.indexOf("=");
                        if (index < 0) return [line, ""];
                        return [line.slice(0, index), line.slice(index + 1)];
                      }))),
                    }))}
                    placeholder={"X-Tenant = team-a\nX-Provider-Mode = production"}
                  />
                </div>
                <div className="provider-form-actions">
                  <button className="outline-button small" onClick={() => void fetchModels()} disabled={busy === "provider-models"}><RefreshCcw size={15} /> 拉取模型</button>
                  <button className="outline-button small" onClick={testProvider} disabled={busy === "provider-test"}><TestTube2 size={15} /> 测试连接</button>
                  <button className="outline-button small" onClick={() => createProviderDraft(providerDraft)}><CopyPlus size={15} /> 复制为新 Provider</button>
                  <button className="outline-button small" onClick={() => openProviderDeleteDialog()} disabled={!activeProvider?.id || activeProvider.id === "default" || providerDeleteBusy}>删除 Provider</button>
                  <button className="vermilion-button" onClick={() => void saveProvider()} disabled={busy === "provider-save"}><Save size={16} /> 保存 Provider</button>
                </div>
                {providerTestResult ? <div className={`provider-test-result ${providerTestResult.ok === false ? "failed" : "passed"}`}>
                  <b>{providerTestResult.ok === false ? "测试失败" : "测试完成"}</b>
                  <p>{providerTestResult.message || providerTestResult.error || providerTestResult.text || "后端已返回测试结果。"}</p>
                  {providerTestResult.text_ok !== undefined ? <small>文本 ping：{providerTestResult.text_ok ? "成功" : "失败"}</small> : null}
                  {providerTestResult.model ? <small>使用模型：{providerTestResult.model}</small> : null}
                  {providerTestResult.provider_config ? <small>鉴权发送：{providerTestResult.provider_config.auth_header || "无"} · API Key：{providerTestResult.provider_config.api_key_set ? "已带入" : "未带入"}</small> : null}
                  {providerTestResult.models_error ? <small>模型列表错误：{providerTestResult.models_error}</small> : null}
                  {providerTestResult.text_error ? <small>文本测试错误：{providerTestResult.text_error}</small> : null}
                </div> : null}
              </section>
            </div>
          </section>}

          {tab === "announcements" && <section className="real-admin-section">
            <div className="admin-panel-head"><div><p className="eyebrow">ANNOUNCEMENTS / {announcements.length}</p><h2>系统公告</h2></div><button className="vermilion-button" onClick={openCreateAnnouncementDialog} disabled={announcementDialogBusy || announcementRevokeBusy || announcementDialogOpen || announcementRevokeOpen}><Plus size={16} /> 发布公告</button></div>
            {announcements.map((item) => <article className="announcement-card" key={item.id}><div><span className={`status-chip ${item.status === "active" ? "running" : "canceled"}`}>{item.status}</span><b>{item.title}</b><p>{item.content}</p></div><aside><small>{formatTime(item.published_at || item.created_at)}</small><button onClick={() => openEditAnnouncementDialog(item)} disabled={announcementDialogBusy || announcementRevokeBusy || announcementDialogOpen || announcementRevokeOpen || busy === `announcement-${item.id}`}>编辑并重发</button>{item.status === "active" ? <button onClick={() => openRevokeAnnouncementDialog(item)} disabled={announcementDialogBusy || announcementRevokeBusy || announcementDialogOpen || announcementRevokeOpen || busy === `announcement-revoke-${item.id}`}>撤销</button> : null}</aside></article>)}
          </section>}

          {tab === "monitoring" && <section className="real-admin-section">
            <div className="admin-panel-head">
              <div><p className="eyebrow">MONITORING / LIVE</p><h2>系统运行监控</h2><small>{monitoring?.generated_at ? `更新于 ${formatTime(monitoring.generated_at)}` : "等待监控数据"} · {monitoringRefreshing ? "后台刷新中" : "15 秒自动刷新"}</small></div>
              <div className="monitor-actions">
                <select value={monitoringHours} onChange={(event) => setMonitoringHours(Number(event.target.value))}>
                  <option value={1}>最近 1 小时</option><option value={24}>最近 24 小时</option><option value={168}>最近 7 天</option><option value={720}>最近 30 天</option>
                </select>
                <button className="outline-button small" onClick={() => void loadMonitoring(monitoringHours)}><RefreshCcw className={monitoringRefreshing ? "spin" : ""} size={15} /> 刷新</button>
              </div>
            </div>
            <div className="monitor-grid">
              <div><span>数据库</span><b>{monitoring?.health.db || "-"}</b><em className={monitoring?.health.db_ok ? "healthy" : "watch"}>{monitoring?.health.db_ok ? "正常" : "异常"}</em></div>
              <div><span>请求总数</span><b>{monitoringSummary?.total_requests.toLocaleString("zh-CN") || 0}</b><em className="healthy">{monitoringHours}h</em></div>
              <div><span>成功率</span><b>{monitoringSuccessRate.toFixed(1)}%</b><em className={monitoringSuccessRate >= 95 ? "healthy" : "watch"}>success</em></div>
              <div><span>失败率</span><b>{monitoringErrorRate.toFixed(1)}%</b><em className={monitoringErrorRate > 5 ? "watch" : "healthy"}>errors</em></div>
              <div><span>平均耗时</span><b>{formatDuration(monitoringAverageDuration)}</b><em className="healthy">latency</em></div>
              <div><span>产物数</span><b>{monitoringSummary?.total_output_count.toLocaleString("zh-CN") || 0}</b><em className="healthy">outputs</em></div>
              <div><span>消耗单位</span><b>{monitoringSummary?.total_units.toLocaleString("zh-CN") || 0}</b><em className="healthy">units</em></div>
              <div><span>最近请求</span><b>{monitoringSummary?.latest_request_time ? formatTime(monitoringSummary.latest_request_time) : "-"}</b><em className="healthy">latest</em></div>
            </div>
            <div className="monitor-storage-grid">
              <span>用户 <b>{monitoring?.storage_stats.users || 0}</b></span><span>画布 <b>{monitoring?.storage_stats.projects || 0}</b></span><span>快照 <b>{monitoring?.storage_stats.snapshots || 0}</b></span><span>素材 <b>{monitoring?.storage_stats.assets || 0}</b></span><span>AI 记录 <b>{monitoring?.storage_stats.ai_requests || 0}</b></span>
            </div>
            <div className="monitor-detail-grid">
              <div className="monitor-data-panel"><p className="eyebrow">MEMBER USAGE</p>{monitoring?.users.length ? monitoring.users.map((item) => <div key={item.user_id || item.username}><span><b>{item.user_display_name || item.username || "未知用户"}</b><small>{item.last_request_at ? formatTime(item.last_request_at) : "暂无最近请求"}</small></span><em>{item.requests || 0} 请求 · {item.outputs || 0} 产物 · {item.errors || 0} 错误</em></div>) : <small>暂无成员使用数据</small>}</div>
              <div className="monitor-data-panel"><p className="eyebrow">MODEL USAGE</p>{monitoring?.models.length ? monitoring.models.map((item) => <div key={`${item.model}-${item.operation}`}><span><b>{item.model || "未指定模型"}</b><small>{item.operation || "unknown"} · {formatDuration(item.avg_duration_ms || 0)}</small></span><em>{item.requests || 0} 请求 · {item.outputs || 0} 产物 · {item.errors || 0} 错误</em></div>) : <small>暂无模型统计</small>}</div>
              <div className="monitor-data-panel"><p className="eyebrow">RECENT FAILURES</p>{latestMonitoringErrors.length ? latestMonitoringErrors.map((item) => <div key={item.id}><span><b>{item.operation} · {item.model}</b><small>{item.error_message || `HTTP ${item.http_status || 0}`}</small></span><em>{formatTime(item.created_at)}</em></div>) : <small>当前窗口没有失败请求</small>}</div>
              <div className="monitor-data-panel monitor-log-tail"><p className="eyebrow">BACKEND LOG TAIL</p>{monitoring?.logs.length ? monitoring.logs.slice(-60).map((item, index) => <div key={`${item.source}-${index}`}><code>{item.source}</code><small>{item.line}</small></div>) : <small>暂无日志尾部数据</small>}</div>
            </div>
          </section>}

          {tab === "seedance" && <section className="real-admin-section">
            <div className="admin-panel-head"><div><p className="eyebrow">SEEDANCE / {seedanceTotal}</p><h2>Seedance 素材</h2><small>{seedanceReadiness ? `provider=${seedanceReadiness.provider_configured ? "ready" : "missing"} · upload=${seedanceReadiness.upload_registration_available ? "on" : "off"} · publicBase=${seedanceReadiness.public_asset_base_url_configured ? "on" : "off"}` : "readiness loading"}</small></div><div><button className="outline-button small" onClick={() => void syncSeedance("poll")}><RefreshCcw size={15} /> 轮询</button><button className="outline-button small" onClick={openSeedanceUploadDialog} disabled={seedanceUploadBusy || seedanceUrlBusy}>上传</button><button className="outline-button small" onClick={openSeedanceUrlDialog} disabled={seedanceUploadBusy || seedanceUrlBusy}>注册 URL</button><button className="vermilion-button" onClick={() => void syncSeedance("sync")}><Database size={16} /> 同步</button></div></div>
            <div className="filter-line">
              <label className="tag-search">
                <Search size={15} />
                <input value={seedanceSearch} onChange={(event) => setSeedanceSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void loadSeedanceAssets(); }} placeholder="搜索名称 / AssetID" />
              </label>
              <select value={seedanceStatus} onChange={(event) => setSeedanceStatus(event.target.value)}>
                <option value="">全部状态</option>
                {["queued", "Creating", "Processing", "Active", "Failed"].map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
              <select value={seedanceType} onChange={(event) => setSeedanceType(event.target.value)}>
                <option value="">全部类型</option><option value="Image">图片</option><option value="Video">视频</option>
              </select>
              <select value={seedanceTagId} onChange={(event) => setSeedanceTagId(event.target.value)}>
                <option value="">全部标签</option>{seedanceTags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
              </select>
              <button className="outline-button small" onClick={() => void loadSeedanceAssets()} disabled={seedanceListLoading}>{seedanceListLoading ? <Loader2 className="spin" size={15} /> : <Search size={15} />} 查询</button>
              <button className="outline-button small" onClick={() => { setSeedanceSearch(""); setSeedanceStatus(""); setSeedanceType(""); setSeedanceTagId(""); void loadSeedanceAssets({}); }} disabled={seedanceListLoading}>清空</button>
            </div>
            <div className="filter-line">
              <div className="segmented">
                <button onClick={openCreateSeedanceTagDialog} disabled={busy.startsWith("seedance-")}>新建标签</button>
                {seedanceTags.map((tag) => (
                  <span key={tag.id} className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-1 text-sm">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tag.color || seedanceTagDefaultColor }} />
                    <span>{tag.name}</span>
                    <button
                      type="button"
                      className="icon-button subtle"
                      aria-label={`删除标签 ${tag.name}`}
                      title={`删除标签 ${tag.name}`}
                      disabled={busy.startsWith("seedance-")}
                      onClick={() => openRemoveSeedanceTagDialog(tag)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </span>
                ))}
              </div>
            </div>
            <div className="seedance-board">{seedancePageState.items.map((asset, index) => <article key={asset.id}><span className="seedance-index">{String((seedancePageState.page - 1) * seedancePageSize + index + 1).padStart(2, "0")}</span><div><b>{asset.name}</b><small>{asset.asset_type} · {asset.volcano_asset_id || asset.source_url} · {(asset.tags || []).map((tag) => tag.name).join("/") || "无标签"}</small></div><span className={`status-chip ${asset.status.toLowerCase() === "active" ? "succeeded" : asset.status.toLowerCase() === "failed" ? "failed" : "running"}`}>{asset.status}</span><button onClick={() => openEditSeedanceAssetDialog(asset)} disabled={busy.startsWith("seedance-")}>编辑</button><button onClick={() => openRemoveSeedanceAssetDialog(asset)} disabled={busy.startsWith("seedance-")}>删除</button></article>)}</div>
            {!seedanceListLoading && !seedancePageState.items.length ? <div className="empty-output"><p>没有匹配的 Seedance 素材</p></div> : null}
            <div className="filter-line">
              <small>已加载 {seedanceAssets.length} / {seedanceTotal} 条 · 第 {seedancePageState.page} / {seedancePageState.pageCount} 页</small>
              <button className="outline-button small" disabled={seedancePageState.page <= 1} onClick={() => setSeedancePage((page) => Math.max(1, page - 1))}><ChevronLeft size={15} /> 上一页</button>
              <button className="outline-button small" disabled={seedancePageState.page >= seedancePageState.pageCount} onClick={() => setSeedancePage((page) => Math.min(seedancePageState.pageCount, page + 1))}>下一页 <ChevronRight size={15} /></button>
            </div>
          </section>}
        </section>
        <aside className="admin-side-status"><p className="eyebrow">ACCESS LEVEL</p><ShieldCheck size={24} /><h3>super_admin</h3><p>此页所有数据都来自后端管理接口，修改会写入正式配置。</p><hr /><p className="eyebrow">QUICK STATUS</p><button><Activity size={15} /> {monitoring?.generated_at ? `监控更新 ${formatTime(monitoring.generated_at)}` : "监控待加载"}</button><button><Check size={15} /> {providers.length} 个 Provider</button></aside>
        <Dialog
          open={userDialogOpen}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              if (userDialogBusy) return;
              closeUserDialog();
              return;
            }
            setUserDialogOpen(true);
          }}
        >
          <DialogContent
            className="sm:max-w-[640px]"
            showCloseButton={!userDialogBusy}
            onEscapeKeyDown={(event) => {
              if (userDialogBusy) event.preventDefault();
            }}
            onPointerDownOutside={(event) => {
              if (userDialogBusy) event.preventDefault();
            }}
            onInteractOutside={(event) => {
              if (userDialogBusy) event.preventDefault();
            }}
          >
            <DialogHeader>
              <DialogTitle>{userDialogMode === "create" ? "创建用户" : "编辑用户"}</DialogTitle>
              <DialogDescription>
                {userDialogMode === "create"
                  ? "填写用户名、密码、角色与状态后创建新用户。"
                  : "用户名只读，密码留空则保持不变。"}
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-2">
              <label className="grid gap-2 text-sm">
                <span>用户名</span>
                <Input
                  value={userDialogDraft.username}
                  onChange={(event) => setUserDialogDraft((draft) => ({ ...draft, username: event.target.value }))}
                  disabled={userDialogBusy}
                  readOnly={userDialogMode === "edit"}
                  placeholder="username"
                />
                {userDialogErrors.username ? <span className="text-sm text-destructive">{userDialogErrors.username}</span> : null}
              </label>

              <label className="grid gap-2 text-sm">
                <span>显示名称</span>
                <Input
                  value={userDialogDraft.display_name}
                  onChange={(event) => setUserDialogDraft((draft) => ({ ...draft, display_name: event.target.value }))}
                  disabled={userDialogBusy}
                  placeholder="可选"
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2 text-sm">
                  <span>角色</span>
                  <select
                    value={userDialogDraft.role}
                    onChange={(event) => setUserDialogDraft((draft) => ({ ...draft, role: event.target.value as AdminUser["role"] }))}
                    disabled={userDialogBusy}
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="member">member</option>
                    <option value="super_admin">super_admin</option>
                  </select>
                </label>

                <label className="grid gap-2 text-sm">
                  <span>状态</span>
                  <select
                    value={userDialogDraft.status}
                    onChange={(event) => setUserDialogDraft((draft) => ({ ...draft, status: event.target.value as UserDialogDraft["status"] }))}
                    disabled={userDialogBusy}
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
                  value={userDialogDraft.password}
                  onChange={(event) => setUserDialogDraft((draft) => ({ ...draft, password: event.target.value }))}
                  disabled={userDialogBusy}
                  placeholder={userDialogMode === "create" ? "必填，至少 8 位" : "留空表示不修改"}
                />
                {userDialogErrors.password ? <span className="text-sm text-destructive">{userDialogErrors.password}</span> : null}
              </label>

              {userDialogErrors.form ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{userDialogErrors.form}</p> : null}
            </div>

            <DialogFooter>
              <button className="outline-button small" type="button" onClick={() => closeUserDialog()} disabled={userDialogBusy}>
                取消
              </button>
              <button className="vermilion-button" type="button" onClick={() => void saveUserDialog()} disabled={userDialogBusy}>
                {userDialogBusy ? "保存中…" : userDialogMode === "create" ? "创建用户" : "保存修改"}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <AlertDialog
          open={providerDeleteOpen}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              if (providerDeleteBusy) return;
              closeProviderDeleteDialog();
              return;
            }
            setProviderDeleteOpen(true);
          }}
        >
          <AlertDialogContent
            onEscapeKeyDown={(event) => {
              if (providerDeleteBusy) event.preventDefault();
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>删除 Provider</AlertDialogTitle>
              <AlertDialogDescription>
                {providerDeleteTarget
                  ? `确认删除 “${providerDeleteTarget.name}”（${providerDeleteTarget.id}）？此操作会移除后端管理配置。`
                  : "请选择要删除的 Provider。"}
              </AlertDialogDescription>
            </AlertDialogHeader>

            {providerDeleteError ? (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{providerDeleteError}</p>
            ) : null}

            <AlertDialogFooter>
              <AlertDialogCancel
                disabled={providerDeleteBusy}
                onClick={(event) => {
                  if (providerDeleteBusy) event.preventDefault();
                  else closeProviderDeleteDialog();
                }}
              >
                取消
              </AlertDialogCancel>
              <button
                className="vermilion-button"
                type="button"
                onClick={() => void confirmProviderDelete()}
                disabled={providerDeleteBusy || !providerDeleteTarget?.id}
              >
                {providerDeleteBusy ? "删除中…" : "确认删除"}
              </button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Dialog
          open={announcementDialogOpen}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              if (announcementDialogBusy) return;
              closeAnnouncementDialog();
              return;
            }
            setAnnouncementDialogOpen(true);
          }}
        >
          <DialogContent
            className="sm:max-w-[680px]"
            showCloseButton={!announcementDialogBusy}
            onEscapeKeyDown={(event) => {
              if (announcementDialogBusy) event.preventDefault();
            }}
            onPointerDownOutside={(event) => {
              if (announcementDialogBusy) event.preventDefault();
            }}
            onInteractOutside={(event) => {
              if (announcementDialogBusy) event.preventDefault();
            }}
          >
            <DialogHeader>
              <DialogTitle>{announcementDialogMode === "create" ? "发布公告" : "编辑并重新发布"}</DialogTitle>
              <DialogDescription>
                {announcementDialogMode === "create"
                  ? "创建一条面向普通用户展示的系统公告。"
                  : `基于「${announcementDialogTarget?.title || "原公告"}」重新发布，提交会调用 republish 接口。`}
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-2">
              <label className="grid gap-2 text-sm">
                <span>公告类型</span>
                <select
                  value={announcementDialogDraft.kind}
                  onChange={(event) => setAnnouncementDialogDraft((draft) => ({ ...draft, kind: event.target.value as AnnouncementDialogDraft["kind"] }))}
                  disabled={announcementDialogBusy}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="update">update</option>
                  <option value="maintenance">maintenance</option>
                  <option value="notice">notice</option>
                </select>
                {announcementDialogErrors.kind ? <span className="text-sm text-destructive">{announcementDialogErrors.kind}</span> : null}
              </label>

              <label className="grid gap-2 text-sm">
                <span>标题</span>
                <Input
                  value={announcementDialogDraft.title}
                  onChange={(event) => setAnnouncementDialogDraft((draft) => ({ ...draft, title: event.target.value }))}
                  disabled={announcementDialogBusy}
                  maxLength={80}
                  placeholder="最多 80 个字符"
                />
                <small>{announcementDialogDraft.title.length}/80</small>
                {announcementDialogErrors.title ? <span className="text-sm text-destructive">{announcementDialogErrors.title}</span> : null}
              </label>

              <label className="grid gap-2 text-sm">
                <span>内容</span>
                <Textarea
                  value={announcementDialogDraft.content}
                  onChange={(event) => setAnnouncementDialogDraft((draft) => ({ ...draft, content: event.target.value }))}
                  disabled={announcementDialogBusy}
                  maxLength={1000}
                  placeholder="最多 1000 个字符"
                  rows={6}
                />
                <small>{announcementDialogDraft.content.length}/1000</small>
                {announcementDialogErrors.content ? <span className="text-sm text-destructive">{announcementDialogErrors.content}</span> : null}
              </label>

              {announcementDialogErrors.form ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{announcementDialogErrors.form}</p> : null}
            </div>

            <DialogFooter>
              <button className="outline-button small" type="button" onClick={() => closeAnnouncementDialog()} disabled={announcementDialogBusy}>
                取消
              </button>
              <button className="vermilion-button" type="button" onClick={() => void saveAnnouncementDialog()} disabled={announcementDialogBusy}>
                {announcementDialogBusy ? "提交中…" : announcementDialogMode === "create" ? "发布公告" : "编辑并重发"}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <AlertDialog
          open={announcementRevokeOpen}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              if (announcementRevokeBusy) return;
              closeRevokeAnnouncementDialog();
              return;
            }
            setAnnouncementRevokeOpen(true);
          }}
        >
          <AlertDialogContent
            onEscapeKeyDown={(event) => {
              if (announcementRevokeBusy) event.preventDefault();
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>撤销公告</AlertDialogTitle>
              <AlertDialogDescription>
                {announcementRevokeTarget
                  ? `确认撤销公告「${announcementRevokeTarget.title}」（${announcementRevokeTarget.id}）？撤销后普通用户不再看到该公告。`
                  : "请选择要撤销的公告。"}
              </AlertDialogDescription>
            </AlertDialogHeader>

            {announcementRevokeError ? (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{announcementRevokeError}</p>
            ) : null}

            <AlertDialogFooter>
              <AlertDialogCancel
                disabled={announcementRevokeBusy}
                onClick={(event) => {
                  if (announcementRevokeBusy) event.preventDefault();
                  else closeRevokeAnnouncementDialog();
                }}
              >
                取消
              </AlertDialogCancel>
              <button
                className="vermilion-button"
                type="button"
                onClick={() => void confirmAnnouncementRevoke()}
                disabled={announcementRevokeBusy || !announcementRevokeTarget?.id}
              >
                {announcementRevokeBusy ? "撤销中…" : "确认撤销"}
              </button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Dialog
          open={seedanceUrlDialogOpen}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              if (seedanceUrlBusy) return;
              closeSeedanceUrlDialog();
              return;
            }
            setSeedanceUrlDialogOpen(true);
          }}
        >
          <DialogContent
            className="sm:max-w-[720px]"
            showCloseButton={!seedanceUrlBusy}
            onEscapeKeyDown={(event) => {
              if (seedanceUrlBusy) event.preventDefault();
            }}
            onPointerDownOutside={(event) => {
              if (seedanceUrlBusy) event.preventDefault();
            }}
            onInteractOutside={(event) => {
              if (seedanceUrlBusy) event.preventDefault();
            }}
          >
            <DialogHeader>
              <DialogTitle>注册 Seedance URL</DialogTitle>
              <DialogDescription>为已有资源地址创建 Seedance 素材记录，提交后会按正式流程刷新列表与轮询状态。</DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-2">
              <p className="rounded-md bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                {seedanceReadiness
                  ? `provider=${seedanceReadiness.provider_configured ? "ready" : "missing"} · upload=${seedanceReadiness.upload_registration_available ? "on" : "off"} · publicBase=${seedanceReadiness.public_asset_base_url_configured ? "on" : "off"}`
                  : "readiness loading"}
                {seedanceReadiness?.provider_error ? ` · ${seedanceReadiness.provider_error}` : ""}
              </p>
              {!seedanceReadiness?.provider_configured ? (
                <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700">当前 Provider 未配置，暂不能注册 URL 资产。</p>
              ) : null}

              <label className="grid gap-2 text-sm">
                <span>Source URL *</span>
                <Input
                  value={seedanceUrlDraft.source_url}
                  onChange={(event) => setSeedanceUrlDraft((draft) => ({ ...draft, source_url: event.target.value }))}
                  disabled={seedanceUrlBusy}
                  placeholder="https://example.com/image.png"
                />
                {seedanceUrlErrors.source_url ? <span className="text-sm text-destructive">{seedanceUrlErrors.source_url}</span> : null}
              </label>

              <label className="grid gap-2 text-sm">
                <span>名称</span>
                <Input
                  value={seedanceUrlDraft.name}
                  onChange={(event) => setSeedanceUrlDraft((draft) => ({ ...draft, name: event.target.value }))}
                  disabled={seedanceUrlBusy}
                  placeholder="可选"
                />
              </label>

              <label className="grid gap-2 text-sm">
                <span>备注</span>
                <Textarea
                  value={seedanceUrlDraft.description}
                  onChange={(event) => setSeedanceUrlDraft((draft) => ({ ...draft, description: event.target.value }))}
                  disabled={seedanceUrlBusy}
                  rows={4}
                  placeholder="可选"
                />
              </label>

              <label className="grid gap-2 text-sm">
                <span>资产类型</span>
                <select
                  value={seedanceUrlDraft.asset_type}
                  onChange={(event) => setSeedanceUrlDraft((draft) => ({ ...draft, asset_type: event.target.value as "Image" | "Video" }))}
                  disabled={seedanceUrlBusy}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="Image">Image</option>
                  <option value="Video">Video</option>
                </select>
              </label>

              <div className="grid gap-2 text-sm">
                <span>标签</span>
                <div className="flex flex-wrap gap-2">
                  {seedanceTags.length ? seedanceTags.map((tag) => {
                    const selected = seedanceUrlDraft.tag_ids.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        className={selected ? "selected" : ""}
                        disabled={seedanceUrlBusy}
                        aria-pressed={selected}
                        onClick={() => setSeedanceUrlDraft((draft) => ({
                          ...draft,
                          tag_ids: selected ? draft.tag_ids.filter((tagId) => tagId !== tag.id) : [...draft.tag_ids, tag.id],
                        }))}
                      >
                        {tag.name}
                      </button>
                    );
                  }) : <span className="text-sm text-muted-foreground">暂无标签，可先创建标签后再绑定。</span>}
                </div>
              </div>

              {seedanceUrlErrors.form ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{seedanceUrlErrors.form}</p> : null}
            </div>

            <DialogFooter>
              <button className="outline-button small" type="button" onClick={() => closeSeedanceUrlDialog()} disabled={seedanceUrlBusy}>
                取消
              </button>
              <button className="vermilion-button" type="button" onClick={() => void submitSeedanceUrlDialog()} disabled={seedanceUrlBusy}>
                {seedanceUrlBusy ? "提交中…" : "注册 URL"}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog
          open={seedanceUploadDialogOpen}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              if (seedanceUploadBusy) return;
              closeSeedanceUploadDialog();
              return;
            }
            setSeedanceUploadDialogOpen(true);
          }}
        >
          <DialogContent
            className="sm:max-w-[720px]"
            showCloseButton={!seedanceUploadBusy}
            onEscapeKeyDown={(event) => {
              if (seedanceUploadBusy) event.preventDefault();
            }}
            onPointerDownOutside={(event) => {
              if (seedanceUploadBusy) event.preventDefault();
            }}
            onInteractOutside={(event) => {
              if (seedanceUploadBusy) event.preventDefault();
            }}
          >
            <DialogHeader>
              <DialogTitle>上传 Seedance 文件</DialogTitle>
              <DialogDescription>上传图片或视频文件后创建 Seedance 素材记录，提交前请确认文件类型与标签。</DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-2">
              <p className="rounded-md bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                {seedanceReadiness
                  ? `provider=${seedanceReadiness.provider_configured ? "ready" : "missing"} · upload=${seedanceReadiness.upload_registration_available ? "on" : "off"} · publicBase=${seedanceReadiness.public_asset_base_url_configured ? "on" : "off"}`
                  : "readiness loading"}
                {seedanceReadiness?.provider_error ? ` · ${seedanceReadiness.provider_error}` : ""}
              </p>
              {!seedanceReadiness?.provider_configured ? (
                <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700">当前 Provider 未配置，暂不能上传 Seedance 资产。</p>
              ) : null}
              {seedanceReadiness?.upload_registration_available === false ? (
                <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700">当前环境未开放上传注册，请先同步或稍后重试。</p>
              ) : null}

              <label className="grid gap-2 text-sm">
                <span>文件 *</span>
                <Input
                  type="file"
                  accept="image/*,video/*"
                  disabled={seedanceUploadBusy}
                  onChange={(event) => {
                    const file = event.target.files?.[0] || null;
                    setSeedanceUploadFile(file);
                    setSeedanceUploadErrors((current) => ({ ...current, file: undefined, form: undefined }));
                    if (file) {
                      setSeedanceUploadDraft((draft) => ({
                        ...draft,
                        asset_type: file.type.startsWith("video/") ? "Video" : "Image",
                        name: draft.name || file.name,
                      }));
                    }
                  }}
                />
                {seedanceUploadFile ? <small>已选择：{seedanceUploadFile.name}</small> : null}
                {seedanceUploadErrors.file ? <span className="text-sm text-destructive">{seedanceUploadErrors.file}</span> : null}
              </label>

              <label className="grid gap-2 text-sm">
                <span>名称</span>
                <Input
                  value={seedanceUploadDraft.name}
                  onChange={(event) => setSeedanceUploadDraft((draft) => ({ ...draft, name: event.target.value }))}
                  disabled={seedanceUploadBusy}
                  placeholder="可选"
                />
              </label>

              <label className="grid gap-2 text-sm">
                <span>备注</span>
                <Textarea
                  value={seedanceUploadDraft.description}
                  onChange={(event) => setSeedanceUploadDraft((draft) => ({ ...draft, description: event.target.value }))}
                  disabled={seedanceUploadBusy}
                  rows={4}
                  placeholder="可选"
                />
              </label>

              <label className="grid gap-2 text-sm">
                <span>资产类型</span>
                <select
                  value={seedanceUploadDraft.asset_type}
                  onChange={(event) => setSeedanceUploadDraft((draft) => ({ ...draft, asset_type: event.target.value as "Image" | "Video" }))}
                  disabled={seedanceUploadBusy}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="Image">Image</option>
                  <option value="Video">Video</option>
                </select>
              </label>

              <div className="grid gap-2 text-sm">
                <span>标签</span>
                <div className="flex flex-wrap gap-2">
                  {seedanceTags.length ? seedanceTags.map((tag) => {
                    const selected = seedanceUploadDraft.tag_ids.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        className={selected ? "selected" : ""}
                        disabled={seedanceUploadBusy}
                        aria-pressed={selected}
                        onClick={() => setSeedanceUploadDraft((draft) => ({
                          ...draft,
                          tag_ids: selected ? draft.tag_ids.filter((tagId) => tagId !== tag.id) : [...draft.tag_ids, tag.id],
                        }))}
                      >
                        {tag.name}
                      </button>
                    );
                  }) : <span className="text-sm text-muted-foreground">暂无标签，可先创建标签后再绑定。</span>}
                </div>
              </div>

              {seedanceUploadErrors.form ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{seedanceUploadErrors.form}</p> : null}
            </div>

            <DialogFooter>
              <button className="outline-button small" type="button" onClick={() => closeSeedanceUploadDialog()} disabled={seedanceUploadBusy}>
                取消
              </button>
              <button className="vermilion-button" type="button" onClick={() => void submitSeedanceUploadDialog()} disabled={seedanceUploadBusy}>
                {seedanceUploadBusy ? "提交中…" : "上传并注册"}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog
          open={seedanceTagDialogOpen}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              if (seedanceTagDialogBusy) return;
              closeSeedanceTagDialog();
              return;
            }
            setSeedanceTagDialogOpen(true);
          }}
        >
          <DialogContent
            className="sm:max-w-[560px]"
            showCloseButton={!seedanceTagDialogBusy}
            onEscapeKeyDown={(event) => {
              if (seedanceTagDialogBusy) event.preventDefault();
            }}
            onPointerDownOutside={(event) => {
              if (seedanceTagDialogBusy) event.preventDefault();
            }}
            onInteractOutside={(event) => {
              if (seedanceTagDialogBusy) event.preventDefault();
            }}
          >
            <DialogHeader>
              <DialogTitle>新建 Seedance 标签</DialogTitle>
              <DialogDescription>创建后可在素材编辑中选择并绑定到素材。</DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-2">
              <label className="grid gap-2 text-sm">
                <span>名称 *</span>
                <Input
                  value={seedanceTagDialogDraft.name}
                  onChange={(event) => {
                    setSeedanceTagDialogDraft((draft) => ({ ...draft, name: event.target.value }));
                    setSeedanceTagDialogErrors((errors) => ({ ...errors, name: undefined, form: undefined }));
                  }}
                  disabled={seedanceTagDialogBusy}
                  aria-invalid={Boolean(seedanceTagDialogErrors.name)}
                  placeholder="请输入标签名称"
                />
                {seedanceTagDialogErrors.name ? <span className="text-sm text-destructive">{seedanceTagDialogErrors.name}</span> : null}
              </label>

              <label className="grid gap-2 text-sm">
                <span>颜色</span>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={isSeedanceTagColor(seedanceTagDialogDraft.color) ? seedanceTagDialogDraft.color.trim() : seedanceTagDefaultColor}
                    onChange={(event) => {
                      setSeedanceTagDialogDraft((draft) => ({ ...draft, color: event.target.value }));
                      setSeedanceTagDialogErrors((errors) => ({ ...errors, color: undefined, form: undefined }));
                    }}
                    disabled={seedanceTagDialogBusy}
                    className="h-10 w-12 rounded-md border border-input bg-background p-1"
                    aria-label="标签颜色"
                  />
                  <Input
                    value={seedanceTagDialogDraft.color}
                    onChange={(event) => {
                      setSeedanceTagDialogDraft((draft) => ({ ...draft, color: event.target.value }));
                      setSeedanceTagDialogErrors((errors) => ({ ...errors, color: undefined, form: undefined }));
                    }}
                    disabled={seedanceTagDialogBusy}
                    aria-invalid={Boolean(seedanceTagDialogErrors.color)}
                    placeholder={seedanceTagDefaultColor}
                  />
                </div>
                {seedanceTagDialogErrors.color ? <span className="text-sm text-destructive">{seedanceTagDialogErrors.color}</span> : null}
              </label>

              {seedanceTagDialogErrors.form ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{seedanceTagDialogErrors.form}</p> : null}
            </div>

            <DialogFooter>
              <button className="outline-button small" type="button" onClick={() => closeSeedanceTagDialog()} disabled={seedanceTagDialogBusy}>
                取消
              </button>
              <button className="vermilion-button" type="button" onClick={() => void submitSeedanceTagDialog()} disabled={seedanceTagDialogBusy}>
                {seedanceTagDialogBusy ? "提交中…" : "创建标签"}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <AlertDialog open={providerTestConfirmOpen} onOpenChange={setProviderTestConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>测试连接与文本模型</AlertDialogTitle>
              <AlertDialogDescription>本次测试会向当前默认文本模型发送一次 ping，可能产生少量模型费用。</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <button className="vermilion-button" type="button" onClick={() => void runProviderTest()} disabled={busy === "provider-test"}>确认测试</button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <AlertDialog
          open={seedanceTagDeleteOpen}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              if (seedanceTagDeleteBusy) return;
              closeRemoveSeedanceTagDialog();
              return;
            }
            setSeedanceTagDeleteOpen(true);
          }}
        >
          <AlertDialogContent
            onEscapeKeyDown={(event) => {
              if (seedanceTagDeleteBusy) event.preventDefault();
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>删除 Seedance 标签</AlertDialogTitle>
              <AlertDialogDescription>
                {seedanceTagDeleteTarget
                  ? `确认删除「${seedanceTagDeleteTarget.name}」？删除后会解除其与素材的绑定。`
                  : "请选择要删除的标签。"}
              </AlertDialogDescription>
            </AlertDialogHeader>

            {seedanceTagDeleteError ? (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{seedanceTagDeleteError}</p>
            ) : null}

            <AlertDialogFooter>
              <AlertDialogCancel
                disabled={seedanceTagDeleteBusy}
                onClick={(event) => {
                  if (seedanceTagDeleteBusy) event.preventDefault();
                  else closeRemoveSeedanceTagDialog();
                }}
              >
                取消
              </AlertDialogCancel>
              <button
                className="vermilion-button"
                type="button"
                onClick={() => void confirmRemoveSeedanceTag()}
                disabled={seedanceTagDeleteBusy || !seedanceTagDeleteTarget?.id}
              >
                {seedanceTagDeleteBusy ? "删除中…" : "确认删除"}
              </button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Dialog
          open={seedanceEditDialogOpen}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              if (seedanceEditBusy) return;
              closeEditSeedanceAssetDialog();
              return;
            }
            setSeedanceEditDialogOpen(true);
          }}
        >
          <DialogContent
            className="sm:max-w-[760px]"
            showCloseButton={!seedanceEditBusy}
            onEscapeKeyDown={(event) => {
              if (seedanceEditBusy) event.preventDefault();
            }}
            onPointerDownOutside={(event) => {
              if (seedanceEditBusy) event.preventDefault();
            }}
            onInteractOutside={(event) => {
              if (seedanceEditBusy) event.preventDefault();
            }}
          >
            <DialogHeader>
              <DialogTitle>编辑 Seedance 素材</DialogTitle>
              <DialogDescription>
                {seedanceEditTarget
                  ? `正在编辑「${seedanceEditTarget.name}」（${seedanceEditTarget.id}），提交会同步名称、备注与标签。`
                  : "请选择要编辑的 Seedance 素材。"}
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-2">
              <p className="rounded-md bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                {seedanceEditTarget
                  ? `asset_type=${seedanceEditTarget.asset_type} · status=${seedanceEditTarget.status} · source=${seedanceEditTarget.volcano_asset_id || seedanceEditTarget.source_url || "-"}`
                  : "target frozen"}
              </p>

              <label className="grid gap-2 text-sm">
                <span>名称 *</span>
                <Input
                  value={seedanceEditDraft.name}
                  onChange={(event) => setSeedanceEditDraft((draft) => ({ ...draft, name: event.target.value }))}
                  disabled={seedanceEditBusy}
                  placeholder="请输入素材名称"
                />
                {seedanceEditErrors.name ? <span className="text-sm text-destructive">{seedanceEditErrors.name}</span> : null}
              </label>

              <label className="grid gap-2 text-sm">
                <span>备注</span>
                <Textarea
                  value={seedanceEditDraft.description}
                  onChange={(event) => setSeedanceEditDraft((draft) => ({ ...draft, description: event.target.value }))}
                  disabled={seedanceEditBusy}
                  rows={4}
                  placeholder="可选"
                />
              </label>

              <div className="grid gap-2 text-sm">
                <span>标签</span>
                <div className="flex flex-wrap gap-2">
                  {seedanceTags.length ? seedanceTags.map((tag) => {
                    const selected = seedanceEditDraft.tag_ids.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        className={selected ? "selected" : ""}
                        disabled={seedanceEditBusy}
                        aria-pressed={selected}
                        onClick={() => setSeedanceEditDraft((draft) => ({
                          ...draft,
                          tag_ids: selected ? draft.tag_ids.filter((tagId) => tagId !== tag.id) : [...draft.tag_ids, tag.id],
                        }))}
                      >
                        {tag.name}
                      </button>
                    );
                  }) : <span className="text-sm text-muted-foreground">暂无标签，可先创建标签后再绑定。</span>}
                </div>
              </div>

              {seedanceEditErrors.form ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{seedanceEditErrors.form}</p> : null}
            </div>

            <DialogFooter>
              <button className="outline-button small" type="button" onClick={() => closeEditSeedanceAssetDialog()} disabled={seedanceEditBusy}>
                取消
              </button>
              <button className="vermilion-button" type="button" onClick={() => void submitSeedanceEditDialog()} disabled={seedanceEditBusy}>
                {seedanceEditBusy ? "提交中…" : "保存修改"}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <AlertDialog
          open={seedanceDeleteOpen}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              if (seedanceDeleteBusy) return;
              closeRemoveSeedanceAssetDialog();
              return;
            }
            setSeedanceDeleteOpen(true);
          }}
        >
          <AlertDialogContent
            onEscapeKeyDown={(event) => {
              if (seedanceDeleteBusy) event.preventDefault();
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>删除 Seedance 素材</AlertDialogTitle>
              <AlertDialogDescription>
                {seedanceDeleteTarget
                  ? `确认删除「${seedanceDeleteTarget.name}」（${seedanceDeleteTarget.id}）？这会同时请求上游素材库删除该资产。`
                  : "请选择要删除的 Seedance 素材。"}
              </AlertDialogDescription>
            </AlertDialogHeader>

            {seedanceDeleteError ? (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{seedanceDeleteError}</p>
            ) : null}

            <AlertDialogFooter>
              <AlertDialogCancel
                disabled={seedanceDeleteBusy}
                onClick={(event) => {
                  if (seedanceDeleteBusy) event.preventDefault();
                  else closeRemoveSeedanceAssetDialog();
                }}
              >
                取消
              </AlertDialogCancel>
              <button
                className="vermilion-button"
                type="button"
                onClick={() => void confirmRemoveSeedanceAsset()}
                disabled={seedanceDeleteBusy || !seedanceDeleteTarget?.id}
              >
                {seedanceDeleteBusy ? "删除中…" : "确认删除"}
              </button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

function applyPreset(id: string, presets: ModelProviderPreset[], setProviderDraft: Dispatch<SetStateAction<ModelProviderConfig>>) {
  const preset = presets.find((item) => item.id === id);
  if (!preset) {
    setProviderDraft((draft) => ({ ...draft, preset_id: "" }));
    return;
  }
  setProviderDraft((draft) => ({
    ...draft,
    preset_id: preset.id,
    name: draft.id ? draft.name : preset.name,
    provider_type: preset.provider_type,
    mode: preset.mode,
    base_url: preset.base_url,
    auth_type: preset.auth_type,
    custom_auth_header: preset.custom_auth_header,
    auth_query_param: preset.auth_query_param,
    capabilities: preset.capabilities,
    models_by_capability: preset.models_by_capability,
    text_model: preset.defaults.text || draft.text_model,
    image_model: preset.defaults.image || draft.image_model,
    video_model: preset.defaults.video || draft.video_model,
    audio_model: preset.defaults.audio || draft.audio_model,
    endpoint_overrides: preset.endpoint_overrides || {},
    extra_headers: preset.extra_headers || {},
  }));
}

function formatTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatDuration(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 ms";
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)} s`;
}
