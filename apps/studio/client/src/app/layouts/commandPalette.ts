import type { WorkspaceScope } from "@/shared/config";

/** 远程检索每组最多展示条数，避免面板过长 */
export const COMMAND_PALETTE_RESULT_LIMIT = 8;
/** 输入后等待再打远程接口，减少每个按键都请求 */
export const COMMAND_PALETTE_SEARCH_DELAY_MS = 250;
/** 关键词接口无结果时，回退扫描的最近资产数量 */
export const COMMAND_PALETTE_ASSET_FALLBACK_LIMIT = 30;

export type StudioCommandPage = {
  id: string;
  group: string;
  label: string;
  href: string;
  keywords: string[];
  adminOnly?: boolean;
};

export const studioCommandPages: StudioCommandPage[] = [
  { id: "dashboard", group: "制作桌", label: "工作台", href: "/dashboard", keywords: ["今日片场", "主页"] },
  { id: "chat", group: "制作桌", label: "剧本创作", href: "/chat", keywords: ["脚本", "对话"] },
  { id: "projects", group: "制作桌", label: "全部项目", href: "/projects", keywords: ["画布项目"] },
  { id: "canvas", group: "制作桌", label: "画布工坊", href: "/canvas", keywords: ["无限画布"] },
  { id: "director", group: "制作桌", label: "3D 导演台", href: "/director", keywords: ["三维"] },
  { id: "comic-assets", group: "制作桌", label: "漫剧资产助手", href: "/comic-assets", keywords: ["漫剧"] },
  { id: "image", group: "素材与语言", label: "关键帧生成", href: "/image", keywords: ["生图", "图片创作"] },
  { id: "video", group: "素材与语言", label: "视频生成", href: "/video", keywords: ["视频创作"] },
  { id: "assets", group: "素材与语言", label: "资产库", href: "/assets", keywords: ["素材", "library"] },
  { id: "tags", group: "素材与语言", label: "标签库", href: "/tags", keywords: ["taxonomy"] },
  { id: "prompts", group: "素材与语言", label: "提示词库", href: "/prompts", keywords: ["prompt"] },
  { id: "skills", group: "素材与语言", label: "技能库", href: "/skills", keywords: ["指令"] },
  { id: "profile", group: "系统", label: "个人主页", href: "/profile", keywords: ["账号"] },
  { id: "queue", group: "系统", label: "渲染队列", href: "/queue", keywords: ["任务"] },
  { id: "settings", group: "系统", label: "偏好设置", href: "/settings", keywords: ["配置"] },
  { id: "admin", group: "系统", label: "管理后台", href: "/admin", keywords: ["用户", "模型"], adminOnly: true },
];

const scopedPagePrefixes = [
  "/assets",
  "/image",
  "/tags",
  "/projects",
  "/canvas",
  "/video",
  "/comic-assets",
];

export function workspaceScopeFromSearch(search: string): WorkspaceScope {
  return new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("scope") === "team"
    ? "team"
    : "personal";
}

export function withWorkspaceScope(href: string, scope: WorkspaceScope) {
  const [path, existingQuery = ""] = href.split("?");
  if (!scopedPagePrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    return href;
  }
  const params = new URLSearchParams(existingQuery);
  params.set("scope", scope);
  return `${path}?${params.toString()}`;
}

export function matchStudioCommandPages(
  pages: readonly StudioCommandPage[],
  query: string,
  options: { includeAdmin?: boolean } = {},
) {
  const visible = pages.filter((page) => options.includeAdmin || !page.adminOnly);
  const needle = query.trim().toLowerCase();
  if (!needle) return visible;
  return visible.filter((page) =>
    [page.label, page.group, page.href, ...page.keywords].some((part) => part.toLowerCase().includes(needle)),
  );
}

export function projectListFrom(value: unknown): Array<{ id: string; title: string }> {
  if (Array.isArray(value)) {
    return value.filter(isNamedRecord);
  }
  if (value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)) {
    return (value as { items: unknown[] }).items.filter(isNamedRecord);
  }
  return [];
}

export function filterNamedRecords<T extends { title?: string; name?: string }>(
  items: readonly T[],
  query: string,
) {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...items];
  return items.filter((item) => {
    const title = (item.title || item.name || "").toLowerCase();
    return title.includes(needle);
  });
}

export function promptItemsFrom(value: unknown): Array<{ id: string; title: string; category?: string }> {
  if (!value || typeof value !== "object") return [];
  const record = value as { items?: unknown; data?: { items?: unknown } };
  const raw = Array.isArray(record.items)
    ? record.items
    : Array.isArray(record.data?.items)
      ? record.data.items
      : [];
  return raw.filter((item): item is { id: string; title: string; category?: string } => {
    if (!item || typeof item !== "object") return false;
    const entry = item as { id?: unknown; title?: unknown };
    return typeof entry.id === "string" && typeof entry.title === "string";
  });
}

function isNamedRecord(value: unknown): value is { id: string; title: string } {
  if (!value || typeof value !== "object") return false;
  const record = value as { id?: unknown; title?: unknown };
  return typeof record.id === "string" && typeof record.title === "string";
}
