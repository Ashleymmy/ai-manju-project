import { FileText, Image as ImageIcon, Loader2, Music2, Plus, Send, Upload, Video, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";

import { getAssetContentObjectUrl } from "@/entities/asset";

import type {
  WorkbenchImageReference,
  WorkbenchReference,
} from "../model/referenceEngine";

/* 输入区：透明 textarea + token 高亮 overlay（@引用 chip 常驻），
   @ 唤起素材候选菜单，支持拖拽/粘贴/上传附件与首尾帧注入。 */

export type MentionCandidate = {
  id: string;
  kind: "image" | "video" | "audio" | "text";
  label: string;
  source: "shelf" | "asset";
  assetId?: string;
  scope?: "personal" | "team";
};

const TOKEN_PATTERN = /@\[ref:([^\]]+)\]/g;

/** @ 候选菜单最大高度（与 .wb-mention-menu max-height 对应，用于视口内夹取定位） */
const MENTION_MENU_HEIGHT = 260;

export function Composer({
  prompt,
  onPromptChange,
  references,
  firstFrame,
  lastFrame,
  framesEnabled,
  generating,
  disabled,
  mentionCandidates,
  mentionLoading,
  onMentionQuery,
  onInsertAssetMention,
  onUploadFiles,
  onPasteFiles,
  onRemoveReference,
  onRemoveFrame,
  onFrameSelect,
  onSubmit,
  onOpenMedia,
  thumbUrlFor,
}: {
  prompt: string;
  onPromptChange: (value: string) => void;
  references: WorkbenchReference[];
  firstFrame: WorkbenchImageReference | null;
  lastFrame: WorkbenchImageReference | null;
  framesEnabled: boolean;
  generating: boolean;
  disabled: boolean;
  mentionCandidates: MentionCandidate[];
  mentionLoading: boolean;
  onMentionQuery: (query: string) => void;
  /** 资产库素材插入：先拉取入库，返回新建的引用 id（空串表示失败），由组件把 token 插回 @ 位置 */
  onInsertAssetMention: (candidate: MentionCandidate) => Promise<string>;
  onUploadFiles: (files: FileList | File[]) => void;
  onPasteFiles: (files: File[]) => void;
  onRemoveReference: (id: string) => void;
  onRemoveFrame: (role: "first_frame" | "last_frame") => void;
  onFrameSelect: (role: "first_frame" | "last_frame", file: File) => void;
  onSubmit: () => void;
  onOpenMedia: (url: string, kind: "image" | "video") => void;
  thumbUrlFor: (reference: WorkbenchReference) => string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const frameInputRef = useRef<HTMLInputElement | null>(null);
  const frameRoleRef = useRef<"first_frame" | "last_frame">("first_frame");
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [tokenWidths, setTokenWidths] = useState<Record<string, number>>({});
  const promptRef = useRef(prompt);
  promptRef.current = prompt;

  const referenceById = useMemo(() => new Map(references.map((item) => [item.id, item])), [references]);
  const parts = useMemo(() => splitPromptTokens(prompt), [prompt]);

  // token chip 与画布 mention 同款：宽度 = 原文本宽度，可视层与透明文字层对齐
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !prompt) return;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const computed = getComputedStyle(textarea);
    ctx.font = `${computed.fontWeight} ${computed.fontSize} ${computed.fontFamily}`;
    const next: Record<string, number> = {};
    parts.forEach((part) => {
      if (part.type === "token") next[part.raw] = Math.ceil(ctx.measureText(part.raw).width);
    });
    setTokenWidths(next);
  }, [parts, prompt]);

  const closeMention = () => {
    setMention(null);
    setMentionIndex(0);
  };

  const syncMention = (value: string, cursor: number) => {
    const before = value.slice(0, cursor);
    const match = /(^|[^A-Za-z0-9_\]])@([^\s@\[\]]*)$/.exec(before);
    if (!match) {
      closeMention();
      return;
    }
    setMention({ start: cursor - (match[2] || "").length - 1, query: match[2] || "" });
    setMentionIndex(0);
    onMentionQuery(match[2] || "");
  };

  const insertTokenAt = (id: string, start: number, end: number) => {
    const insert = `@[ref:${id}] `;
    const current = promptRef.current;
    const next = `${current.slice(0, start)}${insert}${current.slice(end)}`;
    onPromptChange(next);
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      textarea?.focus();
      textarea?.setSelectionRange(start + insert.length, start + insert.length);
    });
  };

  const insertToken = (id: string) => {
    if (!mention) return;
    const end = textareaRef.current?.selectionStart ?? prompt.length;
    insertTokenAt(id, mention.start, end);
    closeMention();
  };

  const insertCandidate = (candidate: MentionCandidate) => {
    if (!mention) return;
    if (candidate.source === "asset") {
      // 资产要先读回文件入库，异步完成后回到原 @ 位置插入 token
      const start = mention.start;
      const end = textareaRef.current?.selectionStart ?? prompt.length;
      void onInsertAssetMention(candidate).then((id) => {
        if (id) insertTokenAt(id, start, end);
      });
      closeMention();
      return;
    }
    insertToken(candidate.id);
  };

  return (
    <div
      className="wb-composer"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const files = Array.from(event.dataTransfer.files || []);
        if (files.length) onUploadFiles(files);
      }}
    >
      <div className="wb-composer-editor">
        <div className="wb-composer-scroll">
          {prompt ? (
            <div ref={overlayRef} className="wb-prompt-overlay" aria-hidden="true">
              {parts.map((part, index) => {
                if (part.type === "text") return <span key={`t-${index}`}>{part.value}</span>;
                const reference = referenceById.get(part.id);
                const thumb = reference ? thumbUrlFor(reference) : "";
                return (
                  <span
                    key={`k-${index}`}
                    className={`wb-token ${reference ? "" : "missing"}`}
                    style={tokenWidths[part.raw] ? { width: tokenWidths[part.raw] } : undefined}
                    title={reference ? reference.name : "引用已失效"}
                  >
                    {thumb ? <img src={thumb} alt="" draggable={false} /> : null}
                    <i>{reference ? reference.token || reference.name : "已失效"}</i>
                  </span>
                );
              })}
            </div>
          ) : null}
          <textarea
            ref={textareaRef}
            value={prompt}
            disabled={disabled}
            placeholder="描述你想生成的视频… 输入 @ 引用素材，支持拖拽/粘贴图片视频音频"
            onChange={(event) => {
              onPromptChange(event.target.value);
              syncMention(event.target.value, event.target.selectionStart);
            }}
            onScroll={(event) => {
              const overlay = overlayRef.current;
              if (overlay) {
                overlay.scrollTop = event.currentTarget.scrollTop;
                overlay.scrollLeft = event.currentTarget.scrollLeft;
              }
            }}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData?.items || [])
                .filter((item) => item.kind === "file")
                .map((item) => item.getAsFile())
                .filter((file): file is File => Boolean(file));
              if (files.length) {
                event.preventDefault();
                onPasteFiles(files);
              }
            }}
            onKeyDown={(event) => {
              if (mention && event.key === "ArrowDown" && mentionCandidates.length) {
                event.preventDefault();
                setMentionIndex((index) => (index + 1) % mentionCandidates.length);
                return;
              }
              if (mention && event.key === "ArrowUp" && mentionCandidates.length) {
                event.preventDefault();
                setMentionIndex((index) => (index - 1 + mentionCandidates.length) % mentionCandidates.length);
                return;
              }
              if (mention && event.key === "Enter" && mentionCandidates.length) {
                event.preventDefault();
                insertCandidate(mentionCandidates[Math.min(mentionIndex, mentionCandidates.length - 1)]);
                return;
              }
              if (event.key === "Escape" && mention) {
                event.preventDefault();
                closeMention();
                return;
              }
              // 光标紧跟 token 时退格 = 整体删除 token（对齐 SD-video 的 token 删除语义）
              if (event.key === "Backspace") {
                const textarea = event.currentTarget;
                if (textarea.selectionStart === textarea.selectionEnd) {
                  const before = prompt.slice(0, textarea.selectionStart);
                  const match = /@\[ref:[^\]]+\]\s?$/.exec(before);
                  if (match) {
                    event.preventDefault();
                    const next = before.slice(0, before.length - match[0].length) + prompt.slice(textarea.selectionStart);
                    onPromptChange(next);
                    requestAnimationFrame(() => {
                      const caret = before.length - match[0].length;
                      textarea.setSelectionRange(caret, caret);
                    });
                    return;
                  }
                }
              }
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                onSubmit();
              }
            }}
          />
          {!prompt ? <span className="wb-prompt-placeholder">描述你想生成的视频… 输入 @ 引用素材，支持拖拽/粘贴</span> : null}
        </div>
        <div className="wb-composer-actions">
          <label className="wb-icon-button" title="上传素材" aria-label="上传素材">
            <Upload size={16} />
            <input
              type="file"
              hidden
              multiple
              accept="image/*,video/mp4,video/quicktime,audio/mpeg,audio/mp3,audio/wav,audio/x-wav,.mp4,.mov,.mp3,.wav"
              onChange={(event) => {
                if (event.currentTarget.files?.length) onUploadFiles(event.currentTarget.files);
                event.currentTarget.value = "";
              }}
            />
          </label>
          <button
            type="button"
            className="wb-send"
            disabled={disabled || generating || (!prompt.trim() && !references.length && !firstFrame && !lastFrame)}
            onClick={onSubmit}
          >
            {generating ? <Loader2 className="spin" size={15} /> : <Send size={15} />}
            {generating ? "生成中" : "开始生成"}
          </button>
        </div>
        {mention ? createPortal(
          <ComposerMentionMenu
            textarea={textareaRef.current}
            candidates={mentionCandidates}
            activeIndex={mentionIndex}
            loading={mentionLoading}
            onPick={insertCandidate}
          />,
          document.body,
        ) : null}
      </div>

      <div className="wb-composer-dock">
        {framesEnabled ? (
          <div className="wb-frames">
            <FrameSlot
              label="首帧 / START"
              frame={firstFrame}
              onSelect={() => {
                frameRoleRef.current = "first_frame";
                frameInputRef.current?.click();
              }}
              onRemove={() => onRemoveFrame("first_frame")}
              onOpenMedia={onOpenMedia}
            />
            <FrameSlot
              label="尾帧 / END"
              frame={lastFrame}
              onSelect={() => {
                frameRoleRef.current = "last_frame";
                frameInputRef.current?.click();
              }}
              onRemove={() => onRemoveFrame("last_frame")}
              onOpenMedia={onOpenMedia}
            />
          </div>
        ) : null}
        {references.length ? (
          <div className="wb-shelf">
            {references.map((reference) => (
              <span key={reference.id} className="wb-shelf-item" title={`${reference.name} · ${reference.token || "参考"}`}>
                {reference.kind === "image" ? <img src={thumbUrlFor(reference)} alt="" draggable={false} /> : null}
                {reference.kind === "video" ? <video src={thumbUrlFor(reference)} muted preload="metadata" /> : null}
                {reference.kind === "audio" ? <Music2 size={14} /> : null}
                <i>{reference.token || reference.name}</i>
                <button type="button" title="移除引用" onClick={() => onRemoveReference(reference.id)}><X size={11} /></button>
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <input
        ref={frameInputRef}
        type="file"
        hidden
        accept="image/*"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) onFrameSelect(frameRoleRef.current, file);
          event.currentTarget.value = "";
        }}
      />
    </div>
  );
}

function FrameSlot({
  label,
  frame,
  onSelect,
  onRemove,
  onOpenMedia,
}: {
  label: string;
  frame: WorkbenchImageReference | null;
  onSelect: () => void;
  onRemove: () => void;
  onOpenMedia: (url: string, kind: "image" | "video") => void;
}) {
  return (
    <div className="wb-frame-slot">
      <span className="wb-frame-label">{label}</span>
      {frame ? (
        <div className="wb-frame-filled" onClick={() => onOpenMedia(frame.previewUrl, "image")} role="button" tabIndex={0}
          onKeyDown={(event) => { if (event.key === "Enter") onOpenMedia(frame.previewUrl, "image"); }}>
          <img src={frame.previewUrl} alt={label} />
          <button type="button" className="wb-frame-remove" title="移除" onClick={(event) => { event.stopPropagation(); onRemove(); }}>
            <X size={13} />
          </button>
        </div>
      ) : (
        <button type="button" className="wb-frame-empty" onClick={onSelect}>
          <Plus size={17} />
          <span>上传图片</span>
        </button>
      )}
    </div>
  );
}

function ComposerMentionMenu({
  textarea,
  candidates,
  activeIndex,
  loading,
  onPick,
}: {
  textarea: HTMLTextAreaElement | null;
  candidates: MentionCandidate[];
  activeIndex: number;
  loading: boolean;
  onPick: (candidate: MentionCandidate) => void;
}) {
  const rect = textarea?.getBoundingClientRect();
  const width = 340;
  const left = Math.max(8, Math.min(rect?.left ?? 8, window.innerWidth - width - 8));
  // 菜单抬到输入区上方；空间不足时收进视口（覆盖输入区上缘，与 SD-video 行为一致）
  const rawBottom = rect ? window.innerHeight - rect.top + 6 : 120;
  const bottom = Math.max(8, Math.min(rawBottom, window.innerHeight - MENTION_MENU_HEIGHT - 8));
  return (
    <div className="wb-mention-menu" style={{ left, bottom, width }} onPointerDown={(event) => event.stopPropagation()}>
      <div className="wb-mention-head">
        <span>@ 引用素材</span>
        {loading ? <span className="wb-mention-syncing">同步资产库…</span> : null}
      </div>
      <div className="wb-mention-list">
        {candidates.map((candidate, index) => (
          <MentionCandidateRow
            key={`${candidate.source}:${candidate.id}`}
            candidate={candidate}
            active={index === activeIndex}
            onPick={onPick}
          />
        ))}
        {!candidates.length ? <p className="wb-mention-empty">无匹配素材，可从资产库上传后再引用</p> : null}
      </div>
    </div>
  );
}

function MentionCandidateRow({
  candidate,
  active,
  onPick,
}: {
  candidate: MentionCandidate;
  active: boolean;
  onPick: (candidate: MentionCandidate) => void;
}) {
  const thumb = useMentionCandidateThumb(candidate);
  const Icon = candidate.kind === "image" ? ImageIcon : candidate.kind === "video" ? Video : candidate.kind === "audio" ? Music2 : FileText;
  return (
    <button
      type="button"
      className={`wb-mention-item ${active ? "active" : ""}`}
      onPointerDown={(event) => {
        event.preventDefault();
        onPick(candidate);
      }}
    >
      <span className="wb-mention-thumb">{thumb ? <img src={thumb} alt="" /> : <Icon size={14} />}</span>
      <span className="wb-mention-copy">
        <b>{candidate.label}</b>
        <small>{candidate.source === "shelf" ? "当前引用架" : "资产库"} · {candidate.kind}</small>
      </span>
    </button>
  );
}

const mentionThumbCache = new Map<string, string>();

function useMentionCandidateThumb(candidate: MentionCandidate) {
  const cacheKey = candidate.assetId ? `${candidate.scope || "personal"}:${candidate.assetId}` : "";
  const [url, setUrl] = useState(() => cacheKey ? mentionThumbCache.get(cacheKey) || "" : "");
  useEffect(() => {
    if (url || !cacheKey || candidate.kind !== "image" || !candidate.assetId) return;
    let alive = true;
    getAssetContentObjectUrl(candidate.assetId, candidate.scope || "personal", 320)
      .then((value) => {
        mentionThumbCache.set(cacheKey, value);
        if (alive) setUrl(value);
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [cacheKey, candidate.assetId, candidate.kind, candidate.scope, url]);
  return url;
}

function splitPromptTokens(prompt: string): Array<{ type: "text"; value: string } | { type: "token"; raw: string; id: string }> {
  const parts: Array<{ type: "text"; value: string } | { type: "token"; raw: string; id: string }> = [];
  let cursor = 0;
  for (const match of prompt.matchAll(TOKEN_PATTERN)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ type: "text", value: prompt.slice(cursor, index) });
    parts.push({ type: "token", raw: match[0], id: match[1] });
    cursor = index + match[0].length;
  }
  if (cursor < prompt.length) parts.push({ type: "text", value: prompt.slice(cursor) });
  return parts.length ? parts : [{ type: "text", value: prompt }];
}
