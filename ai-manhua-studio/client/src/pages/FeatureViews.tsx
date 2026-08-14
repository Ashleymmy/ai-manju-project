/**
 * Style reminder: 影印分镜室 — each production surface is an editorial instrument panel, not a generic dashboard card wall.
 */
import {
  Aperture,
  Archive,
  ArrowUpRight,
  Box,
  Check,
  ChevronRight,
  Clapperboard,
  FileText,
  Film,
  FolderOpen,
  Hash,
  Image as ImageIcon,
  Layers3,
  Lightbulb,
  ListTree,
  Maximize2,
  Move3d,
  PanelRight,
  Pause,
  Play,
  Plus,
  Rotate3d,
  ScanSearch,
  Search,
  SlidersHorizontal,
  Sparkles,
  Tag,
  Trash2,
  Upload,
  WandSparkles,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const cityUrl = "";
const desertUrl = "";
const roomUrl = "";

function SurfaceTitle({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: React.ReactNode }) {
  return <div className="feature-title"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{actions}</div>;
}

export function DirectorView() {
  const [tool, setTool] = useState("镜头");
  const [view, setView] = useState("perspective");
  return <div className="feature-page director-page"><SurfaceTitle eyebrow="DIRECTOR / SCENE 08" title="3D 导演台" description="先在可控机位里校准构图，再将镜头交还给生成流程。" actions={<><button className="outline-button small" onClick={() => toast.success("镜头构图快照已保存") }><Check size={15} /> 保存构图</button><button className="vermilion-button" onClick={() => toast.message("已将当前构图送入关键帧生成") }><WandSparkles size={16} /> 送入关键帧</button></>} /><div className="director-workspace"><aside className="director-rail"><p className="field-label">SCENE TOOLKIT</p>{[["镜头", Aperture], ["物件", Box], ["角色", Move3d], ["灯光", Lightbulb], ["世界", Rotate3d]].map(([label, Icon]) => <button key={label as string} className={tool === label ? "selected" : ""} onClick={() => setTool(label as string)}><Icon size={18} /><span>{label as string}</span></button>)}<div className="director-rail-foot"><span>SNAP</span><button onClick={() => toast.info("吸附已切换为 0.25m")}>0.25m</button></div></aside><section className="director-stage"><div className="director-toolbar"><div>{["perspective", "front", "side"].map((item) => <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}>{item === "perspective" ? "透视" : item === "front" ? "正视" : "侧视"}</button>)}</div><span>CAM_A · 35mm · f/2.8</span><button onClick={() => toast.info("已进入全屏预览") }><Maximize2 size={16} /></button></div><div className="scene-view"><img src={cityUrl} alt="雨夜巷口场景构图" /><div className="scene-grid" /><div className="camera-frame"><i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" /><b>SHOT 04 · RAIN SHELTER</b></div><div className="scene-object character"><span>CHR_01</span><i /></div><div className="scene-object prop"><span>PROP_12</span><i /></div><div className="horizon">HORIZON / 1.45m</div></div><div className="director-timeline"><div><button onClick={() => toast.message("预览播放") }><Play size={16} fill="currentColor" /></button><b>00:00:12:08</b></div><div className="shot-strip"><button className="shot-thumb selected"><img src={cityUrl} alt="" /><span>04</span></button><button className="shot-thumb"><img src={roomUrl} alt="" /><span>05</span></button><button className="shot-thumb"><img src={desertUrl} alt="" /><span>06</span></button><button className="add-shot"><Plus size={16} /></button></div></div></section><aside className="director-inspector"><p className="eyebrow">CAMERA INSPECTOR</p><h3>{tool}控制</h3><div className="inspector-preview"><img src={cityUrl} alt="镜头预览" /><span>CAM_A</span></div>{[["焦距", "35 mm"], ["景深", "f / 2.8"], ["高度", "1.65 m"], ["俯仰", "−4°"]].map(([label, value]) => <label key={label}>{label}<b>{value}</b><input type="range" defaultValue="55" /></label>)}<button className="full-outline" onClick={() => toast.message("参数将随当前导演台会话保存")}>应用到当前镜头 <ChevronRight size={16} /></button></aside></div></div>;
}

const candidates = [{ name: "阮澄", type: "主角 · character", image: desertUrl, tag: "待审" }, { name: "雨幕收容所", type: "核心场景 · environment", image: cityUrl, tag: "已识别" }, { name: "避雨亭", type: "关键道具 · prop", image: roomUrl, tag: "待审" }];

export function ComicAssetsView() {
  const [stage, setStage] = useState(1);
  const [selected, setSelected] = useState<string[]>(["阮澄", "雨幕收容所"]);
  const toggle = (name: string) => setSelected((items) => items.includes(name) ? items.filter((item) => item !== name) : [...items, name]);
  return <div className="feature-page comic-page"><SurfaceTitle eyebrow="COMIC ASSETS / PRJ-09" title="漫剧资产助手" description="把剧本拆解为可确认、可优化、可批量生成的角色与场景资产。" actions={<button className="vermilion-button" onClick={() => setStage(Math.min(3, stage + 1))}>{stage === 3 ? "创建生成批次" : "进入下一步"} <ChevronRight size={16} /></button>} /><div className="workflow-steps">{[[1, "上传剧本"], [2, "审阅候选"], [3, "批量生成"]].map(([number, label]) => <button key={number} className={stage === number ? "active" : stage > Number(number) ? "done" : ""} onClick={() => setStage(Number(number))}><i>{stage > Number(number) ? <Check size={12} /> : `0${number}`}</i><span>{label}</span></button>)}</div>{stage === 1 && <section className="script-intake"><div className="script-drop"><Upload size={26} /><h2>将剧本放进分镜室</h2><p>支持 PDF、DOCX 与纯文本。系统会提取角色、场景、道具和关键情绪线。</p><button className="outline-button" onClick={() => toast.success("《雨幕收容所_第01集.pdf》已加入分析队列") }><Upload size={16} /> 选择剧本文件</button></div><aside><p className="eyebrow">ANALYSIS SETTINGS</p><label>解析粒度<button>角色 + 场景 + 道具 <ChevronRight size={15} /></button></label><label>视觉基调<button>现实感悬疑 <ChevronRight size={15} /></button></label><div className="source-note"><FileText size={16} /><span>也可以从已有项目导入剧本文本。</span></div></aside></section>}{stage === 2 && <section className="candidate-review"><aside className="candidate-sidebar"><p className="eyebrow">SESSION / 07</p><h2>第 01 集<br />候选资产</h2><div className="analysis-meter"><i style={{ width: "78%" }} /><span>解析置信度 78%</span></div>{[["角色", "03"], ["环境", "06"], ["道具", "12"]].map(([label, count]) => <button key={label}><span>{label}</span><b>{count}</b></button>)}<button className="full-outline" onClick={() => toast.info("已创建新的候选修订版本")}>新建修订版本</button></aside><div className="candidate-grid">{candidates.map((candidate) => <article key={candidate.name} className={selected.includes(candidate.name) ? "candidate selected" : "candidate"}><div><img src={candidate.image} alt="" /><span>{candidate.tag}</span><button onClick={() => toggle(candidate.name)}>{selected.includes(candidate.name) ? <Check size={15} /> : <Plus size={15} />}</button></div><h3>{candidate.name}</h3><p>{candidate.type}</p><div className="candidate-tags"><span>电影感</span><span>雨夜</span></div><button className="prompt-link" onClick={() => toast.message(`已展开 ${candidate.name} 的提示词草稿`) }>审阅提示词 <ArrowUpRight size={14} /></button></article>)}</div><aside className="approval-panel"><p className="eyebrow">BATCH APPROVAL</p><h3>已选择 {selected.length} 项</h3><p>确认后将生成每项资产的标准提示词，并可进入批量图像生成。</p><button className="vermilion-button" onClick={() => setStage(3)}>确认分析结果 <Check size={16} /></button></aside></section>}{stage === 3 && <section className="batch-console"><div className="batch-header"><div><p className="eyebrow">GENERATION BATCH / B-2408</p><h2>第 01 集 · 初始资产批次</h2></div><span className="status-chip running">生成中</span></div>{candidates.map((candidate, index) => <div className="batch-row" key={candidate.name}><img src={candidate.image} alt="" /><div><b>{candidate.name}</b><span>{candidate.type} · G-IMAGE / HIGH</span><div className="job-progress"><i style={{ width: `${index === 0 ? 72 : index === 1 ? 100 : 38}%` }} /></div></div><span>{index === 1 ? "已完成" : `${index === 0 ? 72 : 38}%`}</span><button className="icon-button subtle" onClick={() => toast.info(index === 1 ? "结果已归档到资产库" : "已切换任务暂停状态")}>{index === 1 ? <Check size={16} /> : <Pause size={16} />}</button></div>)}<div className="batch-actions"><button className="outline-button" onClick={() => toast.message("失败项目已加入重试队列")}>重试失败项目</button><button className="outline-button" onClick={() => toast.success("全部结果将归档至资产库")}>查看归档去向</button></div></section>}</div>;
}

export function ImageWorkbenchView() {
  const [model, setModel] = useState("G-IMAGE / HIGH");
  const [result, setResult] = useState(false);
  return <div className="feature-page image-page"><SurfaceTitle eyebrow="KEYFRAME / NEW" title="关键帧生成" description="在一张可继续编辑的画面里落下镜头、氛围与人物关系。" actions={<button className="outline-button small" onClick={() => toast.info("本次会话将在当前项目下保存为草稿")}>保存草稿</button>} /><div className="image-workbench"><section className="image-composer"><div className="composer-tabs"><button className="active">文生图</button><button>图生图</button><button>批量变体</button></div><label className="prompt-editor"><span>SHOT PROMPT</span><textarea defaultValue="雨夜，狭长街道，潮湿沥青反射红色招牌；人物在画面右侧停留，低机位缓慢推近，电影级冷暖对比。" /><small>0 / 800 · 使用 / 插入提示词片段</small></label><div className="reference-strip"><div className="reference-card"><img src={cityUrl} alt="" /><span>构图参考</span><button onClick={() => toast.message("参考图已移除")}>×</button></div><button className="add-reference" onClick={() => toast.success("参考图上传槽已打开") }><Upload size={17} /> 添加参考图</button></div><div className="composer-options"><label>模型<div className="option-select">{model}<ChevronRight size={15} /></div><select value={model} onChange={(event) => setModel(event.target.value)} aria-label="选择模型"><option>G-IMAGE / HIGH</option><option>G-IMAGE / FAST</option><option>SEEDANCE / STYLE</option></select></label><label>画幅<div className="ratio-buttons"><button className="active">1:1</button><button>16:9</button><button>9:16</button></div></label><label>数量<div className="counter"><button>−</button><b>04</b><button>+</button></div></label></div><button className="vermilion-button generate-frame" onClick={() => { setResult(true); toast.success("关键帧生成任务已创建 · JOB-8F13"); }}><WandSparkles size={17} /> 生成关键帧</button></section><aside className="generation-output"><div className="output-heading"><div><p className="eyebrow">RESULTS / {result ? "04" : "00"}</p><h3>{result ? "本次落点" : "等待落点"}</h3></div><button className="icon-button subtle"><SlidersHorizontal size={17} /></button></div>{result ? <div className="result-grid">{[cityUrl, roomUrl, cityUrl, desertUrl].map((image, index) => <button key={`${image}-${index}`} className={index === 0 ? "result-card selected" : "result-card"} onClick={() => toast.message(`已选中变体 ${index + 1}`)}><img src={image} alt="生成结果" /><span>V-{String(index + 1).padStart(2, "0")}</span>{index === 0 && <i><Check size={14} /></i>}</button>)}</div> : <div className="empty-output"><ImageIcon size={27} /><p>生成结果会在这里形成<br />可回到画布继续编辑的节点。</p></div>}<div className="output-foot"><button onClick={() => toast.info("选中结果将送入画布节点") }><Layers3 size={15} /> 送入画布</button><button onClick={() => toast.info("选中结果将归档到资产库") }><Clapperboard size={15} /> 归档资产</button></div></aside></div></div>;
}

const libraryAssets = [
  { id: "AST-208", title: "雨夜巷口", type: "environment", image: cityUrl, source: "canvas / PRJ-034" },
  { id: "AST-207", title: "旅人轮廓", type: "character", image: desertUrl, source: "comic batch / B-2408" },
  { id: "AST-201", title: "旧屋桌面", type: "prop", image: roomUrl, source: "image workbench" },
  { id: "AST-196", title: "密度参考", type: "reference", image: cityUrl, source: "manual upload" },
  { id: "AST-188", title: "白沙光比", type: "environment", image: desertUrl, source: "canvas / PRJ-031" },
  { id: "AST-182", title: "蓝调室内", type: "environment", image: roomUrl, source: "image workbench" },
];

export function AssetLibraryView() {
  const [selected, setSelected] = useState(libraryAssets[0]);
  const [detailTab, setDetailTab] = useState("详情");
  const [smartView, setSmartView] = useState("全部资产");
  return <div className="feature-page asset-library-page"><SurfaceTitle eyebrow="LIBRARY / 248" title="资产库" description="角色、环境、道具与参考素材都能追溯来处、关系和使用位置。" actions={<><button className="outline-button small" onClick={() => toast.info("已切换到批量选择模式") }><ListTree size={15} /> 批量操作</button><button className="vermilion-button" onClick={() => toast.success("上传队列已打开") }><Upload size={16} /> 导入资产</button></>} /><div className="library-workspace"><aside className="library-tree"><p className="field-label">SMART VIEWS</p>{[["全部资产", "248"], ["已收藏", "32"], ["未使用", "17"], ["回收站", "06"]].map(([label, count]) => <button className={smartView === label ? "selected" : ""} onClick={() => setSmartView(label)} key={label}><span>{label === "回收站" ? <Trash2 size={15} /> : label === "已收藏" ? <Sparkles size={15} /> : <Archive size={15} />}{label}</span><b>{count}</b></button>)}<hr /><p className="field-label">FOLDERS</p>{["EP.01 / 雨幕收容所", "角色设定", "场景氛围", "待归档"].map((label, index) => <button className="folder-row" key={label} onClick={() => toast.message(`已筛选文件夹：${label}`)}><FolderOpen size={15} /><span>{label}</span>{index < 3 && <ChevronRight size={14} />}</button>)}<button className="new-folder" onClick={() => toast.success("已创建空白文件夹") }><Plus size={14} /> 新建文件夹</button></aside><section className="asset-browser"><div className="asset-browser-top"><div><button className="breadcrumb">个人素材 <ChevronRight size={13} /></button><h2>{smartView}</h2></div><div><button className="icon-button subtle" onClick={() => toast.message("网格密度已切换") }><SlidersHorizontal size={16} /></button><button className="outline-button small" onClick={() => toast.info("筛选器包含类别、来源、标签与日期")}>筛选与排序</button></div></div><div className="asset-thumb-grid">{libraryAssets.map((asset) => <button className={selected.id === asset.id ? "library-asset selected" : "library-asset"} key={asset.id} onClick={() => setSelected(asset)}><img src={asset.image} alt="" /><span className="asset-category">{asset.type}</span><i>{asset.id}</i><div><b>{asset.title}</b><small>{asset.source}</small></div></button>)}</div></section><aside className="asset-detail"><div className="detail-head"><div><p className="eyebrow">ASSET / {selected.id}</p><h3>{selected.title}</h3></div><button className="icon-button subtle" onClick={() => toast.info("更多资产操作") }><ArrowUpRight size={16} /></button></div><img className="detail-image" src={selected.image} alt="" /><div className="detail-tabs">{["详情", "血缘", "使用"].map((tab) => <button className={detailTab === tab ? "active" : ""} onClick={() => setDetailTab(tab)} key={tab}>{tab}</button>)}</div>{detailTab === "详情" ? <div className="asset-metadata"><div><span>分类</span><b>{selected.type}</b></div><div><span>来源</span><b>{selected.source}</b></div><div><span>规格</span><b>1024 × 1024</b></div><div><span>标签</span><b>雨夜 · 低机位 · 电影感</b></div></div> : detailTab === "血缘" ? <div className="lineage-flow"><span>提示词</span><i /><span>关键帧</span><i /><strong>{selected.title}</strong><i /><span>场景 08</span></div> : <div className="usage-list"><div><b>《雨幕收容所》</b><small>场景 08 · 节点 N-02</small></div><div><b>关键帧生成</b><small>参考图 · 2 次调用</small></div></div>}<div className="asset-detail-actions"><button onClick={() => toast.success("已标记为收藏") }><Sparkles size={15} /> 收藏</button><button onClick={() => toast.info("已加入导出清单") }><Archive size={15} /> 导出</button></div></aside></div></div>;
}

const tagGroups = [
  { name: "镜头语言", children: ["低机位", "推镜", "广角"] },
  { name: "情绪", children: ["压迫", "静谧", "疏离"] },
  { name: "环境", children: ["雨夜", "室内", "荒漠"] },
];

export function TagLibraryView() {
  const [tag, setTag] = useState("雨夜");
  const [alias, setAlias] = useState("");
  const currentGroup = tagGroups.find((group) => group.children.includes(tag))?.name ?? "环境";
  return <div className="feature-page tag-page"><SurfaceTitle eyebrow="TAXONOMY / 36" title="标签库" description="让构图、情绪与资产在统一的语义索引里互相找到。" actions={<button className="vermilion-button" onClick={() => toast.success("已创建一个新的根标签") }><Plus size={16} /> 新建标签</button>} /><div className="tag-workspace"><aside className="tag-tree"><div className="tag-search"><Search size={15} /><input placeholder="检索标签" /></div><p className="field-label">TAG TREE</p>{tagGroups.map((group) => <div className="tag-group" key={group.name}><b><ChevronRight size={13} />{group.name}</b>{group.children.map((child) => <button className={tag === child ? "selected" : ""} onClick={() => setTag(child)} key={child}><Hash size={13} />{child}<span>{child === "雨夜" ? "18" : child === "压迫" ? "12" : "06"}</span></button>)}</div>)}</aside><section className="tag-editor"><div className="tag-editor-head"><div><p className="eyebrow">{currentGroup} / SEMANTIC TAG</p><h2>#{tag}</h2></div><div><button className="outline-button small" onClick={() => toast.info("标签移动面板已打开")}>移动标签</button><button className="icon-button subtle" onClick={() => toast.message("标签删除需二次确认") }><Trash2 size={16} /></button></div></div><div className="tag-description"><span className="field-label">描述</span><textarea defaultValue={`${tag}：用于描述潮湿、低照度且具有反射质感的叙事环境。`} /></div><div className="tag-settings"><label>继承模式<div className="tag-select">自动继承 <ChevronRight size={14} /></div></label><label>作用范围<div className="tag-select">资产 + 提示词 <ChevronRight size={14} /></div></label></div><section className="aliases"><div><span className="field-label">别名</span><small>搜索时会一并匹配</small></div><div className="alias-list"><span>rainy night <button>×</button></span><span>wet alley <button>×</button></span></div><div className="alias-create"><input value={alias} onChange={(event) => setAlias(event.target.value)} placeholder="添加别名" /><button onClick={() => { if (alias.trim()) { toast.success(`已添加别名：${alias}`); setAlias(""); } }}>添加</button></div></section><button className="vermilion-button save-tag" onClick={() => toast.success("标签结构已保存") }><Check size={16} /> 保存标签</button></section><aside className="tag-relations"><p className="eyebrow">CONNECTIONS</p><div><b>18</b><span>关联资产</span><button onClick={() => toast.info("已筛选出使用该标签的资产")}>查看资产 <ArrowUpRight size={14} /></button></div><div><b>06</b><span>提示词模板</span><button onClick={() => toast.info("已筛选出使用该标签的提示词")}>查看提示词 <ArrowUpRight size={14} /></button></div><section><p className="field-label">常用共现</p>{["低机位", "红色招牌", "潮湿地面"].map((item) => <button onClick={() => setTag(item === "低机位" ? item : tag)} key={item}><Tag size={13} />{item}<span>× {item === "低机位" ? "12" : "08"}</span></button>)}</section></aside></div></div>;
}

const promptTemplates = [
  { name: "雨夜巷口 · 电影场景", category: "环境", tags: ["雨夜", "低机位"], prompt: "雨夜，狭长街道，潮湿沥青反射红色招牌，低机位推近，电影级冷暖对比。" },
  { name: "荒漠旅人 · 角色定场", category: "角色", tags: ["荒漠", "疏离"], prompt: "白沙风暴边缘的旅人剪影，宽幅留白，衣料具有磨损质感，叙事感强。" },
  { name: "旧屋桌面 · 记忆道具", category: "道具", tags: ["室内", "静谧"], prompt: "旧屋的深夜桌面，蓝色电视雪花与暖色台灯交错，散落的手稿和磁带。" },
];

export function PromptLibraryView() {
  const [active, setActive] = useState(promptTemplates[0]);
  const [query, setQuery] = useState("");
  const visible = promptTemplates.filter((item) => item.name.includes(query) || item.tags.some((tag) => tag.includes(query)));
  return <div className="feature-page prompt-page"><SurfaceTitle eyebrow="PROMPTS / 18" title="提示词库" description="把反复有效的视觉语言变成下一次镜头的可调用片段。" actions={<button className="vermilion-button" onClick={() => toast.success("已创建空白提示词预设") }><Plus size={16} /> 新建预设</button>} /><div className="prompt-workspace"><aside className="prompt-filters"><div className="tag-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="关键词、标签或镜头" /></div><p className="field-label">CATEGORIES</p>{[["全部模板", "18"], ["环境", "06"], ["角色", "04"], ["道具", "03"], ["镜头语言", "05"]].map(([name, count]) => <button className={name === "全部模板" ? "selected" : ""} key={name}><span>{name}</span><b>{count}</b></button>)}<hr /><p className="field-label">常用标签</p>{["雨夜", "低机位", "日系色彩", "手持镜头", "电影感"].map((tag) => <button className="tag-filter" onClick={() => setQuery(tag)} key={tag}>#{tag}</button>)}</aside><section className="template-list"><div className="template-list-head"><span>匹配到 {visible.length} 条视觉片段</span><button onClick={() => toast.info("排序方式：最近使用")}>最近使用 <ChevronRight size={14} /></button></div>{visible.map((item) => <button className={active.name === item.name ? "template-card selected" : "template-card"} onClick={() => setActive(item)} key={item.name}><div><span>{item.category}</span><b>{item.name}</b><p>{item.prompt}</p></div><div className="template-card-tags">{item.tags.map((tag) => <i key={tag}>#{tag}</i>)}</div></button>)}</section><aside className="prompt-preview"><div><p className="eyebrow">PRESET PREVIEW</p><h3>{active.name}</h3></div><div className="preview-tags">{active.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div><textarea value={active.prompt} onChange={(event) => setActive({ ...active, prompt: event.target.value })} /><small>这个片段会在插入时保留标签语义。</small><button className="vermilion-button" onClick={() => toast.success("提示词已插入关键帧生成器") }><WandSparkles size={16} /> 送入关键帧</button><button className="full-outline" onClick={() => toast.info("提示词已复制到剪贴板") }><FileText size={15} /> 复制完整提示词</button></aside></div></div>;
}
