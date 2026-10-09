import { VideoThumbnail, videoPosterUrl } from "@/shared/ui/VideoThumbnail";
import { RetryImage } from "@/shared/ui/RetryImage";
import { Check, ChevronLeft, ChevronRight, Copy, Film, History, Image as ImageIcon, Plus, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  buildCanvasGenerationHistoryMonth,
  canvasGenerationHistoryDayKey,
  canvasGenerationHistoryDayLabel,
  canvasGenerationHistoryMonthFromIso,
  canvasGenerationHistoryMonthLabel,
  formatCanvasGenerationClock,
  formatCanvasGenerationDateTime,
  groupCanvasGenerationHistory,
  shiftCanvasGenerationHistoryMonth,
  type CanvasGenerationHistoryItem,
  type CanvasGenerationHistoryKind,
  type CanvasGenerationHistoryView,
} from "@/features/canvas/domain/generationHistory";

export type CanvasGenerationHistoryDialogProps = {
  open: boolean;
  items: CanvasGenerationHistoryItem[];
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  preferredNodeId?: string;
  formatModel?: (model: string, kind: CanvasGenerationHistoryKind) => string;
  onOpenChange: (open: boolean) => void;
  onApply: (nodeId: string) => void;
};

const MONTH_WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"] as const;
// Cached previews reload instantly, so the refresh button keeps visible feedback for a moment.
const HISTORY_REFRESH_SPIN_MS = 700;
// How long the "已刷新" confirmation stays before the button returns to idle.
const HISTORY_REFRESH_DONE_MS = 1500;

function cloneDecodedImageSrc(src: string) {
  if (!src || typeof document === "undefined") return "";
  // naturalWidth is known once the header arrives; copying before `complete` yields a black frame.
  const live = Array.from(document.images).find((img) => (
    img.src === src
    && img.complete
    && img.naturalWidth > 0
    && !img.closest(".canvas-generation-history-dialog")
  ));
  if (!live) return "";
  try {
    const canvas = document.createElement("canvas");
    canvas.width = live.naturalWidth;
    canvas.height = live.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.drawImage(live, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.82);
  } catch {
    return "";
  }
}

function HistoryMedia({
  url,
  kind,
  alt = "",
  videoControls = false,
  detailed = false,
  onFailed,
  onRetry,
}: {
  url: string;
  kind: CanvasGenerationHistoryKind;
  alt?: string;
  videoControls?: boolean;
  /** The large preview explains the failure and offers a manual reload. */
  detailed?: boolean;
  onFailed?: (url: string) => void;
  onRetry?: () => void;
}) {
  const [src, setSrc] = useState(url);
  const [failed, setFailed] = useState(!url);
  useEffect(() => {
    if (!url) {
      setSrc("");
      setFailed(true);
      return;
    }
    setSrc(cloneDecodedImageSrc(url) || url);
    setFailed(false);
  }, [url]);
  useEffect(() => {
    if (failed) onFailed?.(url);
  }, [failed, onFailed, url]);
  if (failed) {
    const Icon = kind === "video" ? Film : ImageIcon;
    return (
      <span className="canvas-generation-history-unavailable">
        <Icon size={detailed ? 28 : 18} />
        <b>{kind === "video" ? "视频" : "图片"}无法加载</b>
        {detailed ? <small>原文件可能已删除，或暂时无法访问</small> : null}
        {detailed && onRetry ? (
          <button type="button" onClick={onRetry}>
            <RotateCcw size={12} />
            重新加载
          </button>
        ) : null}
      </span>
    );
  }
  if (kind === "video") {
    if (!videoControls) return <VideoThumbnail src={src} alt={alt || "视频封面"} />;
    return (
      <video
        src={src}
        controls={videoControls}
        muted={!videoControls}
        playsInline
        preload="none"
        poster={videoPosterUrl(src)}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <RetryImage
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => {
        const cloned = src === url ? cloneDecodedImageSrc(url) : "";
        if (cloned) {
          setSrc(cloned);
          return;
        }
        setFailed(true);
      }}
    />
  );
}

function HistoryThumb({
  item,
  active,
  retryRevision,
  onSelect,
  onFailed,
}: {
  item: CanvasGenerationHistoryItem;
  active: boolean;
  retryRevision: number;
  onSelect: (nodeId: string) => void;
  onFailed: (url: string) => void;
}) {
  return (
    <button
      type="button"
      className={active ? "selected" : ""}
      title={item.title}
      onClick={() => onSelect(item.nodeId)}
    >
      <HistoryMedia key={retryRevision} url={item.previewUrl} kind={item.kind} onFailed={onFailed} />
      <em>{formatCanvasGenerationClock(item.generatedAt) || "--:--:--"}</em>
    </button>
  );
}

export function CanvasGenerationHistoryDialog({
  open,
  items,
  loading,
  error,
  onRetry,
  preferredNodeId = "",
  formatModel,
  onOpenChange,
  onApply,
}: CanvasGenerationHistoryDialogProps) {
  const [kind, setKind] = useState<CanvasGenerationHistoryKind>("image");
  const [viewMode, setViewMode] = useState<CanvasGenerationHistoryView>("tile");
  const [selectedId, setSelectedId] = useState("");
  const [monthDayKey, setMonthDayKey] = useState("");
  const [monthCursor, setMonthCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), monthIndex: now.getMonth() };
  });
  const appliedOpen = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [failedUrls, setFailedUrls] = useState<ReadonlySet<string>>(() => new Set());
  const [retryRevision, setRetryRevision] = useState(0);
  const markFailed = useCallback((url: string) => {
    setFailedUrls(current => current.has(url) ? current : new Set(current).add(url));
  }, []);
  const retryFailedMedia = () => {
    setFailedUrls(new Set());
    setRetryRevision(value => value + 1);
  };
  const [refreshState, setRefreshState] = useState<"idle" | "refreshing" | "done">("idle");
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(refreshTimer.current), []);
  const refreshAllMedia = () => {
    clearTimeout(refreshTimer.current);
    retryFailedMedia();
    setRefreshState("refreshing");
    refreshTimer.current = setTimeout(() => {
      setRefreshState("done");
      refreshTimer.current = setTimeout(() => setRefreshState("idle"), HISTORY_REFRESH_DONE_MS);
    }, HISTORY_REFRESH_SPIN_MS);
  };
  const refreshLabel = refreshState === "refreshing"
    ? "刷新中…"
    : failedUrls.size
      ? `${failedUrls.size} 项${refreshState === "done" ? "仍无法显示 · 重试" : "未显示 · 刷新"}`
      : refreshState === "done" ? "已刷新" : "刷新";
  const groups = useMemo(() => groupCanvasGenerationHistory(items, kind), [items, kind]);
  const visibleItems = useMemo(() => groups.flatMap(group => group.items), [groups]);
  const selected = visibleItems.find(item => item.nodeId === selectedId) || visibleItems[0];
  const monthWeeks = useMemo(
    () => buildCanvasGenerationHistoryMonth(visibleItems, monthCursor.year, monthCursor.monthIndex),
    [monthCursor.monthIndex, monthCursor.year, visibleItems],
  );
  const monthDayItems = useMemo(
    () => monthDayKey ? visibleItems.filter((item) => canvasGenerationHistoryDayKey(item.generatedAt) === monthDayKey) : [],
    [monthDayKey, visibleItems],
  );

  useEffect(() => {
    if (!open) {
      appliedOpen.current = false;
      setMonthDayKey("");
      setFailedUrls(new Set());
      clearTimeout(refreshTimer.current);
      setRefreshState("idle");
      return;
    }
    const preferred = items.find(item => item.nodeId === preferredNodeId);
    if (!appliedOpen.current) {
      if (preferred) setKind(preferred.kind);
      const nextKind = preferred?.kind || kind;
      const nextVisible = items.filter(item => item.kind === nextKind);
      setSelectedId(preferred && preferred.kind === nextKind
        ? preferred.nodeId
        : (nextVisible[0]?.nodeId || ""));
      appliedOpen.current = true;
      return;
    }
    setSelectedId((current) => {
      const ids = new Set(visibleItems.map((item) => item.nodeId));
      if (ids.has(current)) return current;
      return visibleItems[0]?.nodeId || "";
    });
  }, [items, kind, open, preferredNodeId, visibleItems]);

  useEffect(() => {
    if (!open) return;
    scrollRef.current?.scrollTo({ top: 0 });
  }, [kind, monthDayKey, open, viewMode]);

  useEffect(() => {
    if (!open || viewMode !== "month") return;
    const source = selected?.generatedAt || visibleItems[0]?.generatedAt;
    if (!source) return;
    setMonthCursor(canvasGenerationHistoryMonthFromIso(source));
  }, [open, viewMode]);

  const modelLabel = selected
    ? (formatModel?.(selected.model, selected.kind) || selected.model || "—")
    : "—";
  // Applying media that cannot load would only place a broken node on the canvas.
  const selectedUnavailable = !selected?.previewUrl || failedUrls.has(selected.previewUrl);

  const copySeed = async () => {
    if (!selected?.seed) return;
    try {
      await navigator.clipboard.writeText(selected.seed);
    } catch {
      /* ignore clipboard failures */
    }
  };

  const selectedDayKey = selected ? canvasGenerationHistoryDayKey(selected.generatedAt) : "";

  const setHistoryView = (next: CanvasGenerationHistoryView) => {
    setViewMode(next);
    if (next !== "month") setMonthDayKey("");
  };

  const openMonthDay = (isoDate: string, itemsForDay: CanvasGenerationHistoryItem[]) => {
    const next = itemsForDay.find((item) => item.nodeId === selectedId) || itemsForDay[0];
    if (!next) return;
    setSelectedId(next.nodeId);
    setMonthDayKey(isoDate);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 gap-0 overflow-hidden sm:max-w-[1100px] canvas-generation-history-dialog" showCloseButton>
        <DialogHeader className="sr-only">
          <DialogTitle>生成历史</DialogTitle>
          <DialogDescription>查看当前画布内的图片和视频生成记录。</DialogDescription>
        </DialogHeader>
        {loading && <p role="status" className="px-4 py-2 text-sm">正在读取服务端视频历史…</p>}
        {error && <p role="alert" className="px-4 py-2 text-sm">{error} <button type="button" onClick={onRetry}>重试</button></p>}
        <div className="canvas-generation-history-shell">
          <aside className="canvas-generation-history-detail">
            {selected ? (
              <>
                <div className="canvas-generation-history-hero">
                  <HistoryMedia
                    key={retryRevision}
                    url={selected.previewUrl}
                    kind={selected.kind}
                    alt=""
                    videoControls={selected.kind === "video"}
                    detailed
                    onFailed={markFailed}
                    onRetry={selected.previewUrl ? retryFailedMedia : undefined}
                  />
                </div>
                <dl>
                  <div>
                    <dt>任务 ID</dt>
                    <dd>
                      <b title={selected.seed}>{selected.seed}</b>
                      <button type="button" title="复制" onClick={() => void copySeed()}>
                        <Copy size={12} />
                      </button>
                    </dd>
                  </div>
                  <div>
                    <dt>类型</dt>
                    <dd className="accent">{selected.typeLabel}</dd>
                  </div>
                  <div>
                    <dt>生成时间</dt>
                    <dd>{formatCanvasGenerationDateTime(selected.generatedAt)}</dd>
                  </div>
                  <div>
                    <dt>生成模型</dt>
                    <dd>{modelLabel}</dd>
                  </div>
                  <div>
                    <dt>方式</dt>
                    <dd className="accent">{selected.modeLabel}</dd>
                  </div>
                  {selected.size ? (
                    <div>
                      <dt>尺寸</dt>
                      <dd>{selected.size}</dd>
                    </div>
                  ) : null}
                  {selected.kind === "video" && selected.seconds ? (
                    <div>
                      <dt>时长</dt>
                      <dd>{selected.seconds}s</dd>
                    </div>
                  ) : null}
                </dl>
                <label>
                  <span>提示词</span>
                  <textarea readOnly value={selected.prompt} />
                </label>
                <button
                  className="vermilion-button"
                  type="button"
                  disabled={selectedUnavailable}
                  title={selectedUnavailable ? `${selected.kind === "video" ? "视频" : "图片"}无法加载，暂不能应用到画布` : undefined}
                  onClick={() => onApply(selected.nodeId)}
                >
                  <Plus size={14} />
                  应用到画布
                </button>
              </>
            ) : (
              <div className="canvas-generation-history-empty">
                <History size={26} />
                <p>选择一条生成记录查看详情</p>
              </div>
            )}
          </aside>
          <section className="canvas-generation-history-gallery">
            <div className="canvas-generation-history-toolbar">
              <div className="scope-switch">
                <button type="button" className={kind === "image" ? "active" : ""} onClick={() => setKind("image")}>
                  图片
                </button>
                <button type="button" className={kind === "video" ? "active" : ""} onClick={() => setKind("video")}>
                  视频
                </button>
              </div>
              <div className="canvas-generation-history-actions">
                <button
                  type="button"
                  className={[
                    "canvas-generation-history-refresh",
                    failedUrls.size ? "has-failures" : "",
                    refreshState === "refreshing" ? "is-refreshing" : "",
                    refreshState === "done" && !failedUrls.size ? "is-done" : "",
                  ].filter(Boolean).join(" ")}
                  title="重新加载全部预览"
                  disabled={refreshState === "refreshing"}
                  aria-live="polite"
                  onClick={refreshAllMedia}
                >
                  {refreshState === "done" && !failedUrls.size ? <Check size={13} /> : <RotateCcw size={13} />}
                  {refreshLabel}
                </button>
                <div className="canvas-generation-history-views" role="tablist" aria-label="查看方式">
                  <button
                    type="button"
                    className={viewMode === "tile" ? "active" : ""}
                    aria-pressed={viewMode === "tile"}
                    onClick={() => setHistoryView("tile")}
                  >
                    平铺
                  </button>
                  <button
                    type="button"
                    className={viewMode === "day" ? "active" : ""}
                    aria-pressed={viewMode === "day"}
                    onClick={() => setHistoryView("day")}
                  >
                    日
                  </button>
                  <button
                    type="button"
                    className={viewMode === "month" ? "active" : ""}
                    aria-pressed={viewMode === "month"}
                    onClick={() => {
                      setHistoryView("month");
                      setMonthDayKey("");
                    }}
                  >
                    月
                  </button>
                </div>
              </div>
            </div>
            <div className="canvas-generation-history-scroll" ref={scrollRef}>
              {!visibleItems.length ? (
                <div className="canvas-generation-history-empty">
                  <History size={26} />
                  <p>{kind === "video" ? "当前画布还没有视频生成记录" : "当前画布还没有图片生成记录"}</p>
                </div>
              ) : viewMode === "month" ? (
                <div className="canvas-generation-history-month">
                  {monthDayKey ? (
                    <>
                      <div className="canvas-generation-history-month-nav day-open">
                        <button type="button" onClick={() => setMonthDayKey("")}>
                          <ChevronLeft size={16} />
                          返回
                        </button>
                        <b>{monthDayItems[0] ? canvasGenerationHistoryDayLabel(monthDayItems[0].generatedAt) : monthDayKey}</b>
                      </div>
                      {monthDayItems.length ? (
                        <div className="canvas-generation-history-grid">
                          {monthDayItems.map((item) => (
                            <HistoryThumb
                              key={item.nodeId}
                              item={item}
                              active={selected?.nodeId === item.nodeId}
                              retryRevision={retryRevision}
                              onSelect={setSelectedId}
                              onFailed={markFailed}
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="canvas-generation-history-empty">
                          <History size={26} />
                          <p>这一天没有{kind === "video" ? "视频" : "图片"}记录</p>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="canvas-generation-history-month-nav">
                        <button
                          type="button"
                          title="上个月"
                          onClick={() => setMonthCursor((current) => shiftCanvasGenerationHistoryMonth(current.year, current.monthIndex, -1))}
                        >
                          <ChevronLeft size={16} />
                        </button>
                        <b>{canvasGenerationHistoryMonthLabel(monthCursor.year, monthCursor.monthIndex)}</b>
                        <button
                          type="button"
                          title="下个月"
                          onClick={() => setMonthCursor((current) => shiftCanvasGenerationHistoryMonth(current.year, current.monthIndex, 1))}
                        >
                          <ChevronRight size={16} />
                        </button>
                      </div>
                      <div className="canvas-generation-history-month-grid">
                        {MONTH_WEEKDAYS.map((label) => (
                          <span key={label}>{label}</span>
                        ))}
                        {monthWeeks.flatMap((week) => week.map((cell) => {
                          const active = Boolean(selectedDayKey && cell.isoDate === selectedDayKey);
                          const cover = cell.items.find((item) => item.nodeId === selectedId) || cell.items[0];
                          const count = cell.items.length;
                          return (
                            <button
                              key={cell.key}
                              type="button"
                              className={[
                                cell.inMonth ? "" : "muted",
                                count ? "has-items" : "",
                                active ? "selected" : "",
                              ].filter(Boolean).join(" ")}
                              disabled={!count}
                              title={count
                                ? `查看当天 ${count} ${kind === "video" ? "个视频" : "张图片"}`
                                : undefined}
                              onClick={() => openMonthDay(cell.isoDate, cell.items)}
                            >
                              <b>{cell.day}</b>
                              {cover ? <HistoryMedia key={retryRevision} url={cover.previewUrl} kind={cover.kind} onFailed={markFailed} /> : null}
                              {count > 1 ? <i>{count}</i> : null}
                            </button>
                          );
                        }))}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                groups.map((group) => (
                  <div
                    key={group.key}
                    className={viewMode === "day" ? "canvas-generation-history-agenda" : "canvas-generation-history-group"}
                  >
                    <h3>{group.label}</h3>
                    <div className="canvas-generation-history-grid">
                      {group.items.map((item) => (
                        <HistoryThumb
                          key={item.nodeId}
                          item={item}
                          active={selected?.nodeId === item.nodeId}
                          retryRevision={retryRevision}
                          onSelect={setSelectedId}
                          onFailed={markFailed}
                        />
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
