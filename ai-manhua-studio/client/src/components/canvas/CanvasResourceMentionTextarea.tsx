import { FileText, Image as ImageIcon, Music2, Video } from "lucide-react";
import { createPortal } from "react-dom";
import { forwardRef, useMemo, useRef, useState, type ComponentProps } from "react";

import {
  canvasMentionToken,
  filterCanvasMentionReferences,
  matchCanvasMentionTrigger,
  splitCanvasMentionText,
  type CanvasMentionReference,
} from "@/lib/canvas-mentions";

type Props = Omit<ComponentProps<"textarea">, "onChange" | "value"> & {
  value: string;
  references: CanvasMentionReference[];
  onChange: (value: string) => void;
  onMentionQueryChange?: (query: string) => void;
  containerClassName?: string;
};

export const CanvasResourceMentionTextarea = forwardRef<HTMLTextAreaElement, Props>(function CanvasResourceMentionTextarea({
  value,
  references,
  onChange,
  onMentionQueryChange,
  containerClassName,
  className,
  onKeyDown,
  ...props
}, forwardedRef) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [focused, setFocused] = useState(false);
  const candidates = useMemo(
    () => mention ? filterCanvasMentionReferences(references, mention.query) : [],
    [mention, references],
  );
  const parts = useMemo(() => splitCanvasMentionText(value, references), [references, value]);

  const closeMention = () => {
    setMention(null);
    setActiveIndex(0);
  };

  const syncMention = (nextValue: string, cursor: number) => {
    const match = matchCanvasMentionTrigger(nextValue.slice(0, cursor));
    if (!match) {
      closeMention();
      return;
    }
    setMention(match);
    setActiveIndex(0);
    onMentionQueryChange?.(match.query);
  };

  const insertReference = (reference: CanvasMentionReference) => {
    if (!mention) return;
    const end = textareaRef.current?.selectionStart ?? value.length;
    const insert = `${canvasMentionToken(reference.source, reference.targetId)} `;
    const next = `${value.slice(0, mention.start)}${insert}${value.slice(end)}`;
    onChange(next);
    closeMention();
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(mention.start + insert.length, mention.start + insert.length);
    });
  };

  return (
    <div className={`canvas-mention-editor ${containerClassName || ""}`}>
      {!focused && value ? (
        <div className={`${className || ""} canvas-mention-overlay`} aria-hidden="true">
          {parts.map((part, index) => part.type === "text"
            ? <span key={`${part.value}-${index}`}>{part.value}</span>
            : <span key={`${part.key}-${index}`} className={part.missing ? "missing" : "reference"}>{part.label}</span>)}
        </div>
      ) : null}
      <textarea
        {...props}
        ref={(node) => {
          textareaRef.current = node;
          if (typeof forwardedRef === "function") forwardedRef(node);
          else if (forwardedRef) forwardedRef.current = node;
        }}
        className={className}
        value={value}
        onFocus={(event) => { setFocused(true); props.onFocus?.(event); }}
        onBlur={(event) => { setFocused(false); window.setTimeout(closeMention, 120); props.onBlur?.(event); }}
        onChange={(event) => {
          onChange(event.target.value);
          syncMention(event.target.value, event.target.selectionStart);
        }}
        onKeyDown={(event) => {
          if (mention && event.key === "ArrowDown" && candidates.length) {
            event.preventDefault();
            setActiveIndex((index) => (index + 1) % candidates.length);
            return;
          }
          if (mention && event.key === "ArrowUp" && candidates.length) {
            event.preventDefault();
            setActiveIndex((index) => (index - 1 + candidates.length) % candidates.length);
            return;
          }
          if (mention && event.key === "Enter" && candidates.length) {
            event.preventDefault();
            insertReference(candidates[Math.min(activeIndex, candidates.length - 1)]);
            return;
          }
          if (mention && event.key === "Escape") {
            event.preventDefault();
            closeMention();
            return;
          }
          onKeyDown?.(event);
        }}
      />
      {mention && textareaRef.current ? createPortal(
        <MentionMenu
          textarea={textareaRef.current}
          references={candidates}
          activeIndex={activeIndex}
          onSelect={insertReference}
        />,
        document.body,
      ) : null}
    </div>
  );
});

function MentionMenu({ textarea, references, activeIndex, onSelect }: {
  textarea: HTMLTextAreaElement;
  references: CanvasMentionReference[];
  activeIndex: number;
  onSelect: (reference: CanvasMentionReference) => void;
}) {
  const rect = textarea.getBoundingClientRect();
  const width = 280;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  const top = rect.bottom + 236 > window.innerHeight ? Math.max(8, rect.top - 230) : rect.bottom + 6;
  const groups = [
    { key: "canvas-node", label: "已连接素材" },
    { key: "asset-library", label: "资产库" },
  ] as const;
  return (
    <div className="canvas-mention-menu" style={{ left, top, width }} onPointerDown={(event) => event.stopPropagation()}>
      {groups.map((group) => {
        const items = references.filter((reference) => reference.group === group.key);
        return (
          <section key={group.key}>
            <b>{group.label}</b>
            {items.map((reference) => {
              const index = references.indexOf(reference);
              const Icon = reference.kind === "image" ? ImageIcon : reference.kind === "video" ? Video : reference.kind === "audio" ? Music2 : FileText;
              return (
                <button
                  type="button"
                  className={index === activeIndex ? "active" : ""}
                  key={reference.id}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    onSelect(reference);
                  }}
                >
                  <Icon size={16} />
                  <span><strong>{reference.label}</strong><small>{reference.group === "asset-library" ? "资产库" : "已连接节点"} · {reference.kind}</small></span>
                </button>
              );
            })}
            {!items.length ? <small>无匹配素材</small> : null}
          </section>
        );
      })}
    </div>
  );
}
