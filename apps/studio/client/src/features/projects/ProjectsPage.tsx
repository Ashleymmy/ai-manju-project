import {
  ArrowDownToLine,
  Copy,
  FolderPlus,
  FolderInput,
  Pencil,
  Ungroup,
  FolderKanban,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

import {
  useProjectSummaries,
} from "@/entities/project";
import { useAuth } from "@/contexts/AuthContext";
import { createZip } from "@/lib/zip";
import { ProjectCoverPickerDialog } from "@/components/ProjectCoverPickerDialog";
import { publicApiError } from "@/shared/api/errors";
import type { WorkspaceScope } from "@/shared/config";
import { PageIntro } from "@/shared/ui";

import { createAndOpenProject } from "./commands";
import { useProjectCoverUrls } from "./covers";
import { projectToCard } from "./model";
import { ProjectCard } from "./ProjectCard";
import { ProjectCardTools } from "./ProjectCardTools";
import { useProjectActions } from "./useProjectActions";
import { PROJECT_GROUP_TITLE_LIMIT, useProjectGroups } from "./useProjectGroups";
import { ProjectListFeedback } from "./ProjectListFeedback";
import { readProjectExport } from "./projectExport";
import "./styles.css";

const projectsIntro = {
  code: "ARCHIVE / 12",
  title: "全部项目",
  subtitle: "画布、角色与分镜在这里留下持续可回看的版本。",
};

export default function ProjectsPage() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const [scope, setScope] = useState<WorkspaceScope>("personal");
  const { projects: apiProjects, loading, refreshing, error: listError, hasLoaded, refresh: refreshList } = useProjectSummaries(scope, user?.id || "");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const [activeGroup, setActiveGroup] = useState("all");
  const projectGroups = useProjectGroups(scope);
  const coverUrls = useProjectCoverUrls(apiProjects, scope);

  useEffect(() => {
    setSelectedIds(ids => ids.filter(id => apiProjects.some(project => project.id === id)));
  }, [apiProjects]);

  const refresh = () => { void refreshList(); };
  const {
    coverProject,
    setCoverProject,
    renameProject,
    saveCover,
    deleteProjects: removeProjects,
    copyingIds,
    duplicateProjects,
  } = useProjectActions(scope, refresh);
  const toggleSelected = (id: string) =>
    setSelectedIds(ids =>
      ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id]
    );

  const deleteProjects = async (ids: string[]) => {
    if (await removeProjects(ids)) setSelectedIds([]);
  };

  const copyProjects = async (ids: string[]) => {
    const createdIds = await duplicateProjects(ids);
    if (createdIds.length) {
      setActiveGroup("all");
      setSelectedIds(createdIds);
    }
  };

  const exportProjects = async (ids: string[]) => {
    if (!ids.length || exporting) return;
    setExporting(true);
    try {
      const files: Array<{ name: string; data: BlobPart }> = [];
      for (const id of ids) {
        const project = apiProjects.find(item => item.id === id);
        if (!project) continue;
        const exported = await readProjectExport(project, scope);
        files.push({
          name: `${project.title.replace(/[^\w一-龥.-]/g, "_") || id}.json`,
          data: JSON.stringify(exported, null, 2),
        });
      }
      if (!files.length) throw new Error("没有可导出的项目");
      const zip = await createZip(files);
      const url = URL.createObjectURL(zip);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `画布项目-${new Date().toISOString().slice(0, 10)}.zip`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      toast.success(`已导出 ${files.length} 个项目`);
    } catch (error) {
      toast.error(publicApiError(error, "导出项目失败"));
    } finally {
      setExporting(false);
    }
  };

  const assigned = new Set(projectGroups.groups.flatMap(group => group.projectIds));
  const currentGroup = projectGroups.groups.find(group => group.id === activeGroup);
  const visibleProjects = apiProjects.filter(project => activeGroup === "all" || (activeGroup === "ungrouped"
    ? !assigned.has(project.id) : currentGroup?.projectIds.includes(project.id)));
  const groupBusy = projectGroups.loading || projectGroups.saving || Boolean(projectGroups.error);
  const selectGroup = (id: string) => { setActiveGroup(id); setSelectedIds([]); };
  const groupTitle = (initial = "") => {
    const title = window.prompt("分组名称", initial)?.trim();
    if (!title) return "";
    if ([...title].length > PROJECT_GROUP_TITLE_LIMIT) { toast.error(`分组名称不能超过 ${PROJECT_GROUP_TITLE_LIMIT} 个字`); return ""; }
    return title;
  };
  const createGroup = async () => {
    const title = groupTitle();
    if (!title) return;
    const id = await projectGroups.create(title, selectedIds);
    if (id) selectGroup(id);
  };

  return (
    <div className="page-content">
      <PageIntro
        copy={projectsIntro}
        action={
          <button
            className="create-button"
            onClick={() => void createAndOpenProject(navigate)}
          >
            <Plus size={17} /> 新建项目
          </button>
        }
      />
      <div className="filter-line">
        <div className="segmented">
          {/* 暂时隐藏"团队空间"切换（全局隐藏），恢复时删除下方 filter 调用 */}
          {(["personal", "team"] as const).filter((item) => item !== "team").map(item => (
            <button
              key={item}
              className={scope === item ? "selected" : ""}
              onClick={() => {
                setScope(item);
                setSelectedIds([]);
                setActiveGroup("all");
              }}
            >
              {item === "personal" ? "个人空间" : "团队空间"}
            </button>
          ))}
        </div>
        <div className="project-bulk-bar">
          <button className="outline-button small" disabled={refreshing} onClick={refresh}>
            <RefreshCw size={14} className={refreshing ? "animate-spin" : undefined} /> {refreshing ? "正在刷新…" : "刷新列表"}
          </button>
          <span>已选 {selectedIds.length} 项</span>
          <button
            className="outline-button small"
            disabled={!selectedIds.length}
            onClick={() => void deleteProjects(selectedIds)}
          >
            <Trash2 size={14} /> 删除选中
          </button>
          <button className="outline-button small" disabled={!selectedIds.length || Boolean(copyingIds.length)} onClick={() => void copyProjects(selectedIds)}>
            <Copy size={14} /> {copyingIds.length ? "复制中…" : "复制选中"}
          </button>
          <button className="outline-button small" disabled={groupBusy} onClick={() => void createGroup()}>
            <FolderPlus size={14} /> 创建分组
          </button>
          <label className="project-group-move">
            <FolderInput size={14} />
            <select aria-label="移入分组" value="" disabled={!selectedIds.length || groupBusy} onChange={event => {
              const targetId = event.target.value;
              void projectGroups.move(selectedIds, targetId === "ungrouped" ? "" : targetId).then(saved => { if (saved) setSelectedIds([]); });
            }}>
              <option value="" disabled>移入分组</option>
              <option value="ungrouped">未分组</option>
              {projectGroups.groups.map(group => <option key={group.id} value={group.id}>{group.title}</option>)}
            </select>
          </label>
          <button
            className="outline-button small"
            disabled={!selectedIds.length || exporting}
            onClick={() => void exportProjects(selectedIds)}
          >
            <ArrowDownToLine size={14} /> {exporting ? "导出中…" : "导出选中"}
          </button>
          <button
            className="outline-button small"
            disabled={!apiProjects.length || Boolean(listError) || refreshing}
            onClick={() =>
              void deleteProjects(apiProjects.map(project => project.id))
            }
          >
            删除全部
          </button>
        </div>
      </div>
      <div className="project-group-navigation">
        <div className="project-group-tabs" aria-label="画布分组">
          <button className={activeGroup === "all" ? "active" : ""} aria-pressed={activeGroup === "all"} onClick={() => selectGroup("all")}>全部 <span>{hasLoaded ? apiProjects.length : "—"}</span></button>
          <button className={activeGroup === "ungrouped" ? "active" : ""} aria-pressed={activeGroup === "ungrouped"} disabled={groupBusy} onClick={() => selectGroup("ungrouped")}>未分组 <span>{hasLoaded ? apiProjects.filter(project => !assigned.has(project.id)).length : "—"}</span></button>
          {projectGroups.groups.map(group => <button key={group.id} className={activeGroup === group.id ? "active" : ""} aria-pressed={activeGroup === group.id} disabled={groupBusy} onClick={() => selectGroup(group.id)}>
            {group.title} <span>{hasLoaded ? apiProjects.filter(project => group.projectIds.includes(project.id)).length : "—"}</span>
          </button>)}
        </div>
        {currentGroup ? <div className="project-group-tools">
          <button className="icon-button" title="重命名分组" aria-label="重命名分组" disabled={groupBusy} onClick={() => { const title = groupTitle(currentGroup.title); if (title && title !== currentGroup.title) void projectGroups.rename(currentGroup.id, title); }}><Pencil size={15} /></button>
          <button className="icon-button" title="解散分组（保留画布）" aria-label="解散分组（保留画布）" disabled={groupBusy} onClick={() => {
            if (window.confirm(`解散“${currentGroup.title}”？组内画布不会删除。`)) void projectGroups.dissolve(currentGroup.id).then(saved => { if (saved) selectGroup("all"); });
          }}><Ungroup size={15} /></button>
        </div> : null}
        {projectGroups.error ? <div role="alert">{projectGroups.error} <button className="outline-button small" onClick={projectGroups.reload}>重试</button></div> : null}
      </div>
      <ProjectListFeedback error={listError} refreshing={refreshing} hasProjects={Boolean(apiProjects.length)} onRetry={refresh} />
      <div className="project-grid">
        {loading ? (
          <div className="empty-output">
            <FolderKanban size={27} />
            <p>正在读取项目…</p>
          </div>
        ) : visibleProjects.length ? (
          visibleProjects.map((source, index) => {
            const project = projectToCard(source, index);
            return (
            <div
              className="project-card-wrap"
              key={`${project.id || project.code}-${index}`}
            >
              <label
                className="project-check"
                onClick={event => event.stopPropagation()}
              >
                <input
                  type="checkbox"
                  aria-label={`选择画布 ${source.title}`}
                  checked={project.id ? selectedIds.includes(project.id) : false}
                  onChange={() => project.id && toggleSelected(project.id)}
                />
              </label>
              <ProjectCardTools
                onCover={() => setCoverProject(source)}
                onRename={() => void renameProject(source)}
                onCopy={() => void copyProjects([source.id])}
                copying={copyingIds.includes(source.id)}
                copyDisabled={Boolean(copyingIds.length)}
                onDelete={() => project.id && void deleteProjects([project.id])}
              />
              <ProjectCard {...project} image={(project.id && coverUrls[project.id]) || project.image} scope={scope} />
            </div>
          ); })
        ) : !listError ? (
          <div className="empty-output">
            <FolderKanban size={27} />
            <p>
              {activeGroup === "all" ? "还没有画布项目" : "该分组暂无画布"}
            </p>
          </div>
        ) : null}
      </div>
      <ProjectCoverPickerDialog
        open={Boolean(coverProject)}
        scope={scope}
        currentCoverAssetId={coverProject?.cover_asset_id}
        onClose={() => setCoverProject(null)}
        onSelect={(assetId) => void saveCover(assetId)}
      />
    </div>
  );
}
