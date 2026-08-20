import { BookOpen, Loader2, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { buildPromptLibraryEntries, filterPromptLibraryEntries } from "@/lib/prompt-library";
import { getPreferences, listAllSystemPrompts, publicApiError, type PromptPreset, type SystemPrompt } from "@/services/api";

type PromptLibraryDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (prompt: string) => void;
};

export default function PromptLibraryDialog({ open, onOpenChange, onSelect }: PromptLibraryDialogProps) {
  const [systemPrompts, setSystemPrompts] = useState<SystemPrompt[]>([]);
  const [personalPrompts, setPersonalPrompts] = useState<PromptPreset[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const entries = useMemo(
    () => filterPromptLibraryEntries(buildPromptLibraryEntries(systemPrompts, personalPrompts), query),
    [personalPrompts, query, systemPrompts],
  );

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    setLoading(true);
    setError("");
    Promise.allSettled([listAllSystemPrompts(), getPreferences()]).then(([systemResult, personalResult]) => {
      if (disposed) return;
      if (systemResult.status === "fulfilled") setSystemPrompts(systemResult.value);
      else setSystemPrompts([]);
      if (personalResult.status === "fulfilled") setPersonalPrompts(personalResult.value.canvas?.promptPresets || []);
      else setPersonalPrompts([]);
      if (systemResult.status === "rejected" && personalResult.status === "rejected") {
        setError(publicApiError(systemResult.reason, "读取提示词库失败"));
      }
    }).finally(() => {
      if (!disposed) setLoading(false);
    });
    return () => { disposed = true; };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="prompt-library-dialog">
        <DialogHeader>
          <DialogTitle>提示词库</DialogTitle>
          <DialogDescription>搜索系统提示词与个人预设，选择后插入当前输入框。</DialogDescription>
        </DialogHeader>
        <div className="tag-search">
          <Search size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、正文、分类或标签" autoFocus />
        </div>
        <div className="prompt-library-list">
          {loading ? <div className="empty-output"><Loader2 className="spin" size={24} /><p>正在读取提示词库…</p></div> : null}
          {!loading && error ? <div className="empty-output"><p>{error}</p></div> : null}
          {!loading && !error && entries.map((item) => (
            <button key={item.id} type="button" onClick={() => { onSelect(item.prompt); onOpenChange(false); }}>
              <BookOpen size={16} />
              <span>
                <b>{item.title}</b>
                <small>{item.prompt}</small>
              </span>
              <i>{item.source === "personal" ? "个人" : item.category || "系统"}</i>
            </button>
          ))}
          {!loading && !error && !entries.length ? <div className="empty-output"><p>没有匹配的提示词</p></div> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
