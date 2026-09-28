import { useCallback, useEffect, useRef, useState } from "react";
import { listComicAnalysisHistory, resumeComicAnalysis, type ComicAnalysisDetail, type ComicAnalysisSummary } from "@/entities/comic";
import type { WorkspaceScope } from "@/shared/config";
import { publicApiError } from "@/shared/api/errors";
import { getAuthToken } from "@/shared/api/http";
import { useComicViewContext } from "./useComicViewContext";

export function useComicAnalysisHistory(scope: WorkspaceScope, onRecovered: (detail: ComicAnalysisDetail, signal: AbortSignal) => void | Promise<void>) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ComicAnalysisSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [resuming, setResuming] = useState("");
  const [error, setError] = useState("");
  const { captureView, invalidateView } = useComicViewContext();
  const resumeController = useRef<AbortController | null>(null);
  const listController = useRef<AbortController | null>(null);
  const token = getAuthToken();

  const close = useCallback(() => {
    invalidateView(); resumeController.current?.abort(); listController.current?.abort();
    resumeController.current = null; listController.current = null;
    setOpen(false); setBusy(false); setResuming(""); setItems([]); setError(""); setNextCursor(undefined);
  }, [invalidateView]);
  useEffect(() => {
    close();
    return () => { invalidateView(); resumeController.current?.abort(); listController.current?.abort(); };
  }, [scope, token, close, invalidateView]);
  const load = async (cursor?: string) => {
    listController.current?.abort();
    const controller = new AbortController(); listController.current = controller;
    const isCurrent = captureView("history-list");
    setOpen(true); setBusy(true); setError("");
    try {
      const page = await listComicAnalysisHistory(scope, cursor, controller.signal);
      if (!isCurrent() || controller.signal.aborted) return;
      setItems(previous => cursor ? [...previous, ...page.items.filter(item => !previous.some(old => old.id === item.id))] : page.items);
      setNextCursor(page.next_cursor);
    } catch (cause) {
      if (isCurrent() && !controller.signal.aborted) setError(publicApiError(cause, "读取分析记录失败，请稍后重试"));
    } finally {
      if (listController.current === controller && !controller.signal.aborted) {
        listController.current = null;
        if (isCurrent()) setBusy(false);
        else if (getAuthToken() !== token) close();
      }
    }
  };
  const resume = async (id: string) => {
    resumeController.current?.abort();
    const controller = new AbortController(); resumeController.current = controller;
    const isCurrent = captureView("history-resume");
    setResuming(id); setError("");
    try {
      const detail = await resumeComicAnalysis(id, scope, controller.signal);
      if (!isCurrent() || controller.signal.aborted) return;
      await onRecovered(detail, controller.signal);
      if (isCurrent() && !controller.signal.aborted) close();
    } catch (cause) {
      if (isCurrent() && !controller.signal.aborted) setError(publicApiError(cause, "原分析尚未取回，可稍后继续查看"));
    } finally {
      if (resumeController.current === controller && !controller.signal.aborted) {
        resumeController.current = null;
        if (isCurrent()) setResuming("");
        else if (getAuthToken() !== token) close();
      }
    }
  };
  return { open, items, nextCursor, busy, resuming, error, close, load, resume };
}
