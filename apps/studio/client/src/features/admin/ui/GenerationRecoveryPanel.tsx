import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Loader2, RefreshCcw } from "lucide-react";
import { isAdminTierRole, isReadOnlyAdminRole } from "@/entities/auth";
import { publicApiError } from "@/shared/api/errors";
import { formatTime } from "../model/format";
import {
  fetchGenerationRecovery,
  GENERATION_RECOVERY_PAGE_SIZE,
  GENERATION_RECOVERY_QUERY_KEY,
  resumeGenerationRecovery,
  type GenerationRecoveryPage,
  type GenerationRecoveryRow,
} from "../services/generationRecoveryApi";
import "./generationRecovery.css";

const RECOVERY_PHASE_LABELS: Record<string, string> = {
  image_submission_uncertain: "图片提交待确认",
  video_submission_uncertain: "视频提交待确认",
  image_recovery_pending: "图片结果恢复中",
  video_recovery_pending: "视频结果恢复中",
  video_recovery_attention: "视频恢复待核查",
  image_recovery_attention: "图片恢复待核查",
  waiting_dispatch: "等待调度",
};

/** Unmount the query entirely outside an active administrator view. */
export function GenerationRecoveryPanel({ role, active = true }: { role?: string; active?: boolean }) {
  if (!active || !isAdminTierRole(role)) return null;
  return <RecoveryPanelContent key={role} readOnly={isReadOnlyAdminRole(role)} />;
}

function RecoveryPanelContent({ readOnly }: { readOnly: boolean }) {
  const client = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState("");
  const [message, setMessage] = useState("");
  const inFlight = useRef(new Set<string>());
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const queryKey = [...GENERATION_RECOVERY_QUERY_KEY, offset];
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchGenerationRecovery(offset, signal),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    // Recovery is explicitly refreshed; no background polling in hidden tabs.
    refetchInterval: false,
  });
  const total = query.data?.total ?? 0;
  const page = Math.floor(offset / GENERATION_RECOVERY_PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(total / GENERATION_RECOVERY_PAGE_SIZE));
  useEffect(() => {
    if (query.data && offset > 0 && offset >= query.data.total) {
      setOffset(Math.max(0, Math.ceil(query.data.total / GENERATION_RECOVERY_PAGE_SIZE) - 1) * GENERATION_RECOVERY_PAGE_SIZE);
    }
  }, [query.data, offset]);

  const resume = async (row: GenerationRecoveryRow) => {
    if (readOnly || !row.can_resume || row.recovery_requested || query.isError || inFlight.current.has(row.id)) return;
    inFlight.current.add(row.id);
    setPendingIds(new Set(inFlight.current));
    setActionError("");
    setMessage("");
    try {
      const updated = await resumeGenerationRecovery(row.id, row.checkpoint_revision);
      client.setQueryData<GenerationRecoveryPage>(queryKey, current => current ? {
        ...current, items: current.items.map(item => item.id === row.id ? updated : item),
      } : current);
      if (mounted.current) setMessage(`已请求恢复原任务 ${row.id}，后台将继续处理已有结果。`);
      await client.invalidateQueries({ queryKey: GENERATION_RECOVERY_QUERY_KEY });
    } catch (error) {
      if (mounted.current) setActionError(publicApiError(error, "未能确认恢复请求结果，请刷新任务状态后再试"));
      // A revision conflict or interrupted reply may mean recovery already began.
      await client.invalidateQueries({ queryKey: GENERATION_RECOVERY_QUERY_KEY });
    } finally {
      inFlight.current.delete(row.id);
      if (mounted.current) setPendingIds(new Set(inFlight.current));
    }
  };

  return <section className="generation-recovery-panel" aria-labelledby="generation-recovery-heading">
    <header className="generation-recovery-head">
      <div><h2 id="generation-recovery-heading">生成任务恢复</h2><p>仅查询原任务、核对提交回执、下载或导入已有结果，不重新生成，不产生新的生成费用。</p></div>
      <button type="button" className="outline-button small" disabled={query.isFetching} onClick={() => void query.refetch()}>
        <RefreshCcw size={15} className={query.isFetching ? "spin" : ""} /> 刷新恢复列表
      </button>
    </header>
    {readOnly ? <p className="generation-recovery-note">只读审计账号：可查看恢复状态，不能发起恢复。</p> : null}
    {actionError ? <p role="alert">{actionError}</p> : null}
    {message ? <p role="status">{message}</p> : null}
    {query.isError ? <p role="alert">{publicApiError(query.error, "恢复列表读取失败")} <button type="button" className="outline-button small" onClick={() => void query.refetch()}>重新加载恢复列表</button></p> : null}
    {query.isPending ? <p role="status"><Loader2 size={17} className="spin" /> 正在读取待恢复任务…</p> : query.data ? <>
      {query.data.items.length ? <div className="generation-recovery-table"><table>
        <caption className="sr-only">可核查和恢复的原生成任务</caption>
        <thead><tr><th scope="col">原任务 / 用户</th><th scope="col">模型 / Provider</th><th scope="col">恢复状态</th><th scope="col">更新时间</th>{!readOnly ? <th scope="col">操作</th> : null}</tr></thead>
        <tbody>{query.data.items.map(row => <tr key={row.id}>
          <td><strong>{row.id}</strong><small>用户：{row.user_id}</small><small>{row.type.startsWith("image.") ? "图片" : row.type.startsWith("video.") ? "视频" : row.type} · 工作区：{row.workspace_id || "未记录"}</small></td>
          <td>{row.model || "未记录模型"}<small>{row.provider_id || "未记录 Provider"}</small>{row.provider_task_id ? <small>上游任务：{row.provider_task_id}</small> : null}</td>
          <td><strong>{row.recovery_requested ? "已请求恢复" : RECOVERY_PHASE_LABELS[row.queue_phase] || (row.can_resume ? "可恢复原任务" : "暂不能恢复")}</strong><small>{row.reason || (row.can_resume ? "已有记录可继续处理" : "尚无可安全恢复的记录")}</small></td>
          <td>{formatTime(row.updated_at)}</td>
          {!readOnly ? <td><button type="button" className="outline-button small" disabled={!row.can_resume || row.recovery_requested || pendingIds.has(row.id) || query.isError} onClick={() => void resume(row)} aria-label={`恢复原任务 ${row.id}`}>
            {pendingIds.has(row.id) ? <><Loader2 size={14} className="spin" /> 正在请求…</> : row.recovery_requested ? "已请求恢复" : "恢复原任务"}
          </button></td> : null}
        </tr>)}</tbody>
      </table></div> : <p className="generation-recovery-note">当前没有待恢复任务。</p>}
      <footer className="generation-recovery-pagination">
        <span>共 {total} 条 · 第 {page} / {pages} 页</span>
        <div><button type="button" className="outline-button small" disabled={offset === 0 || query.isFetching} onClick={() => setOffset(Math.max(0, offset - GENERATION_RECOVERY_PAGE_SIZE))}><ChevronLeft size={14} /> 上一页</button>
          <button type="button" className="outline-button small" disabled={offset + GENERATION_RECOVERY_PAGE_SIZE >= total || query.isFetching} onClick={() => setOffset(offset + GENERATION_RECOVERY_PAGE_SIZE)}>下一页 <ChevronRight size={14} /></button></div>
      </footer>
    </> : null}
  </section>;
}
