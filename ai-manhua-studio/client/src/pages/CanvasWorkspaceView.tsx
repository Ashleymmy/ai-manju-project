import {
  Archive,
  ArrowRight,
  Check,
  ChevronRight,
  Copy,
  Download,
  Image as ImageIcon,
  Link2,
  Loader2,
  Maximize2,
  MousePointer2,
  PanelRight,
  Plus,
  Save,
  Sparkles,
  Trash2,
  Upload,
  WandSparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import {
  createProject,
  createAssetExport,
  fetchImageModels,
  generateImages,
  getAssetContentObjectUrl,
  getProject,
  getProjects,
  getProjectSnapshot,
  imageModelLabel,
  publicApiError,
  saveProjectSnapshot,
  uploadAsset,
  type CanvasProject,
  type GeneratedImage,
  type ImageModelCatalog,
  type WorkspaceScope,
} from "@/services/api";
import AgentPanel from "@/components/AgentPanel";

type CanvasNodeKind = "prompt" | "image" | "note";

type CanvasNodeData = {
  id: string;
  kind: CanvasNodeKind;
  title: string;
  content: string;
  x: number;
  y: number;
  width: number;
  height: number;
  imageAssetId?: string;
  imageSrc?: string;
};

type CanvasEdgeData = {
  id: string;
  from: string;
  to: string;
};

type CanvasSnapshotData = {
  nodes?: CanvasNodeData[];
  edges?: CanvasEdgeData[];
  zoom?: number;
};

const defaultPrompt = "雨夜，狭长街道，潮湿沥青反射红色招牌；人物在画面右侧停留，低机位缓慢推近，电影级冷暖对比。";
const scopeOptions: Array<{ value: WorkspaceScope; label: string }> = [
  { value: "personal", label: "个人空间" },
  { value: "team", label: "团队空间" },
];

function scopeFromLocation(location: string): WorkspaceScope {
  const query = location.includes("?") ? location.slice(location.indexOf("?") + 1) : window.location.search.replace(/^\?/, "");
  return new URLSearchParams(query).get("scope") === "team" ? "team" : "personal";
}

function canvasProjectHref(projectId: string, scope: WorkspaceScope) {
  return `/canvas/${encodeURIComponent(projectId)}?scope=${encodeURIComponent(scope)}`;
}

function starterNodes(): CanvasNodeData[] {
  return [
    {
      id: crypto.randomUUID(),
      kind: "prompt",
      title: "主提示词",
      content: defaultPrompt,
      x: 90,
      y: 130,
      width: 290,
      height: 178,
    },
    {
      id: crypto.randomUUID(),
      kind: "note",
      title: "镜头备注",
      content: "可把提示词节点连接到生成结果节点，快照会保存到服务端。",
      x: 460,
      y: 82,
      width: 260,
      height: 148,
    },
  ];
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export default function CanvasWorkspaceView() {
  const [location, navigate] = useLocation();
  const projectId = location.startsWith("/canvas/") ? decodeURIComponent(location.slice("/canvas/".length).split("?")[0]) : "";
  const [scope, setScope] = useState<WorkspaceScope>(() => scopeFromLocation(location));
  const [projects, setProjects] = useState<CanvasProject[]>([]);
  const [projectTitle, setProjectTitle] = useState("");
  const [nodes, setNodes] = useState<CanvasNodeData[]>([]);
  const [edges, setEdges] = useState<CanvasEdgeData[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [connectFrom, setConnectFrom] = useState("");
  const [zoom, setZoom] = useState(90);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(() => window.innerWidth > 900);
  const [modelCatalog, setModelCatalog] = useState<ImageModelCatalog | null>(null);
  const [imageModel, setImageModel] = useState("");
  const [runningNodeId, setRunningNodeId] = useState("");
  const [jobProgress, setJobProgress] = useState(0);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [hoveredId, setHoveredId] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ id: string; startX: number; startY: number; nodeX: number; nodeY: number } | null>(null);
  const stageRef = useRef<HTMLElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const panDragRef = useRef<{ startClientX: number; startClientY: number; startPanX: number; startPanY: number } | null>(null);
  const viewportRef = useRef({ zoom: 90, panX: 0, panY: 0 });

  const selectedNode = nodes.find((node) => node.id === selectedId) || nodes[0];
  const nodeMap = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  useEffect(() => {
    setScope(scopeFromLocation(location));
  }, [location]);

  useEffect(() => {
    getProjects(scope)
      .then((result) => setProjects(Array.isArray(result) ? result : result.items || []))
      .catch(() => setProjects([]));
  }, [scope]);

  useEffect(() => {
    fetchImageModels()
      .then((catalog) => {
        setModelCatalog(catalog);
        setImageModel((current) => current || catalog.defaultModel);
      })
      .catch((error) => toast.error(publicApiError(error, "读取图像模型失败")));
  }, []);

  useEffect(() => {
    if (!projectId) {
      setLoading(false);
      setProjectTitle("");
      setNodes([]);
      setEdges([]);
      return;
    }
    let disposed = false;
    setLoading(true);
    Promise.allSettled([getProject(projectId, scope), getProjectSnapshot(projectId, scope)])
      .then(([projectResult, snapshotResult]) => {
        if (disposed) return;
        if (projectResult.status === "fulfilled") setProjectTitle(projectResult.value.title);
        const projectData = projectResult.status === "fulfilled" ? projectResult.value.data : undefined;
        const snapshotData = snapshotResult.status === "fulfilled" ? snapshotResult.value : undefined;
        const parsed = parseSnapshot(snapshotData) || parseSnapshot(projectData);
        const nextNodes = parsed?.nodes?.length ? parsed.nodes : starterNodes();
        setNodes(nextNodes);
        setEdges(parsed?.edges || []);
        setSelectedId(nextNodes[0]?.id || "");
        setZoom(parsed?.zoom || 90);
        setPanX(0);
        setPanY(0);
      })
      .catch((error) => toast.error(publicApiError(error, "读取画布项目失败")))
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => { disposed = true; };
  }, [projectId, scope]);

  useEffect(() => {
    const ids = Array.from(new Set(nodes.map((node) => node.imageAssetId).filter(Boolean))) as string[];
    let disposed = false;
    const objectUrls: string[] = [];
    Promise.all(ids.map(async (id) => {
      try {
        const url = await getAssetContentObjectUrl(id, scope, 640);
        objectUrls.push(url);
        return [id, url] as const;
      } catch {
        return [id, ""] as const;
      }
    })).then((items) => {
      if (!disposed) setPreviews(Object.fromEntries(items.filter(([, url]) => Boolean(url))));
    });
    return () => {
      disposed = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [nodes, scope]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (connectFrom) setConnectFrom("");
        else setSelectedId("");
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedId) {
        event.preventDefault();
        removeNode(selectedId);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [selectedId, connectFrom]);

  useEffect(() => {
    viewportRef.current = { zoom, panX, panY };
  }, [zoom, panX, panY]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const { zoom: z, panX: px, panY: py } = viewportRef.current;
      const rect = stage.getBoundingClientRect();
      const cx = event.clientX - rect.left;
      const cy = event.clientY - rect.top - 52;
      const delta = -event.deltaY * (event.ctrlKey ? 0.01 : 0.0008);
      const oldK = z / 100;
      const newK = Math.max(0.25, Math.min(2.5, oldK + delta));
      const canvasX = (cx - px) / oldK;
      const canvasY = (cy - py) / oldK;
      setZoom(Math.round(newK * 100));
      setPanX(cx - canvasX * newK);
      setPanY(cy - canvasY * newK);
    };
    stage.addEventListener("wheel", handleWheel, { passive: false });
    return () => stage.removeEventListener("wheel", handleWheel);
  }, []);

  const persistSnapshot = useCallback(async (nextNodes = nodes, nextEdges = edges, nextZoom = zoom) => {
    if (!projectId) return;
    setSaving(true);
    try {
      await saveProjectSnapshot(projectId, {
        nodes: nextNodes,
        edges: nextEdges,
        zoom: nextZoom,
        updated_at: new Date().toISOString(),
      }, scope);
      toast.success("画布快照已保存");
    } catch (error) {
      toast.error(publicApiError(error, "保存画布快照失败"));
    } finally {
      setSaving(false);
    }
  }, [edges, nodes, projectId, scope, zoom]);

  const createBlankProject = async () => {
    const title = window.prompt("请输入画布项目名称", "未命名画布")?.trim();
    if (!title) return;
    try {
      const created = await createProject({ scope, title, data: { nodes: starterNodes(), edges: [], zoom: 90 } });
      navigate(canvasProjectHref(created.id, scope));
    } catch (error) {
      toast.error(publicApiError(error, "创建画布失败"));
    }
  };

  const addNode = (kind: CanvasNodeKind) => {
    const created: CanvasNodeData = {
      id: crypto.randomUUID(),
      kind,
      title: kind === "prompt" ? "新提示词" : kind === "image" ? "图片占位" : "备注",
      content: kind === "prompt" ? "在这里填写要生成的画面提示词。" : "",
      x: 160 + nodes.length * 34,
      y: 160 + nodes.length * 22,
      width: kind === "image" ? 300 : 270,
      height: kind === "image" ? 220 : 160,
    };
    setNodes((items) => [...items, created]);
    setSelectedId(created.id);
  };

  const updateNode = (id: string, patch: Partial<CanvasNodeData>) => {
    setNodes((items) => items.map((node) => node.id === id ? { ...node, ...patch } : node));
  };

  const removeNode = (id: string) => {
    setNodes((items) => items.filter((node) => node.id !== id));
    setEdges((items) => items.filter((edge) => edge.from !== id && edge.to !== id));
    setSelectedId((current) => current === id ? "" : current);
  };

  const chooseNode = (id: string) => {
    if (connectFrom && connectFrom !== id) {
      const edgeId = `${connectFrom}:${id}`;
      setEdges((items) => items.some((edge) => edge.from === connectFrom && edge.to === id) ? items : [...items, { id: edgeId, from: connectFrom, to: id }]);
      setConnectFrom("");
    }
    setSelectedId(id);
  };

  const startDrag = (event: PointerEvent<HTMLElement>, node: CanvasNodeData) => {
    const target = event.target as HTMLElement;
    if (target.closest("button, input, textarea, select")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { id: node.id, startX: event.clientX, startY: event.clientY, nodeX: node.x, nodeY: node.y };
  };

  const moveDrag = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const scale = viewportRef.current.zoom / 100;
    updateNode(drag.id, {
      x: Math.round(drag.nodeX + (event.clientX - drag.startX) / scale),
      y: Math.round(drag.nodeY + (event.clientY - drag.startY) / scale),
    });
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const startPan = (event: PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest(".real-canvas-node")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    panDragRef.current = { startClientX: event.clientX, startClientY: event.clientY, startPanX: viewportRef.current.panX, startPanY: viewportRef.current.panY };
  };

  const movePanGrid = (event: PointerEvent<HTMLDivElement>) => {
    const pan = panDragRef.current;
    if (!pan) return;
    setPanX(pan.startPanX + event.clientX - pan.startClientX);
    setPanY(pan.startPanY + event.clientY - pan.startClientY);
  };

  const endPanGrid = () => { panDragRef.current = null; };

  const generateFromNode = async () => {
    if (!selectedNode || runningNodeId) return;
    const prompt = selectedNode.kind === "prompt" ? selectedNode.content : selectedNode.content || selectedNode.title;
    if (!prompt.trim()) {
      toast.warning("请先填写提示词");
      return;
    }
    setRunningNodeId(selectedNode.id);
    setJobProgress(0);
    try {
      const result = await generateImages({
        model: imageModel,
        prompt,
        size: "auto",
        quality: "auto",
        count: 1,
        scope,
        sourceType: "canvas",
        sourceProjectId: projectId,
        sourceNodeId: selectedNode.id,
      }, {
        onAccepted: (job) => toast.message(`已提交生成任务：${job.job_id || job.id || "unknown"}`),
        onProgress: (job) => setJobProgress(job.progress ?? 0),
      });
      const generated = result.images[0];
      const next = appendGeneratedNode(nodes, edges, selectedNode, generated);
      setNodes(next.nodes);
      setEdges(next.edges);
      setSelectedId(next.createdId);
      await persistSnapshot(next.nodes, next.edges, zoom);
    } catch (error) {
      toast.error(publicApiError(error, "画布节点生成失败"));
    } finally {
      setRunningNodeId("");
      setJobProgress(0);
    }
  };

  const uploadFilesAsNodes = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (!list.length || uploading) return;
    setUploading(true);
    try {
      const createdNodes: CanvasNodeData[] = [];
      for (const file of list) {
        const asset = await uploadAsset(file, {
          type: "image",
          name: file.name,
          category: "reference",
          source_type: "canvas",
          source_project_id: projectId,
          source_project_name: projectTitle,
          source_metadata: JSON.stringify({ canvas_node_ingestion: "drag_or_upload" }),
        }, scope);
        createdNodes.push({
          id: crypto.randomUUID(),
          kind: "image",
          title: asset.name || file.name,
          content: "从画布拖入 / 上传形成的图片素材节点。",
          x: 140 + (nodes.length + createdNodes.length) * 34,
          y: 120 + (nodes.length + createdNodes.length) * 26,
          width: 320,
          height: 238,
          imageAssetId: asset.id,
        });
      }
      const nextNodes = [...nodes, ...createdNodes];
      setNodes(nextNodes);
      setSelectedId(createdNodes.at(-1)?.id || selectedId);
      await persistSnapshot(nextNodes, edges, zoom);
      toast.success(`已添加 ${createdNodes.length} 个图片节点`);
    } catch (error) {
      toast.error(publicApiError(error, "上传图片到画布失败"));
    } finally {
      setUploading(false);
    }
  };

  const duplicateSelectedNode = async (targetId?: string) => {
    const source = targetId ? nodes.find((node) => node.id === targetId) : selectedNode;
    if (!source) return;
    const createdId = crypto.randomUUID();
    const duplicate: CanvasNodeData = {
      ...source,
      id: createdId,
      title: `${source.title} 副本`,
      x: source.x + 36,
      y: source.y + 36,
    };
    const incomingEdges = edges
      .filter((edge) => edge.to === source.id)
      .map((edge) => ({ id: `${edge.from}:${createdId}`, from: edge.from, to: createdId }))
      .filter((edge, index, all) => all.findIndex((item) => item.id === edge.id) === index && !edges.some((existing) => existing.from === edge.from && existing.to === edge.to));
    const nextNodes = [...nodes, duplicate];
    const nextEdges = [...edges, ...incomingEdges];
    setNodes(nextNodes);
    setEdges(nextEdges);
    setSelectedId(createdId);
    await persistSnapshot(nextNodes, nextEdges, zoom);
    toast.success("节点已复制：仅保留左侧入边，右侧出边不会继承");
  };

  const imageAssetIds = () => nodes.map((node) => node.imageAssetId).filter(Boolean) as string[];

  const exportImageNodes = async () => {
    const assetIds = imageAssetIds();
    if (!assetIds.length || exporting) return toast.info("当前画布没有可导出的图片节点");
    setExporting(true);
    try {
      const batch = await createAssetExport({ selection_mode: "selected", asset_ids: assetIds }, scope);
      toast.success(`画布图片导出任务已创建：${batch.id.slice(-8)}`);
    } catch (error) {
      toast.error(publicApiError(error, "创建画布图片导出失败"));
    } finally {
      setExporting(false);
    }
  };

  const downloadSelectedImage = async () => {
    if (!selectedNode?.imageAssetId && !selectedNode?.imageSrc) return toast.info("当前节点不是图片节点");
    try {
      if (selectedNode.imageAssetId) {
        const exportBatch = await createAssetExport({ selection_mode: "selected", asset_ids: [selectedNode.imageAssetId] }, scope);
        toast.success(`已创建单图导出任务：${exportBatch.id.slice(-8)}，可在资产库导出面板下载`);
        return;
      }
      const response = await fetch(selectedNode.imageSrc || "");
      const blob = await response.blob();
      downloadBlob(blob, `${selectedNode.title || selectedNode.id}.png`);
    } catch (error) {
      toast.error(publicApiError(error, "下载图片节点失败"));
    }
  };

  if (!projectId) {
    return (
      <div className="page-content">
        <div className="scope-switch canvas-scope-switch">{scopeOptions.map((item) => <button key={item.value} className={scope === item.value ? "active" : ""} onClick={() => setScope(item.value)}>{item.label}</button>)}</div>
        <div className="page-intro">
          <div><p className="eyebrow">CANVAS / PROJECTS</p><h1>选择一张真实画布</h1><p>这里会打开 {scope === "team" ? "团队" : "个人"} 工作区的服务端项目快照，不再使用静态样例节点。</p></div>
          <button className="create-button" onClick={() => void createBlankProject()}><Plus size={17} /> 新建画布</button>
        </div>
        <div className="project-grid">
          {projects.map((project) => (
            <button className="project-card" key={project.id} onClick={() => navigate(canvasProjectHref(project.id, scope))}>
              <div className="project-visual"><div className="abstract-canvas" aria-hidden="true"><span className="abstract-card one" /><span className="abstract-card two" /></div><span className="project-code">{project.id.slice(-8)}</span></div>
              <div className="project-info"><div><h3>{project.title}</h3><p>{new Date(project.updated_at).toLocaleString("zh-CN")}</p></div><ChevronRight size={16} /></div>
            </button>
          ))}
          {!projects.length && <div className="empty-output"><p>还没有画布项目。</p></div>}
        </div>
      </div>
    );
  }

  return (
    <div className="canvas-page real-canvas-page">
      <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={(event) => event.target.files && void uploadFilesAsNodes(event.target.files)} />
      <div className="canvas-heading">
        <div className="page-intro">
          <div><p className="eyebrow">CANVAS / {projectId.slice(-8).toUpperCase()}</p><h1>{projectTitle || "无限画布"}</h1><p>节点、连线和生成结果都会保存到 {scope === "team" ? "团队" : "个人"} 工作区服务端快照。</p></div>
        </div>
        <div className="canvas-head-actions">
          <div className="scope-switch mini-scope">{scopeOptions.map((item) => <button key={item.value} className={scope === item.value ? "active" : ""} onClick={() => setScope(item.value)}>{item.label}</button>)}</div>
          <button className="outline-button small" onClick={() => fileInputRef.current?.click()} disabled={uploading}><Upload size={15} /> {uploading ? "上传中" : "拖入/上传图片"}</button>
          <button className="outline-button small" onClick={() => void duplicateSelectedNode()} disabled={!selectedNode}><Copy size={15} /> 复制节点</button>
          <button className="outline-button small" onClick={() => void exportImageNodes()} disabled={exporting}><Archive size={15} /> {exporting ? "导出中" : "导出图片节点"}</button>
          <button className="outline-button small" onClick={() => void persistSnapshot()} disabled={saving || loading}><Save size={15} /> {saving ? "保存中" : "保存"}</button>
          <button className={`outline-button small inspector-trigger ${inspectorOpen ? "is-active" : ""}`} onClick={() => setInspectorOpen((value) => !value)}><PanelRight size={15} /> 检查器</button>
          <button className={`outline-button small ${agentOpen ? "is-active" : ""}`} onClick={() => setAgentOpen((value) => !value)}><Sparkles size={15} /> Agent</button>
          <button className="vermilion-button" onClick={() => void generateFromNode()} disabled={!selectedNode || !imageModel || Boolean(runningNodeId)}><WandSparkles size={16} /> {runningNodeId ? `生成中 ${jobProgress}%` : "生成图片节点"}</button>
        </div>
      </div>

      <div className={`canvas-workspace real-canvas-workspace ${inspectorOpen ? "inspector-open" : ""} ${agentOpen ? "agent-open" : ""}`}>
        <section ref={stageRef} className="canvas-stage real-canvas-stage" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void uploadFilesAsNodes(event.dataTransfer.files); }}>
          <div className="canvas-top-tools">
            <div className="tool-cluster">
              <button title="选择"><MousePointer2 size={16} /></button>
              <button title="添加提示词" onClick={() => addNode("prompt")}><Plus size={16} /></button>
              <button title={connectFrom ? "选择目标节点完成连接" : "从当前节点开始连接"} className={connectFrom ? "active" : ""} onClick={() => selectedNode && setConnectFrom(selectedNode.id)}><Link2 size={16} /></button>
            </div>
            <span>{connectFrom ? "连接模式：请选择目标节点" : "真实快照模式"}</span>
            <div className="canvas-title-chip"><i /> {nodes.length} 节点 · {edges.length} 连线</div>
          </div>

          {loading ? (
            <div className="empty-output"><Loader2 className="spin" size={28} /><p>正在读取画布快照…</p></div>
          ) : (
            <div className="real-canvas-grid" ref={gridRef}
              style={{ transform: `translate(${panX}px, ${panY}px) scale(${zoom / 100})` }}
              onPointerDown={startPan} onPointerMove={movePanGrid} onPointerUp={endPanGrid} onPointerCancel={endPanGrid}
              onClick={(event) => { const t = event.target as HTMLElement; if (!t.closest(".real-canvas-node")) { setSelectedId(""); setConnectFrom(""); } }}
            >
              <svg className="real-canvas-lines" aria-hidden="true">
                {edges.map((edge) => {
                  const from = nodeMap.get(edge.from);
                  const to = nodeMap.get(edge.to);
                  if (!from || !to) return null;
                  const x1 = from.x + from.width;
                  const y1 = from.y + from.height / 2;
                  const x2 = to.x;
                  const y2 = to.y + to.height / 2;
                  return <path key={edge.id} d={`M ${x1} ${y1} C ${x1 + 90} ${y1}, ${x2 - 90} ${y2}, ${x2} ${y2}`} />;
                })}
              </svg>
              {nodes.map((node) => {
                const preview = node.imageAssetId ? previews[node.imageAssetId] : node.imageSrc;
                return (
                  <article
                    key={node.id}
                    className={`real-canvas-node ${node.kind} ${selectedId === node.id ? "selected" : ""} ${runningNodeId === node.id ? "running" : ""}`}
                    style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
                    onClick={() => chooseNode(node.id)}
                    onMouseEnter={() => setHoveredId(node.id)}
                    onMouseLeave={() => setHoveredId("")}
                    onPointerDown={(event) => startDrag(event, node)}
                    onPointerMove={moveDrag}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                  >
                    <div className="node-bar"><span>{node.kind === "prompt" ? "PROMPT" : node.kind === "image" ? "IMAGE" : "NOTE"}</span><b>{node.title}</b></div>
                    {preview ? <img src={preview} alt={node.title} /> : <div className="prompt-body">{node.kind === "image" ? <ImageIcon size={22} /> : <Sparkles size={18} />}<p>{node.content || "空节点"}</p></div>}
                    {runningNodeId === node.id && <div className="node-running"><i style={{ width: `${jobProgress}%` }} /></div>}
                    {hoveredId === node.id && !runningNodeId && (
                      <div className="node-hover-toolbar">
                        <button title="连接" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setConnectFrom(node.id); setSelectedId(node.id); }}><Link2 size={12} /></button>
                        <button title="复制" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); void duplicateSelectedNode(node.id); }}><Copy size={12} /></button>
                        <button title="生成图片" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setSelectedId(node.id); void generateFromNode(); }}><WandSparkles size={12} /></button>
                        <button title="删除" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); removeNode(node.id); }}><Trash2 size={12} /></button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}

          <div className="canvas-bottom-tools">
            <button onClick={() => setZoom((value) => Math.max(40, value - 10))}>−</button>
            <b>{zoom}%</b>
            <button onClick={() => setZoom((value) => Math.min(150, value + 10))}>+</button>
            <span />
            <button onClick={() => { setZoom(90); setPanX(0); setPanY(0); }}><Maximize2 size={15} /> 适配</button>
          </div>
        </section>

        <aside className="inspector-panel">
          <div className="inspector-head">
            <div><p className="eyebrow">INSPECTOR</p><h3>{selectedNode?.title || "未选择节点"}</h3></div>
          </div>
          {selectedNode ? (
            <>
              <div className="inspector-block">
                <span className="field-label">节点标题</span>
                <input value={selectedNode.title} onChange={(event) => updateNode(selectedNode.id, { title: event.target.value })} />
              </div>
              <div className="inspector-block">
                <span className="field-label">节点内容</span>
                <textarea className="prompt-copy" value={selectedNode.content} onChange={(event) => updateNode(selectedNode.id, { content: event.target.value })} />
              </div>
              <div className="inspector-block">
                <span className="field-label">生成参数</span>
                <div className="parameter-row"><span>模型</span><select value={imageModel} onChange={(event) => setImageModel(event.target.value)}>{modelCatalog?.models.map((item) => <option key={item} value={item}>{imageModelLabel(item, modelCatalog)}</option>)}</select></div>
                <div className="parameter-row"><span>比例</span><b>AUTO</b></div>
              </div>
              <button className="full-outline" onClick={() => setConnectFrom(selectedNode.id)}><Link2 size={16} /> 从此节点连接</button>
              <button className="full-outline" onClick={() => void duplicateSelectedNode()}><Copy size={16} /> 复制节点（仅入边）</button>
              <button className="full-outline" onClick={() => void downloadSelectedImage()}><Download size={16} /> 下载 / 导出当前图片</button>
              <button className="full-outline" onClick={() => void generateFromNode()} disabled={Boolean(runningNodeId)}><WandSparkles size={16} /> 基于此节点生成</button>
              <button className="full-outline" onClick={() => removeNode(selectedNode.id)}><Trash2 size={16} /> 删除节点</button>
            </>
          ) : <div className="empty-output"><p>选择一个节点后编辑。</p></div>}
        </aside>
        <AgentPanel projectId={projectId} open={agentOpen} onClose={() => setAgentOpen(false)} />
      </div>
    </div>
  );
}

function parseSnapshot(value: unknown): CanvasSnapshotData | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const data = (record.data && typeof record.data === "object" ? record.data : record) as Record<string, unknown>;
  const nodes = Array.isArray(data.nodes) ? data.nodes.filter(isCanvasNode) : [];
  const edges = Array.isArray(data.edges) ? data.edges.filter(isCanvasEdge) : [];
  if (!nodes.length && !edges.length) return null;
  return { nodes, edges, zoom: Number(data.zoom) || 90 };
}

function isCanvasNode(value: unknown): value is CanvasNodeData {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<CanvasNodeData>;
  return typeof record.id === "string" && typeof record.x === "number" && typeof record.y === "number";
}

function isCanvasEdge(value: unknown): value is CanvasEdgeData {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<CanvasEdgeData>;
  return typeof record.id === "string" && typeof record.from === "string" && typeof record.to === "string";
}

function appendGeneratedNode(nodes: CanvasNodeData[], edges: CanvasEdgeData[], source: CanvasNodeData, generated: GeneratedImage | undefined) {
  const createdId = crypto.randomUUID();
  const created: CanvasNodeData = {
    id: createdId,
    kind: "image",
    title: generated?.name || "生成图片",
    content: source.content,
    x: source.x + 360,
    y: source.y + 34,
    width: 320,
    height: 238,
    imageAssetId: generated?.assetId,
    imageSrc: generated?.assetId ? undefined : generated?.src,
  };
  return {
    createdId,
    nodes: [...nodes, created],
    edges: [...edges, { id: `${source.id}:${createdId}`, from: source.id, to: createdId }],
  };
}
