import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { memberQueryKeys } from "@/features/member";
import { publicApiError } from "@/shared/api/errors";
import { changedPriceCount, modelPriceDraft, modelPricesQueryKey, parsePriceDraft, type PriceDraft } from "../model/modelPrices";
import { fetchAdminModelPrices, saveAdminModelPrices } from "../services/adminModelPricesApi";

export function useModelPricesController(readOnly: boolean) {
  const client = useQueryClient();
  const [draft, setDraft] = useState<PriceDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const query = useQuery({ queryKey: modelPricesQueryKey, queryFn: fetchAdminModelPrices, enabled: draft === null && !busy, refetchOnWindowFocus: false });
  const changes = draft && query.data ? changedPriceCount(draft, query.data) : 0;

  useEffect(() => {
    if (!changes) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [changes]);

  function edit(update: (draft: PriceDraft) => void) {
    if (readOnly || busy || !query.data) return;
    const next = structuredClone(draft ?? modelPriceDraft(query.data));
    update(next);
    setDraft(next);
    setError("");
    setSaved(false);
  }

  async function save() {
    if (readOnly || busy || !draft || !query.data || !changes) return;
    let value;
    try { value = parsePriceDraft(draft, query.data); }
    catch (e) { setError((e as Error).message); return; }
    setBusy(true);
    setError("");
    try {
      const result = await saveAdminModelPrices(value);
      client.setQueryData(modelPricesQueryKey, result.value);
      setDraft(null);
      setSaved(true);
      await Promise.all([
        client.invalidateQueries({ queryKey: memberQueryKeys.all }),
        client.invalidateQueries({ queryKey: ["admin", "billing-configs"] }),
        client.invalidateQueries({ queryKey: ["admin", "audit-logs"] }),
      ]);
    } catch (e) {
      setError(publicApiError(e, "保存失败，请重试；本次修改仍保留在页面中。"));
    } finally { setBusy(false); }
  }

  return {
    query, draft: draft ?? (query.data ? modelPriceDraft(query.data) : null), changes, busy, error, saved, edit, save,
    discard: () => { if (!busy) { setDraft(null); setError(""); setSaved(false); } },
  };
}
