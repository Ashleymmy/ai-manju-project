import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Database, RefreshCw, ServerCog } from "lucide-react";
import StudioShell from "@/components/StudioShell";
import { getCollection, type ApiError } from "@/services/api";

export type ModuleConfig = { eyebrow: string; title: string; description: string; endpoints: string[]; loader?: () => Promise<unknown>; notes: string[] };

export default function ModulePage({ config }: { config: ModuleConfig }) {
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">(config.loader ? "loading" : "idle");
  const [payload, setPayload] = useState<unknown>(null);
  const [error, setError] = useState<string>();
  const load = useCallback(async () => {
    if (!config.loader) return;
    setState("loading"); setError(undefined);
    try { setPayload(await config.loader()); setState("ready"); } catch (reason) { setError((reason as ApiError).message || "无法读取数据"); setState("error"); }
  }, [config]);
  useEffect(() => { void load(); }, [load]);
  const collection = getCollection(payload);
  return <StudioShell eyebrow={config.eyebrow} title={config.title}>
    <main className="module-page"><section className="module-hero"><div><div className="section-kicker"><ServerCog size={16} />CREATIVE WORKSURFACE</div><h2>{config.description}</h2><p>内容连接到工作区后才呈现；尚未连接时，系统会保留干净的空白工作面，而不是填充演示资产。</p></div>{config.loader && <button className="compact-action" onClick={() => void load()} disabled={state === "loading"}><RefreshCw size={15} className={state === "loading" ? "spin" : ""} />刷新工作区</button>}</section>
      <section className="module-content-grid"><article className="live-data-card"><div className="section-kicker"><Database size={16} />工作面内容</div>{state === "loading" && <div className="data-placeholder">正在连接你的工作区…</div>}{state === "error" && <div className="data-error"><AlertTriangle size={18} /><div><b>工作区数据等待连接</b><span>连接服务后，真实项目与资产会显示在这里。</span></div></div>}{state === "idle" && <div className="data-placeholder">此工作面将在需要时加载内容。</div>}{state === "ready" && <><strong className="record-count">{collection.total ?? collection.items.length}</strong><span className="record-label">已归入当前工作面的记录</span><pre>{JSON.stringify(collection.items.slice(0, 3), null, 2)}</pre></>}</article>
      <article className="contract-card"><div className="section-kicker"><ServerCog size={16} />创作提示</div><div className="module-notes">{config.notes.map((note) => <p key={note}>{note}</p>)}</div><div className="creative-grid-markers"><i /><i /><i /><i /><i /><i /><i /><i /><i /></div><details className="diagnostics"><summary>服务诊断与端点</summary><ul>{config.endpoints.map((endpoint) => <li key={endpoint}><code>{endpoint}</code></li>)}</ul>{error && <code>{error}</code>}</details></article></section>
    </main>
  </StudioShell>;
}
