import { useEffect, useRef, useState } from "react";
import { Loader2, Search, Tag } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { listAssetTagDetails, type SemanticTag } from "@/entities/tag";
import type { WorkspaceScope } from "@/shared/config";
import { semanticTagPath } from "@/features/tags";
import { publicApiError } from "@/shared/api/errors";

// Bound concurrent reads for a full page of selected assets.
const TAG_READ_CONCURRENCY = 5;
type ExistingTag = { tag: SemanticTag; assetIds: string[] };

export function AssetBulkTagsDialog({ assetIds, scope, tags, onClose, onSave }: {
  assetIds: string[];
  scope: WorkspaceScope;
  tags: SemanticTag[];
  onClose: () => void;
  onSave: (tagIds: string[], action: "add" | "remove", affectedIds: string[]) => Promise<void>;
}) {
  const count = assetIds.length;
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [action, setAction] = useState<"add" | "remove">("add");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef(false);
  const [existing, setExisting] = useState<ExistingTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (action !== "remove") return;
    const abort = new AbortController();
    setLoading(true); setLoadError(""); setExisting([]);
    const load = async () => {
      const found = new Map<string, ExistingTag>();
      for (let offset = 0; offset < assetIds.length; offset += TAG_READ_CONCURRENCY) {
        if (abort.signal.aborted) return;
        const batch = assetIds.slice(offset, offset + TAG_READ_CONCURRENCY);
        const results = await Promise.all(batch.map(id => listAssetTagDetails(scope, id, abort.signal)));
        results.forEach((result, index) => result.items.forEach(({ tag, binding }) => {
          if (binding.state !== "active") return;
          const entry = found.get(tag.id) || { tag, assetIds: [] };
          if (!entry.assetIds.includes(batch[index])) entry.assetIds.push(batch[index]);
          found.set(tag.id, entry);
        }));
      }
      if (!abort.signal.aborted) setExisting(Array.from(found.values()).sort((a, b) => b.assetIds.length - a.assetIds.length || a.tag.name.localeCompare(b.tag.name)));
    };
    void load().catch(cause => {
      if (!abort.signal.aborted) setLoadError(publicApiError(cause, "读取资产标签失败，请重试"));
    }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [action, assetIds, scope, retry]);
  const changeAction = (next: "add" | "remove") => {
    if (next === action) return;
    setAction(next); setChosen([]); setQuery(""); setError("");
    if (next === "remove") setLoading(true);
  };
  const candidates = action === "remove" ? existing.map(entry => entry.tag) : tags;
  const pathTags = [...tags, ...existing.map(entry => entry.tag).filter(tag => !tags.some(item => item.id === tag.id))];
  const visible = candidates.filter(tag => semanticTagPath(tag.id, pathTags).toLowerCase().includes(query.trim().toLowerCase()));
  const affectedIds = action === "remove"
    ? Array.from(new Set(existing.filter(entry => chosen.includes(entry.tag.id)).flatMap(entry => entry.assetIds)))
    : assetIds;
  const removalUnavailable = action === "remove" && (loading || Boolean(loadError));
  const save = async () => {
    if (saving.current || !chosen.length || !affectedIds.length || removalUnavailable) return;
    saving.current = true; setBusy(true); setError("");
    try { await onSave(chosen, action, affectedIds); onClose(); }
    catch (cause) { setError(publicApiError(cause, "批量修改标签失败，请重试")); }
    finally { saving.current = false; setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !saving.current) onClose(); }}>
    <DialogContent data-keep-asset-selection="true" className="asset-bulk-tags-dialog sm:max-w-[520px]" showCloseButton={!busy}>
      <DialogHeader><DialogTitle>批量编辑标签</DialogTitle><DialogDescription>为选中的 {count} 项资产统一添加或移除标签，其他标签保持不变。</DialogDescription></DialogHeader>
      <div className="asset-tag-action" role="group" aria-label="标签操作">
        <button disabled={busy} aria-pressed={action === "add"} onClick={() => changeAction("add")}>添加标签</button>
        <button disabled={busy} aria-pressed={action === "remove"} onClick={() => changeAction("remove")}>移除标签</button>
      </div>
      <label className="asset-bulk-tag-search"><Search size={16} /><input aria-label="搜索标签" placeholder="搜索标签名称…" value={query} disabled={busy} onChange={event => setQuery(event.target.value)} /></label>
      <div className="asset-bulk-tag-list">
        {action === "remove" && loading ? <p role="status">正在读取所选资产的标签…</p> : action === "remove" && loadError ? <div role="alert"><p>{loadError}</p><button className="outline-button" onClick={() => setRetry(value => value + 1)}>重新读取</button></div> : <>{visible.map(tag => <label key={tag.id} className={chosen.includes(tag.id) ? "chosen" : ""}>
          <input type="checkbox" checked={chosen.includes(tag.id)} disabled={busy} onChange={() => setChosen(ids => ids.includes(tag.id) ? ids.filter(id => id !== tag.id) : [...ids, tag.id])} />
          <Tag size={14} /><span>{semanticTagPath(tag.id, pathTags)}</span>
          {action === "remove" && <small className="asset-tag-coverage">{existing.find(entry => entry.tag.id === tag.id)?.assetIds.length}/{count} 项</small>}
        </label>)}
        {!visible.length && <p>{candidates.length ? "没有匹配的标签" : action === "remove" ? "所选资产暂无可移除的标签。" : "暂无标签，请先在标签库创建标签。"}</p>}</>}
      </div>
      <small>已选择 {chosen.length} 个标签</small>
      {action === "remove" && !removalUnavailable && <small>将影响 {affectedIds.length} 项资产；其他标签和标签库中的标签保留。</small>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter><button className="outline-button" disabled={busy} onClick={onClose}>取消</button><button className="primary-button" disabled={busy || !chosen.length || !affectedIds.length || removalUnavailable} onClick={() => void save()}>{busy ? <><Loader2 className="animate-spin" size={15} /> 保存中…</> : action === "add" ? "确认添加" : `从 ${affectedIds.length} 项资产移除`}</button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
