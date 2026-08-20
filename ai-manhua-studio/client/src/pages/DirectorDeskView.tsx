import { ArrowLeft, ArrowUpRight, Box, Check, Clapperboard, Loader2, Save, WandSparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import {
  createProject,
  getProject,
  getProjectSnapshot,
  publicApiError,
  saveProjectSnapshot,
  type Asset,
  type WorkspaceScope,
  uploadAsset,
} from "@/services/api";
import { extractProjectCanvasData, extractServerCanvasSnapshotData } from "@/lib/canvas-snapshot-roundtrip";
import { applyDirectorFrameToCanvasSnapshot, canvasDirectorOutputExists } from "@/lib/director-canvas";

type DirectorAction =
  | "capabilities.get"
  | "project.get"
  | "timeline.get"
  | "export.frame"
  | "export.video"
  | "plugin.result.submit"
  | "plugin.results.list";

type DirectorResponse = {
  protocolVersion: number;
  requestId: string;
  action: DirectorAction | "unknown";
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
};

type PendingRequest = {
  action: DirectorAction;
  reject: (error: Error) => void;
  resolve: (response: DirectorResponse) => void;
  timeout: number;
};

type FrameExportResult = {
  dataUrl?: string;
  width?: number;
  height?: number;
  fileName?: string;
};

const protocolVersion = 1;
const scopeOptions: Array<{ value: WorkspaceScope; label: string }> = [
  { value: "personal", label: "个人空间" },
  { value: "team", label: "团队空间" },
];

export default function DirectorDeskView() {
  const [, navigate] = useLocation();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const pendingRef = useRef(new Map<string, PendingRequest>());
  const query = useMemo(() => new URLSearchParams(window.location.search), []);
  const canvasId = (query.get("canvasId") || "").trim().slice(0, 160);
  const nodeId = (query.get("nodeId") || "").trim().slice(0, 160);
  const requestedReturnPath = (query.get("returnTo") || "").trim();
  const returnPath = requestedReturnPath.startsWith("/canvas/")
    ? requestedReturnPath
    : canvasId ? `/canvas/${encodeURIComponent(canvasId)}?scope=${query.get("scope") === "team" ? "team" : "personal"}` : "/canvas";
  const hasCanvasTarget = Boolean(canvasId && nodeId);
  const instanceId = useMemo(() => (query.get("instanceId") || "").trim().slice(0, 128) || `ai-manju-director-${crypto.randomUUID()}`, [query]);
  const directorSrc = useMemo(() => {
    const url = new URL("/director-desk/index.html", window.location.origin);
    url.searchParams.set("instanceId", instanceId);
    url.searchParams.set("theme", "dark");
    url.searchParams.set("hostOrigin", window.location.origin);
    return url.toString();
  }, [instanceId]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastAsset, setLastAsset] = useState<Asset | null>(null);
  const [lastFrame, setLastFrame] = useState<FrameExportResult | null>(null);
  const [capabilities, setCapabilities] = useState<Record<string, unknown> | null>(null);
  const [scope, setScope] = useState<WorkspaceScope>(() => query.get("scope") === "team" ? "team" : "personal");

  const requestDirector = useCallback(async (action: DirectorAction, options?: Record<string, unknown>) => {
    const target = iframeRef.current?.contentWindow;
    if (!target) throw new Error("导演台 iframe 尚未准备好");
    const requestId = crypto.randomUUID();
    return new Promise<unknown>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        pendingRef.current.delete(requestId);
        reject(new Error(`导演台请求超时：${action}`));
      }, action === "export.video" ? 60_000 : 20_000);
      pendingRef.current.set(requestId, {
        action,
        timeout,
        reject,
        resolve: (response) => response.ok
          ? resolve(response.data)
          : reject(new Error(response.error?.message || "导演台请求失败")),
      });
      target.postMessage({
        type: "storyai:director-desk:request",
        payload: { requestId, action, ...(options ? { options } : {}) },
      }, window.location.origin);
    });
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== iframeRef.current?.contentWindow) return;
      if (event.data?.type === "storyai:director-desk-ready") {
        iframeRef.current?.contentWindow?.postMessage({
          type: "storyai:director-desk-session",
          payload: { instanceId, theme: "dark" },
        }, window.location.origin);
        setReady(true);
        void requestDirector("capabilities.get")
          .then((data) => setCapabilities(isRecord(data) ? data : null))
          .catch(() => undefined);
        return;
      }
      if (event.data?.type !== "storyai:director-desk:response") return;
      const response = event.data.payload as DirectorResponse;
      if (!isDirectorResponse(response)) return;
      const pending = pendingRef.current.get(response.requestId);
      if (!pending) return;
      window.clearTimeout(pending.timeout);
      pendingRef.current.delete(response.requestId);
      if (response.action !== pending.action) {
        pending.reject(new Error(`导演台响应操作不匹配：${pending.action} / ${response.action}`));
        return;
      }
      pending.resolve(response);
    };
    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
      pendingRef.current.forEach((pending) => {
        window.clearTimeout(pending.timeout);
        pending.reject(new Error("导演台 iframe 已关闭"));
      });
      pendingRef.current.clear();
    };
  }, [instanceId, requestDirector]);

  const captureFrameAsset = async () => {
    const data = await requestDirector("export.frame", { fileName: "director-frame.png", position: "current", quality: "720p" });
    const frame = normalizeFrameResult(data);
    if (!frame.dataUrl) throw new Error("导演台没有返回可上传的当前帧");
    const file = dataUrlToFile(frame.dataUrl, frame.fileName || "director-frame.png");
    const asset = await uploadAsset(file, {
      type: "image",
      category: "reference",
      source_type: "canvas",
      source_project_id: canvasId || instanceId,
      source_project_name: hasCanvasTarget ? "3D 导演台画布回写" : "3D 导演台",
      source_metadata: JSON.stringify({ source: "3d-director-desk", instanceId, canvasId: canvasId || undefined, nodeId: nodeId || undefined, protocolVersion }),
      name: frame.fileName || "director-frame.png",
      note: "3D director desk frame export",
    }, scope);
    setLastFrame(frame);
    setLastAsset(asset);
    return { frame, asset };
  };

  const exportFrame = async () => {
    setBusy(true);
    try {
      await captureFrameAsset();
      toast.success("当前帧已保存到资产库");
    } catch (error) {
      toast.error(publicApiError(error, "导出导演台当前帧失败"));
    } finally {
      setBusy(false);
    }
  };

  const sendToCanvas = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (hasCanvasTarget) {
        const [projectState, timelineState, project] = await Promise.all([
          requestDirector("project.get"),
          requestDirector("timeline.get"),
          getProject(canvasId, scope),
        ]);
        const projectData = isRecord(projectState) ? projectState : {};
        const timeline = isRecord(timelineState) ? timelineState : {};
        const projectFingerprint = stringValue(projectData.projectFingerprint) || stringValue(projectData.project_fingerprint);
        if (!projectFingerprint) throw new Error("导演台没有返回有效的工程指纹");
        const activeCameraId = stringValue(timeline.activeCameraId) || stringValue(timeline.active_camera_id) || "current-camera";
        const progress = Math.max(0, Math.min(1, numberValue(timeline.progress)));
        const outputKey = `${instanceId}:${projectFingerprint}:${activeCameraId}:${progress.toFixed(6)}`;
        let snapshotData: Record<string, unknown> | null = null;
        try {
          snapshotData = extractServerCanvasSnapshotData(await getProjectSnapshot(canvasId, scope));
        } catch {
          snapshotData = null;
        }
        if (!snapshotData) snapshotData = extractProjectCanvasData(project.data);
        if (!snapshotData) throw new Error("未取得完整画布快照，已停止导演台回写");
        if (canvasDirectorOutputExists(snapshotData, nodeId, outputKey)) {
          toast.info("当前工程与机位帧已经生成过，未重复创建图片节点");
          navigate(returnPath);
          return;
        }
        const { frame, asset } = await captureFrameAsset();
        const applied = applyDirectorFrameToCanvasSnapshot({
          snapshot: snapshotData,
          asset,
          frame,
          identity: { instanceId, canvasId, nodeId, outputKey, projectFingerprint, activeCameraId, progress, scope },
          createNodeId: () => crypto.randomUUID(),
          createEdgeId: () => crypto.randomUUID(),
          now: new Date().toISOString(),
        });
        await saveProjectSnapshot(canvasId, applied.snapshot, scope);
        toast.success("当前机位已回写来源画布");
        navigate(returnPath);
        return;
      }
      if (!lastAsset) {
        toast.warning("请先导出当前帧");
        return;
      }
      const project = await createProject({
        scope,
        title: `导演台构图 ${new Date().toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`,
        data: {
          nodes: [{
            id: crypto.randomUUID(),
            kind: "image",
            title: lastAsset.name || "导演台构图",
            content: "从 3D 导演台导出的构图占位图。",
            x: 120,
            y: 120,
            width: 340,
            height: 240,
            imageAssetId: lastAsset.id,
          }],
          edges: [],
          zoom: 90,
        },
      });
      navigate(`/canvas/${encodeURIComponent(project.id)}?scope=${scope}`);
    } catch (error) {
      toast.error(publicApiError(error, "送入画布失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="feature-page director-page director-embed-page">
      <div className="feature-title">
        <div>
          <p className="eyebrow">DIRECTOR / EMBED</p>
          <h1>{hasCanvasTarget ? "画布 3D 导演台" : "3D 导演台"}</h1>
          <p>{hasCanvasTarget ? "当前机位会回写原 Director 节点，并创建相连的图片结果节点。" : "真实嵌入 director-desk，导出的当前帧会进入资产库，并可衍生为画布节点。"}</p>
        </div>
        <div className="director-actions">
          {hasCanvasTarget ? <button className="outline-button small" onClick={() => navigate(returnPath)} disabled={busy}><ArrowLeft size={15} /> 返回画布</button> : null}
          <div className="scope-switch mini-scope">{scopeOptions.map((item) => <button key={item.value} className={scope === item.value ? "active" : ""} onClick={() => setScope(item.value)} disabled={hasCanvasTarget || busy}>{item.label}</button>)}</div>
          <span className={`status-chip ${ready ? "succeeded" : "running"}`}>{ready ? "已连接" : "等待导演台"}</span>
          <button className="outline-button small" onClick={() => void exportFrame()} disabled={!ready || busy}><Save size={15} /> {busy ? "保存中" : "保存当前帧"}</button>
          <button className="vermilion-button" onClick={() => void sendToCanvas()} disabled={!ready || busy || (!hasCanvasTarget && !lastAsset)}><WandSparkles size={16} /> {hasCanvasTarget ? "保存并返回画布" : "送入画布"}</button>
        </div>
      </div>
      <div className="director-embed-layout">
        <section className="director-frame-shell">
          {!ready && <div className="director-loading"><Loader2 className="spin" size={28} /><span>正在连接导演台…</span></div>}
          <iframe ref={iframeRef} src={directorSrc} title="3D 导演台" />
        </section>
        <aside className="director-embed-side">
          <p className="eyebrow">EXPORT RESULT</p>
          <div className="director-export-card">
            {lastFrame?.dataUrl ? <img src={lastFrame.dataUrl} alt="导演台当前帧" /> : <Box size={34} />}
            <b>{lastAsset?.name || "暂无导出帧"}</b>
            <span>{lastFrame?.width && lastFrame?.height ? `${lastFrame.width} × ${lastFrame.height}` : "导出后显示尺寸"}</span>
          </div>
          <div className="director-capability-list">
            <div><Clapperboard size={16} /><span>协议版本</span><b>{String(capabilities?.protocolVersion || protocolVersion)}</b></div>
            <div><Check size={16} /><span>资产归档</span><b>{lastAsset ? "已写入" : "待导出"}</b></div>
            <button onClick={() => window.open(directorSrc, "_blank")}><ArrowUpRight size={15} /> 独立打开导演台</button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function isDirectorResponse(value: unknown): value is DirectorResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Partial<DirectorResponse>;
  return response.protocolVersion === protocolVersion
    && typeof response.requestId === "string"
    && typeof response.ok === "boolean";
}

function normalizeFrameResult(data: unknown): FrameExportResult {
  if (!isRecord(data)) return {};
  return {
    dataUrl: typeof data.dataUrl === "string" ? data.dataUrl : typeof data.data_url === "string" ? data.data_url : "",
    width: Number(data.width) || undefined,
    height: Number(data.height) || undefined,
    fileName: typeof data.fileName === "string" ? data.fileName : typeof data.file_name === "string" ? data.file_name : "director-frame.png",
  };
}

function dataUrlToFile(dataUrl: string, fileName: string) {
  const [meta = "", data = ""] = dataUrl.split(",");
  const type = meta.match(/^data:(.*?);base64$/)?.[1] || "image/png";
  const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
  return new File([bytes], fileName, { type });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
