// [画布别名] 后台别名页的草稿、保存与撤销。
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { invalidateModelCatalog } from "@/entities/model";
import { publicApiError } from "@/shared/api/errors";
import { canvasNicknamesQueryKey, changedCanvasNicknameCount, normalizeCanvasNicknames, parseCanvasNicknameDraft } from "../model/canvasNicknames";
import { fetchAdminCanvasNicknames, saveAdminCanvasNicknames } from "../services/adminCanvasNicknamesApi";

export function useCanvasNicknamesController(readOnly: boolean) {
  const client = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const query = useQuery({ queryKey: canvasNicknamesQueryKey, queryFn: fetchAdminCanvasNicknames, enabled: draft === null && !busy, refetchOnWindowFocus: false });
  const savedNicknames = query.data?.nicknames ?? {};
  const changes = draft ? changedCanvasNicknameCount(draft, savedNicknames) : 0;

  useEffect(() => {
    if (!changes) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [changes]);

  function edit(id: string, nickname: string) {
    if (readOnly || busy || !query.data) return;
    setDraft({ ...(draft ?? query.data.nicknames), [id]: nickname });
    setError("");
    setSaved(false);
  }

  async function save() {
    if (readOnly || busy || !draft || !query.data || !changes) return;
    let value;
    try { value = parseCanvasNicknameDraft(draft); }
    catch (e) { setError((e as Error).message); return; }
    setBusy(true);
    setError("");
    try {
      const result = await saveAdminCanvasNicknames(value);
      client.setQueryData(canvasNicknamesQueryKey, { ...query.data, nicknames: normalizeCanvasNicknames(result.value) });
      setDraft(null);
      setSaved(true);
      await Promise.all([
        invalidateModelCatalog(client),
        client.invalidateQueries({ queryKey: ["admin", "billing-configs"] }),
        client.invalidateQueries({ queryKey: ["admin", "audit-logs"] }),
      ]);
    } catch (e) {
      setError(publicApiError(e, "保存失败，请重试；本次修改仍保留在页面中。"));
    } finally { setBusy(false); }
  }

  return {
    query, nicknames: draft ?? savedNicknames, changes, busy, error, saved, edit, save,
    discard: () => { if (!busy) { setDraft(null); setError(""); setSaved(false); } },
  };
}
