import { useEffect, useRef, useState } from "react";
import { Check, Folder, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { publicApiError } from "@/shared/api/errors";
import { CANVAS_LIBRARY_CATEGORIES, DEFAULT_CANVAS_LIBRARY_CATEGORY, type CanvasLibraryCategory } from "../domain/assetFolders";

export type CanvasArchiveAssetDialogProps = {
  open: boolean;
  nodeKey: string;
  assetName: string;
  projectTitle: string;
  onOpenChange: (open: boolean) => void;
  onSave: (category: CanvasLibraryCategory) => Promise<void>;
};

export function CanvasArchiveAssetDialog({ open, nodeKey, assetName, projectTitle, onOpenChange, onSave }: CanvasArchiveAssetDialogProps) {
  const [category, setCategory] = useState<CanvasLibraryCategory>(DEFAULT_CANVAS_LIBRARY_CATEGORY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef(false);
  useEffect(() => { setCategory(DEFAULT_CANVAS_LIBRARY_CATEGORY); setError(""); }, [open, nodeKey]);
  const save = async () => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      await onSave(category);
      onOpenChange(false);
    } catch (cause) {
      setError(publicApiError(cause, "加入素材库失败，请重试"));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  return <Dialog open={open} onOpenChange={next => { if (!saving.current) onOpenChange(next); }}>
    <DialogContent className="sm:max-w-[440px]" showCloseButton={!busy}>
      <DialogHeader>
        <DialogTitle>加入素材库</DialogTitle>
        <DialogDescription>保存到当前画布的专属文件夹，未分类素材默认放入“其他”。</DialogDescription>
      </DialogHeader>
      <div className="min-w-0 rounded-xl border border-border bg-muted/30 px-4 py-3">
        <p className="truncate text-sm font-medium" title={projectTitle}>{projectTitle}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground" title={assetName}>{assetName}</p>
      </div>
      <div role="radiogroup" aria-label="素材分类" className="grid grid-cols-4 gap-2">
        {CANVAS_LIBRARY_CATEGORIES.map(option => <button key={option.value} type="button" role="radio"
          aria-checked={category === option.value} disabled={busy} onClick={() => setCategory(option.value)}
          className={`relative flex flex-col items-center gap-2 rounded-xl border px-2 py-4 text-sm transition-colors disabled:opacity-60 ${category === option.value ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}>
          <Folder size={20} /><span>{option.label}</span>
          {category === option.value ? <Check size={12} className="absolute right-2 top-2" /> : null}
        </button>)}
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <DialogFooter>
        <button type="button" className="outline-button" disabled={busy} onClick={() => onOpenChange(false)}>取消</button>
        <button type="button" className="primary-button" disabled={busy} onClick={() => void save()}>
          {busy ? <><Loader2 size={14} className="animate-spin" /> 保存中…</> : "确认加入"}
        </button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
