import { ChevronLeft, ChevronRight, Copy, Film, History, Image as ImageIcon, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
  preferredNodeId?: string;
  formatModel?: (model: string, kind: CanvasGenerationHistoryKind) => string;
  onOpenChange: (open: boolean) => void;
  onApply: (nodeId: string) => void;
};

const MONTH_WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"] as const;

function cloneDecodedImageSrc(src: string) {
  if (!src || typeof document === "undefined") return "";
  const live = Array.from(document.images).find((img) => (
    img.src === src
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
}: {
  url: string;
  kind: CanvasGenerationHistoryKind;
  alt?: string;
  videoControls?: boolean;
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
  if (failed) {
    return <span>{kind === "video" ? <Film size={videoControls ? 28 : 18} /> : <ImageIcon size={videoControls ? 28 : 18} />}</span>;
  }
  if (kind === "video") {
    return (
      <video
        src={src}
        controls={videoControls}
        muted={!videoControls}
        playsInline
        preload="metadata"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <img
      src={src}
      alt={alt}
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
  onSelect,
}: {
  item: CanvasGenerationHistoryItem;
  active: boolean;
  onSelect: (nodeId: string) => void;
}) {
  return (
    <button
      type="button"
      className={active ? "selected" : ""}
      title={item.title}
      onClick={() => onSelect(item.nodeId)}
    >
      <HistoryMedia url={item.previewUrl} kind={item.kind} />
      <em>{formatCanvasGenerationClock(item.generatedAt) || "--:--:--"}</em>
    </button>
  );
}

export function CanvasGenerationHistoryDialog({
  open,
  items,
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
        <div className="canvas-generation-history-shell">
          <aside className="canvas-generation-history-detail">
            {selected ? (
              <>
                <div className="canvas-generation-history-hero">
                  <HistoryMedia url={selected.previewUrl} kind={selected.kind} alt="" videoControls={selected.kind === "video"} />
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
                <button className="vermilion-button" type="button" onClick={() => onApply(selected.nodeId)}>
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
                              onSelect={setSelectedId}
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
                              {cover ? <HistoryMedia url={cover.previewUrl} kind={cover.kind} /> : null}
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
                          onSelect={setSelectedId}
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
