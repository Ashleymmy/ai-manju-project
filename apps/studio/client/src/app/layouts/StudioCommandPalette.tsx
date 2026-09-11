import { Compass, FileText, FolderKanban, Image as ImageIcon, Loader2, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";

import { useAuth } from "@/contexts/AuthContext";
import { getAssetLibrary, type Asset } from "@/entities/asset";
import { getProjects } from "@/entities/project";
import { getPromptLibrary, type SystemPrompt } from "@/entities/prompt";
import { publicApiError } from "@/shared/api/errors";

import {
  COMMAND_PALETTE_ASSET_FALLBACK_LIMIT,
  COMMAND_PALETTE_RESULT_LIMIT,
  COMMAND_PALETTE_SEARCH_DELAY_MS,
  filterNamedRecords,
  matchStudioCommandPages,
  projectListFrom,
  promptItemsFrom,
  studioCommandPages,
  withWorkspaceScope,
  workspaceScopeFromSearch,
} from "./commandPalette";

type PaletteRow = {
  group: string;
  hint: string;
  href: string;
  id: string;
  title: string;
};

export function StudioCommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState("");
  const [projects, setProjects] = useState<Array<{ id: string; title: string }>>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [prompts, setPrompts] = useState<SystemPrompt[]>([]);
  const includeAdmin = user?.role === "super_admin";
  const scope = workspaceScopeFromSearch(window.location.search);
  const pages = useMemo(
    () => matchStudioCommandPages(studioCommandPages, query, { includeAdmin }),
    [includeAdmin, query],
  );
  const rows = useMemo<PaletteRow[]>(() => {
    const pageRows = pages.map((page) => ({
      id: `page:${page.id}`,
      group: page.group,
      title: page.label,
      hint: "页面",
      href: withWorkspaceScope(page.href, scope),
    }));
    if (!query.trim()) return pageRows;
    return [
      ...pageRows,
      ...projects.map((project) => ({
        id: `project:${project.id}`,
        group: "项目",
        title: project.title || "未命名画布",
        hint: "打开画布",
        href: withWorkspaceScope(`/canvas/${encodeURIComponent(project.id)}`, scope),
      })),
      ...assets.map((asset) => ({
        id: `asset:${asset.id}`,
        group: "资产",
        title: asset.name,
        hint: asset.type === "video" ? "视频" : asset.type === "audio" ? "音频" : "图片",
        href: withWorkspaceScope(`/assets?asset=${encodeURIComponent(asset.id)}`, scope),
      })),
      ...prompts.map((prompt) => ({
        id: `prompt:${prompt.id}`,
        group: "提示词",
        title: prompt.title,
        hint: prompt.category || "系统库",
        href: "/prompts",
      })),
    ];
  }, [assets, pages, projects, prompts, query, scope]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    setProjects([]);
    setAssets([]);
    setPrompts([]);
    setRemoteError("");
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [rows.length, query]);

  useEffect(() => {
    if (!open) return;
    const keyword = query.trim();
    if (!keyword) {
      setRemoteLoading(false);
      setRemoteError("");
      setProjects([]);
      setAssets([]);
      setPrompts([]);
      return;
    }
    setRemoteLoading(true);
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void (async () => {
        const [projectResult, assetResult, promptResult] = await Promise.allSettled([
          getProjects(scope),
          getAssetLibrary(scope, {
            keyword,
            pageSize: COMMAND_PALETTE_RESULT_LIMIT,
            sort: "created_at_desc",
          }, controller.signal),
          getPromptLibrary(1, COMMAND_PALETTE_RESULT_LIMIT, { keyword }),
        ]);
        if (controller.signal.aborted) return;
        let nextAssets = assetResult.status === "fulfilled" ? assetResult.value.items || [] : [];
        if (!nextAssets.length && !controller.signal.aborted) {
          try {
            const fallback = await getAssetLibrary(scope, {
              pageSize: COMMAND_PALETTE_ASSET_FALLBACK_LIMIT,
              sort: "created_at_desc",
            }, controller.signal);
            nextAssets = filterNamedRecords(fallback.items || [], keyword);
          } catch {
            nextAssets = [];
          }
        }
        if (controller.signal.aborted) return;
        const nextProjects = projectResult.status === "fulfilled"
          ? filterNamedRecords(projectListFrom(projectResult.value), keyword)
          : [];
        const nextPrompts = promptResult.status === "fulfilled" ? promptItemsFrom(promptResult.value) : [];
        setProjects(nextProjects.slice(0, COMMAND_PALETTE_RESULT_LIMIT));
        setAssets(nextAssets.slice(0, COMMAND_PALETTE_RESULT_LIMIT));
        setPrompts(nextPrompts.slice(0, COMMAND_PALETTE_RESULT_LIMIT) as SystemPrompt[]);
        const allFailed = projectResult.status === "rejected"
          && assetResult.status === "rejected"
          && promptResult.status === "rejected";
        setRemoteError(allFailed ? publicApiError(assetResult.reason, "检索失败") : "");
      })()
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setProjects([]);
          setAssets([]);
          setPrompts([]);
          setRemoteError(publicApiError(error, "检索失败"));
        })
        .finally(() => {
          if (!controller.signal.aborted) setRemoteLoading(false);
        });
    }, COMMAND_PALETTE_SEARCH_DELAY_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, query, scope]);

  const go = (href: string) => {
    onOpenChange(false);
    navigate(href);
  };

  const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onOpenChange(false);
      return;
    }
    if (!rows.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % rows.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + rows.length) % rows.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const target = rows[activeIndex];
      if (target) go(target.href);
    }
  };

  if (!open) return null;

  const groups = rows.reduce<Array<{ name: string; items: PaletteRow[] }>>((list, row) => {
    const last = list[list.length - 1];
    if (last?.name === row.group) last.items.push(row);
    else list.push({ name: row.group, items: [row] });
    return list;
  }, []);

  return createPortal(
    <div className="studio-command" role="presentation" onClick={() => onOpenChange(false)}>
      <div
        className="studio-command-panel"
        role="dialog"
        aria-modal="true"
        aria-label="检索工作桌"
        onClick={(event) => event.stopPropagation()}
      >
        <label className="studio-command-input">
          <Search size={16} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="搜索页面、项目、资产、提示词"
            aria-label="搜索页面、项目、资产、提示词"
          />
          {remoteLoading ? <Loader2 className="spin" size={14} /> : null}
        </label>
        <div className="studio-command-list">
          {remoteError ? <p className="studio-command-empty">{remoteError}</p> : null}
          {!remoteError && remoteLoading && !rows.length ? <p className="studio-command-empty">正在检索…</p> : null}
          {!remoteError && !remoteLoading && !rows.length ? (
            <p className="studio-command-empty">{query.trim() ? "没有匹配的结果" : "输入关键词开始检索"}</p>
          ) : null}
          {groups.map((group) => (
            <section key={group.name}>
              <p className="studio-command-group">{group.name}</p>
              {group.items.map((row) => {
                const index = rows.findIndex((item) => item.id === row.id);
                const Icon = row.group === "项目"
                  ? FolderKanban
                  : row.group === "提示词"
                    ? FileText
                    : row.group === "资产"
                      ? ImageIcon
                      : Compass;
                return (
                  <button
                    key={row.id}
                    type="button"
                    className={index === activeIndex ? "is-active" : undefined}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => go(row.href)}
                  >
                    <Icon size={15} />
                    <span>{row.title}</span>
                    <small>{row.hint}</small>
                  </button>
                );
              })}
            </section>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
