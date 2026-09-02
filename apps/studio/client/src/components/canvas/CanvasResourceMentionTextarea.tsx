import {
  Crosshair,
  Eye,
  FileText,
  Image as ImageIcon,
  Music2,
  Video,
} from "lucide-react";
import { createPortal } from "react-dom";
import {
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";

import { getAssetContentObjectUrl } from "@/services/api";
import {
  applyCanvasMentionEditorEdit,
  buildCanvasMentionEditorModel,
  canvasMentionEditorSpacer,
  canvasMentionToken,
  filterCanvasMentionReferences,
  matchCanvasMentionTrigger,
  serializeCanvasMentionEditorValue,
  splitCanvasMentionEditorDisplay,
  type CanvasMentionEditorSegment,
  type CanvasMentionReference,
} from "@/features/canvas/domain/mentions";

type Props = Omit<ComponentProps<"textarea">, "onChange" | "value"> & {
  value: string;
  references: CanvasMentionReference[];
  onChange: (value: string) => void;
  onMentionQueryChange?: (query: string) => void;
  onSubmit?: () => void;
  containerClassName?: string;
  /** 返回引用对应的缩略图 URL（画布节点读预览缓存；返回空时资产库图片会按需拉取） */
  thumbnailForReference?: (reference: CanvasMentionReference) => string;
  /** 点击已插入的引用 chip / 菜单项的"详情"按钮 */
  onPreviewReference?: (reference: CanvasMentionReference) => void;
  /** 点击菜单项的"定位"按钮（仅画布内节点会显示） */
  onLocateReference?: (reference: CanvasMentionReference) => void;
};

/** 资产库图片缩略图的会话级缓存：assetScope:assetId -> objectURL（菜单反复开合不重复拉取） */
const mentionAssetThumbCache = new Map<string, string>();

function isReadableThumbSource(value: string) {
  return /^(data:|blob:|https?:\/\/|\/)/i.test(value.trim());
}

export const CanvasResourceMentionTextarea = forwardRef<
  HTMLTextAreaElement,
  Props
>(function CanvasResourceMentionTextarea(
  {
    value,
    references,
    onChange,
    onMentionQueryChange,
    containerClassName,
    className,
    onKeyDown,
    onSubmit,
    thumbnailForReference,
    onPreviewReference,
    onLocateReference,
    ...props
  },
  forwardedRef
) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const editorValueRef = useRef("");
  const editorSegmentsRef = useRef<CanvasMentionEditorSegment[]>([]);
  const emittedValueRef = useRef<string | null>(null);
  const [mention, setMention] = useState<{
    start: number;
    query: string;
  } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const candidates = useMemo(
    () =>
      mention ? filterCanvasMentionReferences(references, mention.query) : [],
    [mention, references]
  );
  const editorModel = useMemo(
    () => buildCanvasMentionEditorModel(value, references),
    [references, value]
  );
  const [editorValue, setEditorValue] = useState(
    () => editorModel.displayValue
  );
  const [editorSegments, setEditorSegments] = useState<
    CanvasMentionEditorSegment[]
  >(() => editorModel.segments);
  if (!editorValueRef.current && editorModel.displayValue) {
    editorValueRef.current = editorModel.displayValue;
    editorSegmentsRef.current = editorModel.segments;
  }
  const referenceByKey = useMemo(
    () => new Map(references.map(reference => [reference.key, reference])),
    [references]
  );
  const parts = useMemo(
    () =>
      splitCanvasMentionEditorDisplay(editorValue, editorSegments, references),
    [editorSegments, editorValue, references]
  );
  const [displayWidths, setDisplayWidths] = useState<Record<string, number>>(
    {}
  );

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !editorValue) return;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const computed = getComputedStyle(textarea);
    ctx.font = `${computed.fontWeight} ${computed.fontSize} ${computed.fontFamily}`;
    const next: Record<string, number> = {};
    editorSegments.forEach(segment => {
      next[segment.key] = Math.ceil(
        ctx.measureText(editorValue.slice(segment.start, segment.end)).width
      );
    });
    setDisplayWidths(next);
  }, [editorSegments, editorValue, references]);

  useEffect(() => {
    if (emittedValueRef.current === value) {
      emittedValueRef.current = null;
      return;
    }
    const currentSegments = editorSegmentsRef.current;
    const modelUnchanged =
      editorValueRef.current === editorModel.displayValue &&
      currentSegments.length === editorModel.segments.length &&
      currentSegments.every((segment, index) => {
        const next = editorModel.segments[index];
        return (
          segment.start === next.start &&
          segment.end === next.end &&
          segment.key === next.key &&
          segment.token === next.token
        );
      });
    if (modelUnchanged) return;
    editorValueRef.current = editorModel.displayValue;
    editorSegmentsRef.current = editorModel.segments;
    setEditorValue(editorModel.displayValue);
    setEditorSegments(editorModel.segments);
  }, [editorModel.displayValue, editorModel.segments, value]);

  useEffect(() => {
    editorValueRef.current = editorValue;
  }, [editorValue]);

  const closeMention = () => {
    setMention(null);
    setActiveIndex(0);
  };

  const syncMention = (nextValue: string, cursor: number) => {
    if (
      editorSegmentsRef.current.some(
        segment => cursor > segment.start && cursor < segment.end
      )
    ) {
      closeMention();
      return;
    }
    const match = matchCanvasMentionTrigger(nextValue.slice(0, cursor));
    if (!match) {
      closeMention();
      return;
    }
    setMention(match);
    setActiveIndex(0);
    onMentionQueryChange?.(match.query);
  };

  const clampSelectionToMentionBoundary = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const overlapping = editorSegmentsRef.current.filter(segment =>
      start === end
        ? start > segment.start && start < segment.end
        : start < segment.end && end > segment.start
    );
    if (!overlapping.length) return;
    if (start === end) {
      const segment = overlapping[0];
      const boundary =
        start - segment.start <= segment.end - start
          ? segment.start
          : segment.end;
      textarea.setSelectionRange(boundary, boundary);
      return;
    }
    textarea.setSelectionRange(
      Math.min(start, ...overlapping.map(segment => segment.start)),
      Math.max(end, ...overlapping.map(segment => segment.end))
    );
  };

  const insertReference = (reference: CanvasMentionReference) => {
    if (!mention) return;
    const end = textareaRef.current?.selectionStart ?? value.length;
    const displayReference = `${reference.label}${canvasMentionEditorSpacer(reference.kind)}`;
    const insert = `${displayReference} `;
    const nextDisplay = `${editorValueRef.current.slice(0, mention.start)}${insert}${editorValueRef.current.slice(end)}`;
    const nextSegments = applyCanvasMentionEditorEdit(
      editorValueRef.current,
      nextDisplay,
      editorSegmentsRef.current
    );
    nextSegments.push({
      start: mention.start,
      end: mention.start + displayReference.length,
      key: reference.key,
      label: reference.label,
      token: canvasMentionToken(reference.source, reference.targetId),
    });
    nextSegments.sort((left, right) => left.start - right.start);
    const next = serializeCanvasMentionEditorValue(nextDisplay, nextSegments);
    editorValueRef.current = nextDisplay;
    editorSegmentsRef.current = nextSegments;
    setEditorSegments(nextSegments);
    emittedValueRef.current = next;
    setEditorValue(nextDisplay);
    onChange(next);
    closeMention();
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(
        mention.start + insert.length,
        mention.start + insert.length
      );
    });
  };

  // 覆盖层只负责把 @引用渲染成 chip；纯文本（无引用）时不渲染覆盖层，
  // 直接显示 textarea 原生文字——双层的字体/间距度量再一致也可能有亚像素差，
  // 纯文本走单层可以从根上避免光标与文字错位。
  const showOverlay = Boolean(value) && editorSegments.length > 0;

  return (
    <div className={`canvas-mention-editor ${containerClassName || ""}`}>
      {showOverlay ? (
        <div
          ref={overlayRef}
          className={`${className || ""} canvas-mention-overlay`}
          aria-hidden="true"
        >
          {parts.map((part, index) => {
            if (part.type === "text")
              return <span key={`${part.value}-${index}`}>{part.value}</span>;
            const reference = referenceByKey.get(part.key);
            const thumbnail =
              reference && thumbnailForReference
                ? thumbnailForReference(reference)
                : "";
            const clickable = Boolean(reference && onPreviewReference);
            return (
              <span
                key={`${part.key}-${index}`}
                className={`${part.missing ? "missing" : "reference"}${clickable ? " mention-chip-clickable" : ""}`}
                style={
                  displayWidths[part.key]
                    ? { width: displayWidths[part.key] }
                    : undefined
                }
                title={
                  reference ? `${reference.title}（点击查看详情）` : part.label
                }
                onPointerDown={
                  clickable
                    ? event => {
                        event.preventDefault();
                        event.stopPropagation();
                      }
                    : undefined
                }
                onClick={
                  clickable
                    ? event => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (reference) onPreviewReference?.(reference);
                      }
                    : undefined
                }
              >
                {thumbnail ? (
                  <img
                    className="mention-chip-thumb"
                    src={thumbnail}
                    alt=""
                    draggable={false}
                  />
                ) : null}
                <i className="mention-chip-label">{part.label}</i>
              </span>
            );
          })}
        </div>
      ) : null}
      <textarea
        {...props}
        ref={node => {
          textareaRef.current = node;
          if (typeof forwardedRef === "function") forwardedRef(node);
          else if (forwardedRef) forwardedRef.current = node;
        }}
        className={className}
        value={editorValue}
        onFocus={event => {
          props.onFocus?.(event);
        }}
        onClick={() => {
          requestAnimationFrame(clampSelectionToMentionBoundary);
        }}
        onSelect={() => {
          requestAnimationFrame(clampSelectionToMentionBoundary);
        }}
        onBlur={event => {
          window.setTimeout(closeMention, 120);
          props.onBlur?.(event);
        }}
        // 滚动同步：overlay 负责可视呈现，必须跟随底层 textarea 的滚动位置
        onScroll={event => {
          const overlay = overlayRef.current;
          if (overlay) {
            overlay.scrollTop = event.currentTarget.scrollTop;
            overlay.scrollLeft = event.currentTarget.scrollLeft;
          }
        }}
        onChange={event => {
          const nextDisplay = event.target.value;
          const nextSegments = applyCanvasMentionEditorEdit(
            editorValueRef.current,
            nextDisplay,
            editorSegmentsRef.current
          );
          const nextCanonical = serializeCanvasMentionEditorValue(
            nextDisplay,
            nextSegments
          );
          editorValueRef.current = nextDisplay;
          editorSegmentsRef.current = nextSegments;
          setEditorSegments(nextSegments);
          emittedValueRef.current = nextCanonical;
          setEditorValue(nextDisplay);
          onChange(nextCanonical);
          syncMention(nextDisplay, event.target.selectionStart);
        }}
        onKeyDown={event => {
          if (
            (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
            !event.shiftKey
          ) {
            const textarea = event.currentTarget;
            if (textarea.selectionStart === textarea.selectionEnd) {
              const cursor = textarea.selectionStart;
              const segment = editorSegmentsRef.current.find(
                item => cursor > item.start && cursor < item.end
              );
              if (segment) {
                event.preventDefault();
                const boundary =
                  event.key === "ArrowLeft" ? segment.start : segment.end;
                textarea.setSelectionRange(boundary, boundary);
                closeMention();
                return;
              }
            }
          }
          if (
            (event.key === "Backspace" || event.key === "Delete") &&
            !event.shiftKey
          ) {
            const textarea = event.currentTarget;
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const segment = editorSegmentsRef.current.find(item =>
              start !== end
                ? start < item.end && end > item.start
                : event.key === "Backspace"
                  ? start > item.start && start <= item.end
                  : start >= item.start && start < item.end
            );
            if (segment && start === end) {
              event.preventDefault();
              const nextDisplay = `${editorValueRef.current.slice(0, segment.start)}${editorValueRef.current.slice(segment.end)}`;
              const nextSegments = editorSegmentsRef.current
                .filter(item => item !== segment)
                .map(item =>
                  item.start >= segment.end
                    ? {
                        ...item,
                        start: item.start - (segment.end - segment.start),
                        end: item.end - (segment.end - segment.start),
                      }
                    : item
                );
              const nextCanonical = serializeCanvasMentionEditorValue(
                nextDisplay,
                nextSegments
              );
              editorValueRef.current = nextDisplay;
              editorSegmentsRef.current = nextSegments;
              setEditorSegments(nextSegments);
              emittedValueRef.current = nextCanonical;
              setEditorValue(nextDisplay);
              onChange(nextCanonical);
              requestAnimationFrame(() =>
                textarea.setSelectionRange(segment.start, segment.start)
              );
              closeMention();
              return;
            }
          }
          if (mention && event.key === "ArrowDown" && candidates.length) {
            event.preventDefault();
            setActiveIndex(index => (index + 1) % candidates.length);
            return;
          }
          if (mention && event.key === "ArrowUp" && candidates.length) {
            event.preventDefault();
            setActiveIndex(
              index => (index - 1 + candidates.length) % candidates.length
            );
            return;
          }
          if (mention && event.key === "Enter" && candidates.length) {
            event.preventDefault();
            insertReference(
              candidates[Math.min(activeIndex, candidates.length - 1)]
            );
            return;
          }
          if (mention && event.key === "Escape") {
            event.preventDefault();
            closeMention();
            return;
          }
          if (
            !mention &&
            event.key === "Enter" &&
            !event.shiftKey &&
            onSubmit
          ) {
            event.preventDefault();
            onSubmit();
            return;
          }
          onKeyDown?.(event);
        }}
      />
      {mention && textareaRef.current
        ? createPortal(
            <MentionMenu
              textarea={textareaRef.current}
              references={candidates}
              activeIndex={activeIndex}
              onSelect={insertReference}
              thumbnailForReference={thumbnailForReference}
              onPreviewReference={
                onPreviewReference
                  ? reference => {
                      closeMention();
                      onPreviewReference(reference);
                    }
                  : undefined
              }
              onLocateReference={
                onLocateReference
                  ? reference => {
                      closeMention();
                      onLocateReference(reference);
                    }
                  : undefined
              }
            />,
            document.body
          )
        : null}
    </div>
  );
});

/** 菜单项缩略图：优先用父级提供的缓存 URL；资产库图片按需拉取一次并做会话级缓存 */
function MentionItemThumb({
  reference,
  thumbnailForReference,
}: {
  reference: CanvasMentionReference;
  thumbnailForReference?: (reference: CanvasMentionReference) => string;
}) {
  const direct =
    thumbnailForReference?.(reference) ||
    (reference.kind === "image" &&
    reference.content &&
    isReadableThumbSource(reference.content)
      ? reference.content
      : "");
  const cacheKey = reference.assetId
    ? `${reference.assetScope || "personal"}:${reference.assetId}`
    : "";
  const [fetched, setFetched] = useState(() =>
    cacheKey ? mentionAssetThumbCache.get(cacheKey) || "" : ""
  );
  useEffect(() => {
    if (
      direct ||
      fetched ||
      !cacheKey ||
      reference.kind !== "image" ||
      !reference.assetId
    )
      return;
    let alive = true;
    getAssetContentObjectUrl(
      reference.assetId,
      reference.assetScope || "personal",
      320
    )
      .then(url => {
        mentionAssetThumbCache.set(cacheKey, url);
        if (alive) setFetched(url);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [
    cacheKey,
    direct,
    fetched,
    reference.assetId,
    reference.assetScope,
    reference.kind,
  ]);
  const src = reference.kind === "image" ? direct || fetched : "";
  if (src)
    return (
      <img
        className="canvas-mention-thumb"
        src={src}
        alt=""
        draggable={false}
      />
    );
  const Icon =
    reference.kind === "image"
      ? ImageIcon
      : reference.kind === "video"
        ? Video
        : reference.kind === "audio"
          ? Music2
          : FileText;
  return (
    <span className="canvas-mention-thumb canvas-mention-thumb-icon">
      <Icon size={15} />
    </span>
  );
}

function MentionMenu({
  textarea,
  references,
  activeIndex,
  onSelect,
  thumbnailForReference,
  onPreviewReference,
  onLocateReference,
}: {
  textarea: HTMLTextAreaElement;
  references: CanvasMentionReference[];
  activeIndex: number;
  onSelect: (reference: CanvasMentionReference) => void;
  thumbnailForReference?: (reference: CanvasMentionReference) => string;
  onPreviewReference?: (reference: CanvasMentionReference) => void;
  onLocateReference?: (reference: CanvasMentionReference) => void;
}) {
  const rect = textarea.getBoundingClientRect();
  const width = 340;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  const top =
    rect.bottom + 236 > window.innerHeight
      ? Math.max(8, rect.top - 230)
      : rect.bottom + 6;
  const groups = [
    { key: "canvas-node", label: "已连接素材" },
    { key: "asset-library", label: "资产库" },
  ] as const;
  return (
    <div
      className="canvas-mention-menu"
      style={{ left, top, width }}
      onPointerDown={event => event.stopPropagation()}
    >
      {groups.map(group => {
        const items = references.filter(
          reference => reference.group === group.key
        );
        return (
          <section key={group.key}>
            <b>{group.label}</b>
            {items.map(reference => {
              const index = references.indexOf(reference);
              return (
                <div
                  role="button"
                  tabIndex={-1}
                  className={`canvas-mention-item ${index === activeIndex ? "active" : ""}`}
                  key={reference.id}
                  onPointerDown={event => {
                    event.preventDefault();
                    onSelect(reference);
                  }}
                >
                  <MentionItemThumb
                    reference={reference}
                    thumbnailForReference={thumbnailForReference}
                  />
                  <span>
                    <strong>{reference.label}</strong>
                    <small>
                      {reference.group === "asset-library"
                        ? "资产库"
                        : "已连接节点"}{" "}
                      · {reference.kind}
                    </small>
                  </span>
                  <span className="canvas-mention-item-actions">
                    {onPreviewReference ? (
                      <button
                        type="button"
                        title="查看详情"
                        onPointerDown={event => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onClick={event => {
                          event.stopPropagation();
                          onPreviewReference(reference);
                        }}
                      >
                        <Eye size={13} />
                      </button>
                    ) : null}
                    {reference.nodeId && onLocateReference ? (
                      <button
                        type="button"
                        title="定位到画布节点"
                        onPointerDown={event => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onClick={event => {
                          event.stopPropagation();
                          onLocateReference(reference);
                        }}
                      >
                        <Crosshair size={13} />
                      </button>
                    ) : null}
                  </span>
                </div>
              );
            })}
            {!items.length ? <small>无匹配素材</small> : null}
          </section>
        );
      })}
    </div>
  );
}
