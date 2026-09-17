import {
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Eye,
  FileText,
  Folder,
  Image as ImageIcon,
  Music2,
  Star,
  Video,
} from "lucide-react";
import { createPortal } from "react-dom";
import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";

import { getAssetContentObjectUrl } from "@/entities/asset";
import { useOutsidePress } from "@/shared/lib/useOutsidePress";
import { useMentionCaret } from "./useMentionCaret";
import { buildCanvasMentionLibraryMenu, emptyCanvasMentionLibrary, mentionLibraryTargetLabel, type CanvasMentionLibraryItem, type CanvasMentionLibraryState, type CanvasMentionLibraryTarget } from "@/features/canvas/domain/mentionLibrary";
import {
  applyCanvasMentionEditorEdit,
  buildCanvasMentionEditorModel,
  canvasMentionEditorDisplayText,
  canvasMentionEditorGap,
  canvasMentionShowsName,
  canvasMentionToken,
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
  onMentionQueryChange?: (query: string, target?: CanvasMentionLibraryTarget, loadMore?: boolean) => void;
  mentionLibrary?: CanvasMentionLibraryState;
  onSubmit?: () => void;
  containerClassName?: string;
  /** 返回引用对应的缩略图 URL（画布节点读预览缓存；返回空时资产库图片会按需拉取） */
  thumbnailForReference?: (reference: CanvasMentionReference) => string;
  /** 双击已插入的引用 chip / 点击菜单项的"详情"按钮 */
  onPreviewReference?: (reference: CanvasMentionReference) => void;
  /** 点击菜单项的"定位"按钮（仅画布内节点会显示） */
  onLocateReference?: (reference: CanvasMentionReference) => void;
};

/** 资产库图片缩略图的会话级缓存：assetScope:assetId -> objectURL（菜单反复开合不重复拉取） */
const mentionAssetThumbCache = new Map<string, string>();

/** Keep the popup anchored to the editor and inside the viewport at every depth. */
const MENTION_MENU_WIDTH = 340;
const MENTION_MENU_MAX_HEIGHT = 460;
const MENTION_MENU_GAP = 8;

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
    mentionLibrary = emptyCanvasMentionLibrary(),
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
  const editorModel = useMemo(
    () => buildCanvasMentionEditorModel(value, references),
    [references, value]
  );
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const composingRef = useRef(false);
  const [isComposing, setIsComposing] = useState(false);
  // Apply insertion/deletion caret positions immediately after the controlled value commits.
  const pendingCaretRef = useRef<{ start: number; end: number; direction?: "forward" | "backward" | "none" } | null>(null);
  // 空字符串是有效的节点内容，不能在渲染时把它当作“未初始化”。
  // 后续外部值由同步 effect 同时更新 ref 与显示状态，避免选回原节点时只更新 ref。
  const editorValueRef = useRef(editorModel.displayValue);
  const editorSegmentsRef = useRef<CanvasMentionEditorSegment[]>(editorModel.segments);
  const emittedValueRef = useRef<string | null>(null);
  const observedValueRef = useRef(value);
  const [mention, setMention] = useState<{
    start: number;
    query: string;
  } | null>(null);
  const [mentionPath, setMentionPath] = useState<CanvasMentionLibraryTarget[]>(["root"]);
  const mentionTarget = mentionPath[mentionPath.length - 1];
  const mentionTargetRef = useRef<CanvasMentionLibraryTarget>("root");
  const [activeIndex, setActiveIndex] = useState(0);
  const menuItems = useMemo(
    () =>
      mention
        ? buildCanvasMentionLibraryMenu(
            references,
            mention.query,
            mentionTarget,
            mentionLibrary,
          )
        : [],
    [mention, mentionTarget, mentionLibrary, references]
  );
  const [editorValue, setEditorValue] = useState(
    () => editorModel.displayValue
  );
  const [editorSegments, setEditorSegments] = useState<
    CanvasMentionEditorSegment[]
  >(() => editorModel.segments);
  useLayoutEffect(() => {
    const caret = pendingCaretRef.current;
    if (caret === null || !textareaRef.current) return;
    pendingCaretRef.current = null;
    textareaRef.current.focus({ preventScroll: true });
    textareaRef.current.setSelectionRange(caret.start, caret.end, caret.direction);
  }, [editorValue, editorSegments]);
  const { caret, refresh: refreshCaret } = useMentionCaret(textareaRef, editorValue);
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
    const computed = getComputedStyle(textarea);
    const probe = document.createElement("span");
    probe.style.cssText = [
      "position:absolute",
      "left:-9999px",
      "top:0",
      "visibility:hidden",
      "white-space:pre",
      `font:${computed.font}`,
      `letter-spacing:${computed.letterSpacing}`,
      `word-spacing:${computed.wordSpacing}`,
    ].join(";");
    textarea.parentElement?.appendChild(probe);
    const next: Record<string, number> = {};
    editorSegments.forEach(segment => {
      const reference = referenceByKey.get(segment.key);
      if (reference && !canvasMentionShowsName(reference.kind)) return;
      probe.textContent = editorValue.slice(segment.start, segment.end);
      next[segment.key] = Math.ceil(probe.getBoundingClientRect().width);
    });
    probe.remove();
    setDisplayWidths(next);
  }, [editorSegments, editorValue, references]);

  useLayoutEffect(() => {
    const externalValueChanged = observedValueRef.current !== value;
    observedValueRef.current = value;
    // A refreshed reference list must not overwrite an edit awaiting its parent's acknowledgement.
    if (!externalValueChanged && emittedValueRef.current !== null && emittedValueRef.current !== value) return;
    if (emittedValueRef.current === value) {
      emittedValueRef.current = null;
    }
    const currentSegments = editorSegmentsRef.current;
    // Preserve the current edit when only a thumbnail/catalog/title refreshed:
    // assigning textarea.value unnecessarily can reset the native caret.
    const sameContent = serializeCanvasMentionEditorValue(editorValueRef.current, currentSegments) === value;
    if (sameContent && currentSegments.every(segment => {
      const reference = referenceByKey.get(segment.key);
      return editorValueRef.current.slice(segment.start, segment.end) === canvasMentionEditorDisplayText(reference);
    })) return;
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
    const textarea = textareaRef.current;
    if (textarea && document.activeElement === textarea && !composingRef.current) {
      pendingCaretRef.current = {
        start: Math.min(textarea.selectionStart, editorModel.displayValue.length),
        end: Math.min(textarea.selectionEnd, editorModel.displayValue.length),
        direction: textarea.selectionDirection,
      };
    }
    editorValueRef.current = editorModel.displayValue;
    editorSegmentsRef.current = editorModel.segments;
    setEditorValue(editorModel.displayValue);
    setEditorSegments(editorModel.segments);
  }, [editorModel.displayValue, editorModel.segments, value]);

  const closeMention = () => {
    mentionTargetRef.current = "root";
    setMentionPath(["root"]);
    setMention(null);
    setActiveIndex(0);
  };

  useEffect(() => {
    closeMention();
  }, [mentionLibrary.projectId, mentionLibrary.scope]);

  const emitMentionCatalog = (query: string, target: CanvasMentionLibraryTarget) => {
    onMentionQueryChange?.(query, target);
  };

  const selectMentionFolder = (target: CanvasMentionLibraryTarget) => {
    mentionTargetRef.current = target;
    setMentionPath(path => [...path, target]);
    setActiveIndex(0);
    emitMentionCatalog(mention?.query || "", target);
  };

  const backMentionFolder = () => {
    const path = mentionPath.length > 1 ? mentionPath.slice(0, -1) : ["root" as const];
    const target = path[path.length - 1];
    mentionTargetRef.current = target;
    setMentionPath(path);
    setActiveIndex(0);
    emitMentionCatalog(mention?.query || "", target);
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
    emitMentionCatalog(match.query, mentionTargetRef.current);
  };

  const clampSelectionToMentionBoundary = () => {
    const textarea = textareaRef.current;
    if (!textarea || composingRef.current || document.activeElement !== textarea) return;
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
      Math.max(end, ...overlapping.map(segment => segment.end)),
      textarea.selectionDirection
    );
  };

  const insertReference = (reference: CanvasMentionReference) => {
    if (!mention) return;
    const end = textareaRef.current?.selectionStart ?? editorValueRef.current.length;
    const displayReference = canvasMentionEditorDisplayText(reference);
    const insert = `${displayReference}${canvasMentionEditorGap(reference.kind)}`;
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
    pendingCaretRef.current = { start: mention.start + insert.length, end: mention.start + insert.length };
    setEditorSegments(nextSegments);
    emittedValueRef.current = next;
    setEditorValue(nextDisplay);
    onChange(next);
    closeMention();
  };

  const activateMenuItem = (item: CanvasMentionLibraryItem) => {
    if (item.kind === "folder") {
      selectMentionFolder(item.target);
      return;
    }
    insertReference(item.reference);
  };

  // 覆盖层只负责把 @引用渲染成 chip；纯文本（无引用）时不渲染覆盖层，
  // 直接显示 textarea 原生文字——双层的字体/间距度量再一致也可能有亚像素差，
  // 纯文本走单层可以从根上避免光标与文字错位。
  const showOverlay = Boolean(value) && editorSegments.length > 0;

  return (
    <div className={`canvas-mention-editor ${containerClassName || ""}`} data-enhanced-caret={Boolean(caret && !isComposing)}>
      {caret && !isComposing ? <span className="canvas-mention-caret" style={caret} aria-hidden="true" /> : null}
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
            const previewable = Boolean(reference && onPreviewReference);
            const hideName = Boolean(
              reference && canvasMentionShowsName(reference.kind, part.missing) === false
            );
            return (
              <span
                key={`${part.key}-${index}`}
                className={`${part.missing ? "missing" : "reference"} mention-chip-caret${hideName ? " mention-chip-thumb-only" : ""}`}
                style={
                  !hideName && displayWidths[part.key]
                    ? { width: displayWidths[part.key] }
                    : undefined
                }
                title={
                  reference ? `${reference.title}（单击定位光标${previewable ? "，双击查看详情" : ""}）` : part.label
                }
                onPointerDown={event => {
                  if (event.button !== 0 || composingRef.current) return;
                  event.preventDefault();
                  event.stopPropagation();
                  const textarea = textareaRef.current;
                  if (!textarea) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  const caret = event.clientX < rect.left + rect.width / 2 ? part.start : part.end;
                  const anchor = textarea.selectionDirection === "backward" ? textarea.selectionEnd : textarea.selectionStart;
                  textarea.focus({ preventScroll: true });
                  if (event.shiftKey) textarea.setSelectionRange(Math.min(anchor, caret), Math.max(anchor, caret), caret < anchor ? "backward" : "forward");
                  else textarea.setSelectionRange(caret, caret);
                  refreshCaret();
                  closeMention();
                }}
                onClick={event => event.stopPropagation()}
                onDoubleClick={event => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (reference && !composingRef.current) onPreviewReference?.(reference);
                }}
              >
                {hideName && reference ? (
                  <>
                    <span className="mention-chip-sizer" aria-hidden="true">
                      {canvasMentionEditorDisplayText(reference)}
                    </span>
                    <MentionItemThumb
                      reference={reference}
                      thumbnailForReference={thumbnailForReference}
                      className="mention-chip-thumb"
                      iconSize={12}
                    />
                  </>
                ) : null}
                {hideName ? null : (
                  <i className="mention-chip-label">{part.label}</i>
                )}
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
        onClick={event => {
          clampSelectionToMentionBoundary();
          props.onClick?.(event);
        }}
        onSelect={event => {
          clampSelectionToMentionBoundary();
          refreshCaret();
          props.onSelect?.(event);
        }}
        onCompositionStart={event => {
          composingRef.current = true;
          setIsComposing(true);
          props.onCompositionStart?.(event);
        }}
        onCompositionEnd={event => {
          composingRef.current = false;
          setIsComposing(false);
          refreshCaret();
          syncMention(event.currentTarget.value, event.currentTarget.selectionStart);
          props.onCompositionEnd?.(event);
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
          if (!composingRef.current) pendingCaretRef.current = { start: event.target.selectionStart, end: event.target.selectionEnd, direction: event.target.selectionDirection };
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
          if (!composingRef.current) syncMention(nextDisplay, event.target.selectionStart);
        }}
        onKeyDown={event => {
          // IME Enter confirms the current word; it must not submit a generation or move the caret.
          if (composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (
            (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
            !event.altKey && !event.ctrlKey && !event.metaKey
          ) {
            const textarea = event.currentTarget;
            if (event.shiftKey || textarea.selectionStart === textarea.selectionEnd) {
              const backward = textarea.selectionDirection === "backward";
              const cursor = backward ? textarea.selectionStart : textarea.selectionEnd;
              const anchor = backward ? textarea.selectionEnd : textarea.selectionStart;
              const segment = editorSegmentsRef.current.find(item => event.key === "ArrowLeft"
                ? cursor > item.start && cursor <= item.end
                : cursor >= item.start && cursor < item.end);
              if (segment) {
                event.preventDefault();
                const boundary =
                  event.key === "ArrowLeft" ? segment.start : segment.end;
                if (event.shiftKey) textarea.setSelectionRange(Math.min(anchor, boundary), Math.max(anchor, boundary), boundary < anchor ? "backward" : "forward");
                else textarea.setSelectionRange(boundary, boundary);
                refreshCaret();
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
            if (segment) {
              event.preventDefault();
              const overlapping = editorSegmentsRef.current.filter(item => start < item.end && end > item.start);
              const removeStart = start === end ? segment.start : Math.min(start, ...overlapping.map(item => item.start));
              const removeEnd = start === end ? segment.end : Math.max(end, ...overlapping.map(item => item.end));
              const nextDisplay = `${editorValueRef.current.slice(0, removeStart)}${editorValueRef.current.slice(removeEnd)}`;
              const nextSegments = editorSegmentsRef.current
                .filter(item => item.end <= removeStart || item.start >= removeEnd)
                .map(item =>
                  item.start >= removeEnd
                    ? {
                        ...item,
                        start: item.start - (removeEnd - removeStart),
                        end: item.end - (removeEnd - removeStart),
                      }
                    : item
                );
              const nextCanonical = serializeCanvasMentionEditorValue(
                nextDisplay,
                nextSegments
              );
              editorValueRef.current = nextDisplay;
              editorSegmentsRef.current = nextSegments;
              pendingCaretRef.current = { start: removeStart, end: removeStart };
              setEditorSegments(nextSegments);
              emittedValueRef.current = nextCanonical;
              setEditorValue(nextDisplay);
              onChange(nextCanonical);
              closeMention();
              return;
            }
          }
          if (mention && event.key === "ArrowDown" && menuItems.length) {
            event.preventDefault();
            setActiveIndex(index => (index + 1) % menuItems.length);
            return;
          }
          if (mention && event.key === "ArrowUp" && menuItems.length) {
            event.preventDefault();
            setActiveIndex(
              index => (index - 1 + menuItems.length) % menuItems.length
            );
            return;
          }
          if (mention && event.key === "Enter" && menuItems.length) {
            event.preventDefault();
            activateMenuItem(
              menuItems[Math.min(activeIndex, menuItems.length - 1)]
            );
            return;
          }
          if (mention && event.key === "Escape") {
            event.preventDefault();
            if (mentionTarget !== "root") {
              backMentionFolder();
              return;
            }
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
              onDismiss={closeMention}
              textarea={textareaRef.current}
              items={menuItems}
              activeIndex={activeIndex}
              target={mentionTarget}
              library={mentionLibrary}
              onSelectItem={activateMenuItem}
              onBack={mentionTarget !== "root" ? backMentionFolder : undefined}
              onRetry={() => onMentionQueryChange?.(mention.query, mentionTarget)}
              onLoadMore={() => onMentionQueryChange?.(mention.query, mentionTarget, true)}
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
  className = "canvas-mention-thumb",
  iconSize = 15,
}: {
  reference: CanvasMentionReference;
  thumbnailForReference?: (reference: CanvasMentionReference) => string;
  className?: string;
  iconSize?: number;
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
        className={className}
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
    <span className={`${className} canvas-mention-thumb-icon`}>
      <Icon size={iconSize} />
    </span>
  );
}

function MentionMenu({
  onDismiss,
  textarea,
  items,
  activeIndex,
  target,
  library,
  onSelectItem,
  onBack,
  onRetry,
  onLoadMore,
  thumbnailForReference,
  onPreviewReference,
  onLocateReference,
}: {
  onDismiss: () => void;
  textarea: HTMLTextAreaElement;
  items: CanvasMentionLibraryItem[];
  activeIndex: number;
  target: CanvasMentionLibraryTarget;
  library: CanvasMentionLibraryState;
  onSelectItem: (item: CanvasMentionLibraryItem) => void;
  onBack?: () => void;
  onRetry: () => void;
  onLoadMore: () => void;
  thumbnailForReference?: (reference: CanvasMentionReference) => string;
  onPreviewReference?: (reference: CanvasMentionReference) => void;
  onLocateReference?: (reference: CanvasMentionReference) => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  useOutsidePress(true, event => {
    const path = event.composedPath();
    return path.includes(textarea) || path.includes(menuRef.current!);
  }, onDismiss);
  useEffect(() => {
    menuRef.current?.querySelector(".canvas-mention-item.active")?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);
  const rect = textarea.getBoundingClientRect();
  const width = Math.min(MENTION_MENU_WIDTH, window.innerWidth - MENTION_MENU_GAP * 2);
  const left = Math.max(MENTION_MENU_GAP, Math.min(rect.left, window.innerWidth - width - MENTION_MENU_GAP));
  const above = rect.top - MENTION_MENU_GAP * 2;
  const below = window.innerHeight - rect.bottom - MENTION_MENU_GAP * 2;
  const placeAbove = below < Math.min(MENTION_MENU_MAX_HEIGHT, above);
  const top = placeAbove ? rect.top - MENTION_MENU_GAP : rect.bottom + MENTION_MENU_GAP;
  const nodeItems = items.filter(
    (item): item is Extract<CanvasMentionLibraryItem, { kind: "reference" }> =>
      item.kind === "reference" && item.reference.group === "canvas-node"
  );
  const libraryItems = items.filter(
    item =>
      item.kind === "folder" ||
      (item.kind === "reference" && item.reference.group === "asset-library")
  );
  const emptyLibraryHint = target === "favorites" ? "暂无收藏的资产" : "此文件夹暂无匹配的素材";
  return (
    <div
      className="canvas-mention-menu"
      ref={menuRef}
      aria-label="引用素材"
      style={{ left, top, width, maxHeight: Math.min(MENTION_MENU_MAX_HEIGHT, Math.max(0, placeAbove ? above : below)), transform: placeAbove ? "translateY(-100%)" : undefined }}
      onPointerDown={event => event.stopPropagation()}
    >
      {nodeItems.length ? (
        <section>
          <b>前置连线节点</b>
          {nodeItems.map(item => (
            <MentionReferenceRow
              key={item.id}
              item={item}
              index={items.indexOf(item)}
              activeIndex={activeIndex}
              onSelectItem={onSelectItem}
              thumbnailForReference={thumbnailForReference}
              onPreviewReference={onPreviewReference}
              onLocateReference={onLocateReference}
            />
          ))}
        </section>
      ) : null}
      <section>
        <b>资产库</b>
        {onBack ? (
          <button
            type="button"
            className="canvas-mention-back"
            onPointerDown={event => {
              event.preventDefault();
              onBack();
            }}
          >
            <ChevronLeft size={14} />
            返回 · {mentionLibraryTargetLabel(target, library.folders)}
          </button>
        ) : null}
        {libraryItems.map(item =>
          item.kind === "folder" ? (
            <div
              role="button"
              tabIndex={-1}
              className={`canvas-mention-item canvas-mention-item-folder ${items.indexOf(item) === activeIndex ? "active" : ""}`}
              key={item.id}
              onPointerDown={event => {
                event.preventDefault();
                onSelectItem(item);
              }}
            >
              <span className="canvas-mention-thumb canvas-mention-thumb-icon">
                {item.target === "favorites" ? <Star size={15} /> : <Folder size={15} />}
              </span>
              <span>
                <strong>{item.label}</strong>
                {item.currentProject ? <small>当前画布</small> : null}
              </span>
              <span className="canvas-mention-item-actions">
                <ChevronRight size={13} />
              </span>
            </div>
          ) : (
            <MentionReferenceRow
              key={item.id}
              item={item}
              index={items.indexOf(item)}
              activeIndex={activeIndex}
              onSelectItem={onSelectItem}
              thumbnailForReference={thumbnailForReference}
              onPreviewReference={onPreviewReference}
              onLocateReference={onLocateReference}
            />
          )
        )}
        {library.loading ? <small role="status">正在读取素材…</small> : null}
        {library.error ? <div className="canvas-mention-feedback" role="alert">
          <small>{library.error}</small>
          <button type="button" className="canvas-mention-back" onPointerDown={event => { event.preventDefault(); onRetry(); }}>重试</button>
        </div> : null}
        {!library.loading && !library.error && !libraryItems.length ? <small>{emptyLibraryHint}</small> : null}
        {!library.loading && !library.error && library.hasMore && (target !== "root" || library.query) ? (
          <button type="button" className="canvas-mention-back" onPointerDown={event => { event.preventDefault(); onLoadMore(); }}>加载更多</button>
        ) : null}
      </section>
    </div>
  );
}

function MentionReferenceRow({
  item,
  index,
  activeIndex,
  onSelectItem,
  thumbnailForReference,
  onPreviewReference,
  onLocateReference,
}: {
  item: Extract<CanvasMentionLibraryItem, { kind: "reference" }>;
  index: number;
  activeIndex: number;
  onSelectItem: (item: CanvasMentionLibraryItem) => void;
  thumbnailForReference?: (reference: CanvasMentionReference) => string;
  onPreviewReference?: (reference: CanvasMentionReference) => void;
  onLocateReference?: (reference: CanvasMentionReference) => void;
}) {
  const reference = item.reference;
  return (
    <div
      role="button"
      tabIndex={-1}
      className={`canvas-mention-item ${index === activeIndex ? "active" : ""}`}
      onPointerDown={event => {
        event.preventDefault();
        onSelectItem(item);
      }}
    >
      <MentionItemThumb
        reference={reference}
        thumbnailForReference={thumbnailForReference}
      />
      <span>
        <strong>{reference.label}</strong>
        <small>
          {reference.group === "asset-library" ? "资产库" : "已连接节点"} ·{" "}
          {reference.kind}
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
}
