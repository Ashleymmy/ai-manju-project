import {
  Archive,
  ArrowRight,
  ArrowUp,
  BadgeCheck,
  BookMarked,
  BookOpen,
  Bot,
  Camera,
  ChevronDown,
  Copy,
  Download,
  Eraser,
  FolderOpen,
  GalleryHorizontalEnd,
  Link2,
  Loader2,
  MoreHorizontal,
  Palette,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Square,
  Trash2,
  Ungroup,
  UserRound,
  UserRoundCog,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import type { CSSProperties, PointerEvent, RefObject } from "react";
import { toast } from "sonner";
import { CanvasResourceMentionTextarea } from "@/components/canvas/CanvasResourceMentionTextarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { CanvasGroupData } from "@/features/canvas/domain/groups";
import {
  VIDEO_SUBMODES,
  editableNodeKind,
  imageCountFromNode,
  promptTextFromNode,
  qualityFromNode,
  sizeFromNode,
  videoSubModeFromNode,
  videoSubModePlaceholder,
} from "@/features/canvas/domain/nodeUtils";
import { imageSrcFromNode } from "@/features/canvas/domain/nodes";
import type {
  CanvasEdgeData,
  CanvasGenerationMode,
  CanvasNodeData,
} from "@/features/canvas/domain/types";
import {
  CanvasImageToolGrid,
  type CanvasNodeCardActions,
} from "./CanvasNodeCard";

type PromptPresetView = {
  id: string;
  title: string;
  prompt: string;
  priority: "pinned" | "high" | "normal" | "low";
};

type CanvasSkillView = {
  id: string;
  title: string;
  description?: string;
  prompt: string;
};

type ModelOption = { value: string; label: string };
type Option = { value: string; label: string };

type VideoConfigView = {
  model: string;
  seconds: string;
  resolution: string;
  size: string;
  generateAudio: boolean;
  watermark: boolean;
};

type AudioConfigView = {
  voice: string;
  format: string;
  speed: string;
  instructions: string;
};

const STYLE_CATEGORIES = [
  { value: "anime", label: "动漫" },
  { value: "digital", label: "数字艺术" },
  { value: "director", label: "致敬导演" },
  { value: "drama", label: "戏剧张力" },
  { value: "extra", label: "扩展" },
] as const;

type StyleCategoryValue = (typeof STYLE_CATEGORIES)[number]["value"];

const STYLE_PRESETS: Array<{ category: StyleCategoryValue; name: string; prompt: string; gradient: string }> = [
  { category: "anime", name: "日系动画", prompt: "日系动画风格，赛璐璐上色，干净线条", gradient: "linear-gradient(135deg,#3b4a6b,#c98b9e)" },
  { category: "anime", name: "吉卜力手绘", prompt: "吉卜力手绘动画风，温暖水彩底色", gradient: "linear-gradient(135deg,#5a7a5c,#d9c9a3)" },
  { category: "anime", name: "新海诚光影", prompt: "新海诚式天空光影，高饱和云层与光斑", gradient: "linear-gradient(135deg,#2b4a7a,#8fb8d9)" },
  { category: "anime", name: "像素艺术", prompt: "像素艺术，复古游戏画面", gradient: "linear-gradient(135deg,#4a3b6b,#d98bb0)" },
  { category: "digital", name: "赛博朋克霓虹", prompt: "赛博朋克霓虹，高对比冷暖光", gradient: "linear-gradient(135deg,#1b1f3b,#e0457b)" },
  { category: "digital", name: "蒸汽波", prompt: "蒸汽波，粉紫色调与复古网格", gradient: "linear-gradient(135deg,#3b2b5b,#e08bb8)" },
  { category: "digital", name: "故障艺术", prompt: "故障艺术，错位色块与扫描线", gradient: "linear-gradient(135deg,#123,#0fa)" },
  { category: "digital", name: "低多边形", prompt: "低多边形 3D 插画", gradient: "linear-gradient(135deg,#2a4a3b,#8bc98b)" },
  { category: "director", name: "韦斯·安德森", prompt: "韦斯·安德森式对称构图，柔和粉彩", gradient: "linear-gradient(135deg,#c9a3a3,#e8d9b8)" },
  { category: "director", name: "王家卫", prompt: "王家卫式抽帧拖影，潮湿霓虹与旧香港色调", gradient: "linear-gradient(135deg,#3b2b1b,#c96b3b)" },
  { category: "director", name: "诺兰冷峻", prompt: "诺兰式冷峻写实，灰蓝色调与大景深", gradient: "linear-gradient(135deg,#1b2530,#7a8b99)" },
  { category: "director", name: "沙丘废土", prompt: "沙丘式废土美学，橙黄沙暴与巨物感", gradient: "linear-gradient(135deg,#6b4a2b,#d9a35b)" },
  { category: "drama", name: "电影感光影", prompt: "电影感光影，戏剧性明暗对比", gradient: "linear-gradient(135deg,#14181d,#c9853b)" },
  { category: "drama", name: "黑色电影", prompt: "黑色电影，硬朗侧光与长阴影", gradient: "linear-gradient(135deg,#0d0d0f,#5b5b66)" },
  { category: "drama", name: "舞台聚光", prompt: "舞台聚光灯下的主体，深色背景", gradient: "linear-gradient(135deg,#12090f,#8b3b6b)" },
  { category: "drama", name: "雨夜霓虹", prompt: "雨夜霓虹反射，潮湿街道与冷暖对比", gradient: "linear-gradient(135deg,#0d1b2a,#3b6bc9)" },
  { category: "extra", name: "水彩插画", prompt: "水彩插画，纸张纹理与晕染", gradient: "linear-gradient(135deg,#a3c9c9,#e8e0d0)" },
  { category: "extra", name: "油画厚涂", prompt: "油画厚涂，可见笔触与颜料堆叠", gradient: "linear-gradient(135deg,#4a3b2b,#c9853b)" },
  { category: "extra", name: "极简扁平", prompt: "极简扁平插画，大色块与留白", gradient: "linear-gradient(135deg,#e8e0d0,#8bc9c9)" },
  { category: "extra", name: "写实摄影", prompt: "写实摄影质感，真实光线与颗粒", gradient: "linear-gradient(135deg,#2b2b2b,#a3a3a3)" },
];

export type CanvasInspectorActions = {
  node: CanvasNodeCardActions;
  setInspectorOpen: (open: boolean) => void;
  activateConnectionMode: (nodeId: string) => void;
  updateCanvasGroup: (groupId: string, patch: Partial<Pick<CanvasGroupData, "title" | "color">>) => void;
  runCanvasGroupGeneration: (groupId: string) => Promise<unknown>;
  ungroupCanvasGroup: (groupId: string) => void;
  updateNode: (nodeId: string, patch: Partial<CanvasNodeData>) => void;
  generateFromNode: (nodeId?: string) => Promise<unknown>;
  openAssetPicker: () => void;
  selectGenerationModel: (value: string) => void;
  setPromptLibraryNodeId: (nodeId: string) => void;
  setStyleCategory: (category: string) => void;
  setStoryboardEditorNodeId: (nodeId: string) => void;
  setPresetManagerOpen: (open: boolean) => void;
  onSkillsOpen: () => void;
  optimizeNodePrompt: (node: CanvasNodeData, skillPrompt?: string) => Promise<unknown>;
  setSkillLibraryOpen: (open: boolean) => void;
  setSeedanceAssetNodeId: (nodeId: string) => void;
  downloadSelectedMedia: () => Promise<unknown>;
  startPanelWidthResize: (event: PointerEvent<HTMLButtonElement>, node: CanvasNodeData) => void;
};

export type CanvasInspectorProps = {
  panelRef: RefObject<HTMLElement | null>;
  selectedNode?: CanvasNodeData;
  selectedGroup?: CanvasGroupData;
  inspectorOpen: boolean;
  projectActionDisabled: boolean;
  selectedPanelStyle?: CSSProperties;
  edges: CanvasEdgeData[];
  nodes: CanvasNodeData[];
  previews: Record<string, string>;
  visiblePromptPresets: PromptPresetView[];
  imageToolBusy: boolean;
  storyboardBusy: boolean;
  selectedGenerationMode: CanvasGenerationMode;
  selectedGenerationModel: string;
  selectedGenerationModelLabel: string;
  generationModelOptions: ModelOption[];
  selectedVideoConfig: VideoConfigView | null;
  selectedVideoSeedance: boolean;
  selectedVideoDurations: ReadonlyArray<string | number>;
  selectedVideoResolutions: readonly string[];
  selectedVideoRatios: readonly string[];
  selectedAudioConfig: AudioConfigView | null;
  audioVoiceOptions: readonly Option[];
  audioFormatOptions: readonly Option[];
  runningGroupId: string;
  runningNodeIds: ReadonlySet<string>;
  captureFrameNodeId: string;
  styleCategory: string;
  promptOptimizing: boolean;
  enabledSkills: CanvasSkillView[];
  actions: CanvasInspectorActions;
};

export function CanvasInspector({
  panelRef,
  selectedNode,
  selectedGroup,
  inspectorOpen,
  projectActionDisabled,
  selectedPanelStyle,
  edges,
  nodes,
  previews,
  visiblePromptPresets,
  imageToolBusy,
  storyboardBusy,
  selectedGenerationMode,
  selectedGenerationModel,
  selectedGenerationModelLabel,
  generationModelOptions,
  selectedVideoConfig,
  selectedVideoSeedance,
  selectedVideoDurations,
  selectedVideoResolutions,
  selectedVideoRatios,
  selectedAudioConfig,
  audioVoiceOptions,
  audioFormatOptions,
  runningGroupId,
  runningNodeIds,
  captureFrameNodeId,
  styleCategory,
  promptOptimizing,
  enabledSkills,
  actions,
}: CanvasInspectorProps) {
  const {
    node: {
      openDirectorNode,
      setMaterialNodeId,
      setImagePreviewNodeId,
      updateNodePrompt,
      mentionReferencesForNode,
      queueMentionAssetSearch,
      mentionThumbnailFor,
      previewMentionReference,
      locateMentionReference,
      openImageToolDialog,
      setImageAnnotationNodeId,
      setImageMaskNodeId,
      setImageToolError,
      flipCanvasImageNode,
      generatePanoramaCanvasImage,
      setStoryboardNodeId,
      createImageReversePromptNodes,
      setReplaceImageNodeId,
      replaceImageInputRef,
      archiveCanvasMediaNode,
      stopGenerationByNodeId,
      retryImageNode,
      retryVideoNode,
      retryAudioNode,
      retryTextNode,
      duplicateSelectedNode,
      removeNode,
      archiveCanvasTextNode,
      captureVideoFrameNode,
    },
    setInspectorOpen,
    activateConnectionMode,
    updateCanvasGroup,
    runCanvasGroupGeneration,
    ungroupCanvasGroup,
    updateNode,
    generateFromNode,
    openAssetPicker,
    selectGenerationModel,
    setPromptLibraryNodeId,
    setStyleCategory,
    setStoryboardEditorNodeId,
    setPresetManagerOpen,
    onSkillsOpen,
    optimizeNodePrompt,
    setSkillLibraryOpen,
    setSeedanceAssetNodeId,
    downloadSelectedMedia,
    startPanelWidthResize,
  } = actions;
  return (
        <aside ref={panelRef} className={`inspector-panel canvas-floating-inspector${selectedNode && !selectedGroup ? " inspector-floating" : ""}`} data-canvas-ui data-canvas-no-zoom style={selectedNode && !selectedGroup ? (inspectorOpen && !projectActionDisabled && selectedPanelStyle ? selectedPanelStyle : { display: "none" }) : ((selectedNode || selectedGroup) && inspectorOpen && !projectActionDisabled ? undefined : { display: "none" })} onClick={(event) => event.stopPropagation()}>
          <div className="inspector-head">
            <div><p className="eyebrow">INSPECTOR</p><div className="inspector-title-row"><h3>{selectedGroup?.title || selectedNode?.title || "未选择节点"}</h3>{selectedNode && !selectedGroup && selectedNode.kind === "video" ? <span className="video-submode-badge inspector-submode-badge">{VIDEO_SUBMODES.find((sub) => sub.value === videoSubModeFromNode(selectedNode))?.label || "文生视频"}</span> : null}</div></div>
            {selectedNode && !selectedGroup ? (
              <div className="node-card-head-actions">
                {selectedNode.kind === "video" ? (
                  <button className="icon-button subtle" title="素材校验" onClick={() => setMaterialNodeId(selectedNode.id)}><BadgeCheck size={15} /></button>
                ) : null}
                <button
                  className="icon-button subtle"
                  title="一键复制提示词内容"
                  onClick={() => {
                    const text = promptTextFromNode(selectedNode);
                    if (!text.trim()) return toast.info("当前节点没有提示词");
                    void navigator.clipboard.writeText(text).then(() => toast.success("提示词已复制"));
                  }}
                ><Copy size={15} /></button>
                <button className="icon-button subtle node-card-close" title="关闭面板" onClick={() => setInspectorOpen(false)}><X size={15} /></button>
              </div>
            ) : null}
          </div>
          {selectedGroup ? (
            <>
              <div className="inspector-block">
                <span className="field-label">分组名称</span>
                <input value={selectedGroup.title} maxLength={80} onChange={(event) => updateCanvasGroup(selectedGroup.id, { title: event.target.value })} />
              </div>
              <div className="inspector-block">
                <span className="field-label">分组颜色</span>
                <label className="canvas-group-color-row">
                  <input type="color" value={selectedGroup.color} onChange={(event) => updateCanvasGroup(selectedGroup.id, { color: event.target.value })} />
                  <b>{selectedGroup.color.toUpperCase()}</b>
                </label>
              </div>
              <div className="inspector-block">
                <span className="field-label">成员</span>
                <p className="prompt-copy">包含 {selectedGroup.nodeIds.length} 个节点。拖动分组可整体移动，四角控制点可调整边界。</p>
              </div>
              <button className="full-outline" onClick={() => void runCanvasGroupGeneration(selectedGroup.id)} disabled={Boolean(runningGroupId)}>{runningGroupId === selectedGroup.id ? <Loader2 className="spin" size={16} /> : <WandSparkles size={16} />} 批量执行分组</button>
              <button className="full-outline" onClick={() => ungroupCanvasGroup(selectedGroup.id)}><Ungroup size={16} /> 解散分组</button>
            </>
          ) : selectedNode ? (
            <>
              <div className="node-card-body">
                {selectedNode.kind === "video" ? (
                  <div className="video-submode-header">
                    {(() => {
                      const mode = videoSubModeFromNode(selectedNode);
                      const incomingEdges = edges.filter((edge) => edge.to === selectedNode.id);
                      const sourceNodes = incomingEdges.map((edge) => nodes.find((n) => n.id === edge.from)).filter((n): n is CanvasNodeData => n !== undefined);

                      if (mode === "text") return null; // 文生视频无需输入源

                      const requiredType = (mode === "reference" || mode === "first-last") ? "image" : (mode === "edit" || mode === "extend") ? "video" : null;
                      const validSources = sourceNodes.filter((n) => n.kind === requiredType);

                      // 全能参考支持多图，其它模式固定数量
                      const minCount = mode === "first-last" ? 2 : 1;
                      const displayCount = mode === "reference" ? Math.max(validSources.length, 1) : minCount;

                      return (
                        <div className="video-input-sources" data-count={displayCount}>
                          {Array.from({ length: displayCount }).map((_, index) => {
                            const source = validSources[index];
                            const preview = source ? (source.kind === "image" ? imageSrcFromNode(source, previews) : source.metadata?.preview as string | undefined) : null;
                            return (
                              <div key={index} className="video-input-slot">
                                {preview && source ? (
                                  source.kind === "image" ? (
                                    <img src={preview} alt="" onClick={() => setImagePreviewNodeId(source.id)} style={{ cursor: "pointer" }} />
                                  ) : (
                                    <video src={preview} muted onClick={() => setImagePreviewNodeId(source.id)} style={{ cursor: "pointer" }} />
                                  )
                                ) : (
                                  <button type="button" title={`连接${requiredType === "image" ? "图片" : "视频"}节点`}>
                                    <Plus size={14} />
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                ) : null}
                <CanvasResourceMentionTextarea
                  className="prompt-copy node-card-prompt"
                  value={promptTextFromNode(selectedNode)}
                  references={mentionReferencesForNode(selectedNode.id)}
                  placeholder={selectedNode.kind === "video" ? videoSubModePlaceholder(videoSubModeFromNode(selectedNode)) : "输入 @ 可引用已连接节点或资产…，Enter 提交生成"}
                  onMentionQueryChange={queueMentionAssetSearch}
                  onSubmit={() => void generateFromNode(selectedNode.id)}
                  onChange={(value) => updateNodePrompt(selectedNode.id, value)}
                  thumbnailForReference={mentionThumbnailFor}
                  onPreviewReference={previewMentionReference}
                  onLocateReference={locateMentionReference}
                />
                {editableNodeKind(selectedNode.kind) && visiblePromptPresets.length ? (
                  <div className="canvas-preset-strip">
                    {visiblePromptPresets.map((preset) => (
                      <button key={preset.id} title={preset.prompt} onClick={() => updateNodePrompt(selectedNode.id, preset.prompt)}>
                        {presetPriorityLabel(preset.priority)} · {preset.title}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="node-card-chips">
                {/* 素材库/图片工具并入 chip 行，与模型、参数同一排 */}
                <div className="node-card-tools in-chips">
                {selectedNode.kind !== "director" ? (
                  <button type="button" title="素材库" onClick={openAssetPicker}><FolderOpen size={15} /></button>
                ) : null}
                {selectedNode.kind === "image" && imageSrcFromNode(selectedNode, previews) ? (
                  <>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button type="button" title="图片工具"><WandSparkles size={15} /></button>
                      </PopoverTrigger>
                      <PopoverContent className="node-pop-card node-pop-wide" align="start" sideOffset={8}>
                        <p className="eyebrow">图片工具</p>
                        <CanvasImageToolGrid node={selectedNode} imageToolBusy={imageToolBusy} storyboardBusy={storyboardBusy} openImageToolDialog={openImageToolDialog} setImageAnnotationNodeId={setImageAnnotationNodeId} setImageMaskNodeId={setImageMaskNodeId} setImageToolError={setImageToolError} flipCanvasImageNode={flipCanvasImageNode} generatePanoramaCanvasImage={generatePanoramaCanvasImage} generateStoryboard={(n) => setStoryboardNodeId(n.id)} createImageReversePromptNodes={createImageReversePromptNodes} setImagePreviewNodeId={setImagePreviewNodeId} setReplaceImageNodeId={setReplaceImageNodeId} replaceImageInputRef={replaceImageInputRef} archiveCanvasMediaNode={archiveCanvasMediaNode} />

                      </PopoverContent>
                    </Popover>
                  </>
                ) : null}
                </div>
                {selectedNode.kind === "video" ? (
                  <>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button type="button" className="node-chip">{VIDEO_SUBMODES.find((sub) => sub.value === videoSubModeFromNode(selectedNode))?.label || "文生视频"} <ChevronDown size={12} /></button>
                      </PopoverTrigger>
                      <PopoverContent className="node-pop-card" align="start" sideOffset={8}>
                        <p className="eyebrow">视频模式</p>
                        {VIDEO_SUBMODES.map((sub) => (
                          <button
                            key={sub.value}
                            type="button"
                            className={videoSubModeFromNode(selectedNode) === sub.value ? "node-pop-item active" : "node-pop-item"}
                            onClick={() => updateNode(selectedNode.id, { metadata: { ...(selectedNode.metadata || {}), videoSubMode: sub.value } })}
                          >{sub.label}</button>
                        ))}
                      </PopoverContent>
                    </Popover>
                  </>
                ) : null}
                <Popover>
                  <PopoverTrigger asChild>
                    <button type="button" className="node-chip node-chip-model" title={selectedGenerationModel}>{selectedGenerationModelLabel} <ChevronDown size={12} /></button>
                  </PopoverTrigger>
                  <PopoverContent className="node-pop-card" align="start" sideOffset={8}>
                    <p className="eyebrow">模型</p>
                    <div className="node-pop-scroll">
                      {generationModelOptions.map((option) => (
                        <button key={option.value} className={selectedGenerationModel === option.value ? "node-pop-item active" : "node-pop-item"} onClick={() => selectGenerationModel(option.value)}>{option.label}</button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
                <Popover>
                  <PopoverTrigger asChild>
                    <button type="button" className="node-chip" title="详细参数"><SlidersHorizontal size={13} /> 参数</button>
                  </PopoverTrigger>
                  <PopoverContent className="node-pop-card node-pop-params" align="start" sideOffset={8}>
                    <p className="eyebrow">详细参数</p>
                    {selectedGenerationMode === "image" ? <>
                      <div className="param-group"><span className="param-group-label">画质</span>
                        <div className="param-segments param-segments-wide">
                          {["1K", "2K", "4K"].map((value) => (
                            <button key={value} type="button" className={(selectedNode.metadata?.imageResolution || "2K") === value ? "active" : ""} onClick={() => updateNode(selectedNode.id, { metadata: { ...(selectedNode.metadata || {}), imageResolution: value } })}>{value}</button>
                          ))}
                        </div>
                      </div>
                      <div className="param-group"><span className="param-group-label">比例</span>
                        <div className="param-ratio-grid">
                          <button type="button" className={sizeFromNode(selectedNode) === "auto" ? "param-ratio active" : "param-ratio"} title="AUTO 自适应" onClick={() => updateNode(selectedNode.id, { metadata: { ...(selectedNode.metadata || {}), size: "auto" } })}>
                            <i className="param-ratio-icon" style={ratioIconStyle("auto")} />
                            <span>自适应</span>
                          </button>
                          {["1:1", "2:1", "4:3", "3:4", "5:4", "4:5", "3:2", "2:3", "21:9", "9:21", "16:9", "9:16"].map((ratio) => (
                            <button key={ratio} type="button" className={sizeFromNode(selectedNode) === ratio ? "param-ratio active" : "param-ratio"} title={ratio} onClick={() => updateNode(selectedNode.id, { metadata: { ...(selectedNode.metadata || {}), size: ratio } })}>
                              <i className="param-ratio-icon" style={ratioIconStyle(ratio)} />
                              <span>{ratio}</span>
                            </button>
                          ))}
                          <button type="button" className={sizeFromNode(selectedNode) === "panorama" ? "param-ratio active" : "param-ratio"} title="全景图" onClick={() => updateNode(selectedNode.id, { metadata: { ...(selectedNode.metadata || {}), size: "panorama" } })}>
                            <i className="param-ratio-icon param-ratio-panorama" style={ratioIconStyle("panorama")} />
                            <span>全景图</span>
                          </button>
                        </div>
                      </div>
                      <div className="param-group"><span className="param-group-label">精细度</span>
                        <div className="param-segments">
                          {[["low", "低"], ["medium", "中"], ["high", "高"]].map(([value, label]) => (
                            <button key={value} type="button" className={qualityFromNode(selectedNode) === value || (value === "medium" && qualityFromNode(selectedNode) === "auto") ? "active" : ""} onClick={() => updateNode(selectedNode.id, { metadata: { ...(selectedNode.metadata || {}), quality: value } })}>{label}</button>
                          ))}
                        </div>
                      </div>
                    </> : null}
                    {selectedVideoConfig ? <>
                      <div className="param-group"><span className="param-group-label">时长 <b>{selectedVideoConfig.seconds === "-1" ? "自动" : `${selectedVideoConfig.seconds} 秒`}</b></span>
                        {(() => {
                          const durations = selectedVideoDurations;
                          const index = Math.max(0, durations.findIndex((item) => String(item) === String(selectedVideoConfig.seconds)));
                          return (
                            <>
                              <input type="range" className="param-range" min={0} max={durations.length - 1} step={1} value={index} onChange={(event) => updateNode(selectedNode.id, { metadata: { ...(selectedNode.metadata || {}), seconds: String(durations[Number(event.target.value)]) } })} />
                              <div className="param-range-ticks">{durations.map((item) => <span key={String(item)}>{item === -1 ? "自动" : `${item}s`}</span>)}</div>
                            </>
                          );
                        })()}
                      </div>
                      <div className="param-group"><span className="param-group-label">分辨率</span>
                        <div className="param-segments">
                          {selectedVideoResolutions.map((item) => (
                            <button key={item} type="button" className={selectedVideoConfig.resolution === item ? "active" : ""} onClick={() => updateNode(selectedNode.id, { metadata: { ...(selectedNode.metadata || {}), resolution: item } })}>{item}</button>
                          ))}
                        </div>
                      </div>
                      <div className="param-group"><span className="param-group-label">宽高比</span>
                        <div className="param-ratio-grid">
                          {selectedVideoRatios.map((ratio) => (
                            <button key={ratio} type="button" className={selectedVideoConfig.size === ratio || sizeToRatioLabel(selectedVideoConfig.size) === ratio ? "param-ratio active" : "param-ratio"} title={ratio} onClick={() => updateNode(selectedNode.id, { metadata: { ...(selectedNode.metadata || {}), size: ratio } })}>
                              <i className="param-ratio-icon" style={ratioIconStyle(ratio)} />
                              <span>{ratio === "adaptive" ? "自适应" : ratio}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                      {selectedVideoSeedance ? <>
                        <label className="parameter-row"><span>生成音频</span><input type="checkbox" checked={selectedVideoConfig.generateAudio} onChange={(event) => updateNode(selectedNode.id, { metadata: { ...(selectedNode.metadata || {}), generateAudio: event.target.checked } })} /></label>
                        <label className="parameter-row"><span>添加水印</span><input type="checkbox" checked={selectedVideoConfig.watermark} onChange={(event) => updateNode(selectedNode.id, { metadata: { ...(selectedNode.metadata || {}), watermark: event.target.checked } })} /></label>
                      </> : null}
                    </> : null}
                    {selectedAudioConfig ? <>
                      <div className="parameter-row"><span>音色</span><select value={selectedAudioConfig.voice} onChange={(event) => updateNode(selectedNode.id, { metadata: { ...(selectedNode.metadata || {}), audioVoice: event.target.value } })}>{audioVoiceOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
                      <div className="parameter-row"><span>格式</span><select value={selectedAudioConfig.format} onChange={(event) => updateNode(selectedNode.id, { metadata: { ...(selectedNode.metadata || {}), audioFormat: event.target.value } })}>{audioFormatOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
                      <label className="parameter-row audio-speed-row"><span>语速 {selectedAudioConfig.speed}x</span><input type="range" min="0.25" max="4" step="0.25" value={selectedAudioConfig.speed} onChange={(event) => updateNode(selectedNode.id, { metadata: { ...(selectedNode.metadata || {}), audioSpeed: event.target.value } })} /></label>
                      <div className="audio-instructions"><span className="field-label">朗读指令</span><textarea className="prompt-copy" value={selectedAudioConfig.instructions} placeholder="可选，例如：温和、自然地朗读" onChange={(event) => updateNode(selectedNode.id, { metadata: { ...(selectedNode.metadata || {}), audioInstructions: event.target.value } })} /></div>
                    </> : null}
                    {!selectedVideoConfig && !selectedAudioConfig && selectedGenerationMode !== "image" && selectedNode.kind !== "config" ? <p className="prompt-copy">当前模式没有额外参数。</p> : null}
                  </PopoverContent>
                </Popover>
                <div className="node-card-primary">
                  {/* 数量/积分 chip 挪到生成按钮旁 */}
                  <Popover>
                    <PopoverTrigger asChild>
                      <button type="button" className="node-chip node-credit-chip" title="生成数量与积分消耗（1:1）"><Zap size={12} /> ×{imageCountFromNode(selectedNode)}</button>
                    </PopoverTrigger>
                    <PopoverContent className="node-pop-card" align="end" sideOffset={8}>
                      <p className="eyebrow">数量 / 积分</p>
                      <div className="param-segments">
                        {[1, 2, 4, 6].map((count) => (
                          <button key={count} type="button" className={imageCountFromNode(selectedNode) === count ? "active" : ""} onClick={() => updateNode(selectedNode.id, { metadata: { ...(selectedNode.metadata || {}), count } })}>×{count}</button>
                        ))}
                      </div>
                      <p className="node-pop-hint">当前暂定所有类型生成积分消耗与数量 1:1</p>
                    </PopoverContent>
                  </Popover>
                  {selectedNode.kind === "director" ? (
                    <button className="node-send-button" onClick={() => void openDirectorNode(selectedNode)}><ArrowRight size={15} /> 导演台</button>
                  ) : runningNodeIds.has(selectedNode.id) ? (
                    <div className="node-send-running">
                      <button className="node-send-button is-running" disabled><Loader2 className="spin" size={14} /> 生成中</button>
                      <button className="node-send-button node-send-cancel" title="取消任务" onClick={() => stopGenerationByNodeId(selectedNode.id)}><Square size={13} /> 取消</button>
                    </div>
                  ) : selectedNode.metadata?.status === "error" ? (
                    <button className="node-send-button" onClick={() => {
                      if (selectedGenerationMode === "image") void retryImageNode(selectedNode);
                      else if (selectedGenerationMode === "video") void retryVideoNode(selectedNode);
                      else if (selectedGenerationMode === "audio") void retryAudioNode(selectedNode);
                      else void retryTextNode(selectedNode);
                    }}><RotateCcw size={14} /> 重试</button>
                  ) : (
                    <button className="node-send-button" onClick={() => void generateFromNode()}><ArrowUp size={15} /> 生成</button>
                  )}
                </div>
              </div>

              <div className="node-card-ops">
                <button title="从此节点连接" onClick={() => activateConnectionMode(selectedNode.id)}><Link2 size={14} /></button>
                <button title="复制节点（仅入边）" onClick={() => void duplicateSelectedNode()}><Copy size={14} /></button>
                <button title="删除节点" onClick={() => removeNode(selectedNode.id)}><Trash2 size={14} /></button>
                <button title="清空输入框内容" disabled={!promptTextFromNode(selectedNode).trim()} onClick={() => updateNodePrompt(selectedNode.id, "")}><Eraser size={14} /></button>
                {selectedNode.kind !== "director" ? <button title="提示词库" onClick={() => setPromptLibraryNodeId(selectedNode.id)}><BookOpen size={14} /></button> : null}
                {selectedNode.kind === "image" ? (
                  <Popover>
                    <PopoverTrigger asChild>
                      <button title="风格"><Palette size={14} /></button>
                    </PopoverTrigger>
                    <PopoverContent className="node-pop-card node-pop-wide" align="end" sideOffset={8}>
                      <p className="eyebrow">风格</p>
                      <div className="style-preset-tabs">
                        {STYLE_CATEGORIES.map((category) => (
                          <button key={category.value} type="button" className={styleCategory === category.value ? "active" : ""} onClick={() => setStyleCategory(category.value)}>{category.label}</button>
                        ))}
                      </div>
                      <div className="style-preset-grid">
                        {STYLE_PRESETS.filter((item) => item.category === styleCategory).map((item) => (
                          <button key={item.name} type="button" className="style-preset-card" title={item.prompt} onClick={() => {
                            const base = promptTextFromNode(selectedNode).trim();
                            updateNodePrompt(selectedNode.id, base ? `${base}，${item.prompt}` : item.prompt);
                          }}>
                            <i className="style-preset-thumb" style={{ background: item.gradient }} />
                            <span>{item.name}</span>
                          </button>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                ) : null}
                {selectedNode.kind === "video" ? <button title="分镜栏编辑" onClick={() => setStoryboardEditorNodeId(selectedNode.id)}><GalleryHorizontalEnd size={14} /></button> : null}
                {selectedNode.kind === "image" ? <button title="我的提示词预设" onClick={() => setPresetManagerOpen(true)}><BookMarked size={14} /></button> : null}
                {selectedNode.kind !== "director" ? (
                  <Popover onOpenChange={(open) => { if (open) onSkillsOpen(); }}>
                    <PopoverTrigger asChild>
                      <button title="优化提示词" disabled={promptOptimizing}>{promptOptimizing ? <Loader2 className="spin" size={14} /> : <WandSparkles size={14} />}</button>
                    </PopoverTrigger>
                    <PopoverContent className="node-pop-card" align="end" sideOffset={8}>
                      <p className="eyebrow">选择优化技能</p>
                      <button className="node-pop-item" disabled={promptOptimizing} onClick={() => void optimizeNodePrompt(selectedNode)}><WandSparkles size={13} /> 默认优化</button>
                      {enabledSkills.map((skill) => (
                        <button key={skill.id} className="node-pop-item" disabled={promptOptimizing} title={skill.description || skill.prompt} onClick={() => void optimizeNodePrompt(selectedNode, skill.prompt)}><Bot size={13} /> {skill.title}</button>
                      ))}
                      <button className="node-pop-item" onClick={() => setSkillLibraryOpen(true)}><Plus size={13} /> 管理技能库…</button>
                    </PopoverContent>
                  </Popover>
                ) : null}
                <button title="skill 库" onClick={() => setSkillLibraryOpen(true)}><Bot size={14} /></button>
                <Popover>
                  <PopoverTrigger asChild>
                    <button title="更多操作"><MoreHorizontal size={14} /></button>
                  </PopoverTrigger>
                  <PopoverContent className="node-pop-card" align="end" sideOffset={8}>
                    <p className="eyebrow">节点</p>
                    <div className="node-pop-field">
                      <span className="field-label">节点标题</span>
                      <input value={selectedNode.title} onChange={(event) => updateNode(selectedNode.id, { title: event.target.value })} />
                    </div>
                    {selectedVideoSeedance ? (
                      <>
                        <button className="node-pop-item" onClick={() => setMaterialNodeId(selectedNode.id)}><UserRound size={14} /> 活体授权素材 {selectedNode.metadata?.seedanceMaterialAssets?.length || 0}</button>
                        <button className="node-pop-item" onClick={() => setSeedanceAssetNodeId(selectedNode.id)}><UserRoundCog size={14} /> 拟真人素材 {selectedNode.metadata?.seedanceVolcanoAssets?.length || 0}</button>
                      </>
                    ) : null}
                    {selectedNode.kind === "text" ? <button className="node-pop-item" onClick={() => void archiveCanvasTextNode(selectedNode)}><Archive size={14} /> 加入素材库</button> : null}
                    {selectedNode.kind === "video" ? <button className="node-pop-item" onClick={() => void captureVideoFrameNode(selectedNode)} disabled={Boolean(captureFrameNodeId)}><Camera size={14} /> {captureFrameNodeId === selectedNode.id ? "创建中…" : "当前帧创建图片"}</button> : null}
                    {selectedNode.kind === "video" || selectedNode.kind === "audio" ? <button className="node-pop-item" onClick={() => void archiveCanvasMediaNode(selectedNode)}><Archive size={14} /> 加入素材库</button> : null}
                    {selectedNode.kind === "image" || selectedNode.kind === "video" || selectedNode.kind === "audio" ? <button className="node-pop-item" onClick={() => void downloadSelectedMedia()}><Download size={14} /> 下载 / 导出当前媒体</button> : null}
                  </PopoverContent>
                </Popover>
              </div>
            </>
          ) : <div className="empty-output"><p>选择一个节点后编辑。</p></div>}
          {selectedNode && !selectedGroup ? (
            <button className="node-panel-resize" title="拖动调整面板宽度" aria-label="拖动调整面板宽度" onPointerDown={(event) => startPanelWidthResize(event, selectedNode)} />
          ) : null}
        </aside>
  );
}

function presetPriorityLabel(priority: PromptPresetView["priority"]) {
  return priority === "pinned" ? "置顶" : priority === "high" ? "高频" : priority === "low" ? "低频" : "常用";
}

function ratioIconStyle(ratio: string): CSSProperties {
  const sizeMap: Record<string, [number, number]> = {
    "1:1": [16, 16],
    "16:9": [22, 12],
    "9:16": [12, 22],
    "21:9": [24, 10],
    "9:21": [10, 24],
    "3:4": [14, 19],
    "4:3": [19, 14],
    "5:4": [19, 15],
    "4:5": [15, 19],
    "3:2": [21, 14],
    "2:3": [14, 21],
    "2:1": [22, 11],
    "1:2": [11, 22],
    panorama: [26, 10],
  };
  const [width, height] = sizeMap[ratio] || [17, 17];
  return { width, height, borderStyle: ratio === "auto" || ratio === "adaptive" ? "dashed" : "solid" };
}

function sizeToRatioLabel(size: string) {
  if (size === "auto") return "adaptive";
  const [width, height] = size.split("x").map(Number);
  if (!width || !height) return size;
  const greatestCommonDivisor = (left: number, right: number): number => (
    right ? greatestCommonDivisor(right, left % right) : left
  );
  const divisor = greatestCommonDivisor(width, height);
  return `${width / divisor}:${height / divisor}`;
}
