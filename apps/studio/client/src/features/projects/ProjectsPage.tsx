import {
  ArrowDownToLine,
  FolderKanban,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

import {
  getProjects,
  getProjectSnapshot,
  type CanvasProject,
} from "@/entities/project";
import { createZip } from "@/lib/zip";
import { ProjectCoverPickerDialog } from "@/components/ProjectCoverPickerDialog";
import { publicApiError } from "@/shared/api/errors";
import type { WorkspaceScope } from "@/shared/config";
import { PageIntro } from "@/shared/ui";

import { createAndOpenProject } from "./commands";
import { useProjectCoverUrls } from "./covers";
import { projectToCard, type ProjectCardData } from "./model";
import { ProjectCard } from "./ProjectCard";
import { ProjectCardTools } from "./ProjectCardTools";
import { useProjectActions } from "./useProjectActions";
import "./styles.css";

const projectsIntro = {
  code: "ARCHIVE / 12",
  title: "全部项目",
  subtitle: "画布、角色与分镜在这里留下持续可回看的版本。",
};

export default function ProjectsPage() {
  const [, navigate] = useLocation();
  const [scope, setScope] = useState<WorkspaceScope>("personal");
  const [apiProjects, setApiProjects] = useState<CanvasProject[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const coverUrls = useProjectCoverUrls(apiProjects, scope);

  useEffect(() => {
    setLoading(true);
    getProjects(scope)
      .then(res => {
        const raw: CanvasProject[] = Array.isArray(res) ? res : res.items;
        setApiProjects(raw || []);
        setSelectedIds(ids =>
          ids.filter(id => (raw || []).some(project => project.id === id))
        );
      })
      .catch(error => {
        setApiProjects([]);
        toast.error(publicApiError(error, "读取项目列表失败"));
      })
      .finally(() => setLoading(false));
  }, [refreshKey, scope]);

  const refresh = () => setRefreshKey(value => value + 1);
  const {
    coverProject,
    setCoverProject,
    renameProject,
    saveCover,
    deleteProjects: removeProjects,
  } = useProjectActions(scope, refresh);
  const toggleSelected = (id: string) =>
    setSelectedIds(ids =>
      ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id]
    );

  const deleteProjects = async (ids: string[]) => {
    if (await removeProjects(ids)) setSelectedIds([]);
  };

  const exportProjects = async (ids: string[]) => {
    if (!ids.length || exporting) return;
    setExporting(true);
    try {
      const files: Array<{ name: string; data: BlobPart }> = [];
      for (const id of ids) {
        const project = apiProjects.find(item => item.id === id);
        if (!project) continue;
        const snapshot = await getProjectSnapshot(id, scope).catch(() => null);
        files.push({
          name: `${project.title.replace(/[^\w一-龥.-]/g, "_") || id}.json`,
          data: JSON.stringify(
            {
              project,
              snapshot: snapshot?.data ?? null,
              exportedAt: new Date().toISOString(),
            },
            null,
            2
          ),
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

  const displayProjects: ProjectCardData[] = apiProjects.map(projectToCard);

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
              }}
            >
              {item === "personal" ? "个人空间" : "团队空间"}
            </button>
          ))}
        </div>
        <div className="project-bulk-bar">
          <span>已选 {selectedIds.length} 项</span>
          <button
            className="outline-button small"
            disabled={!selectedIds.length}
            onClick={() => void deleteProjects(selectedIds)}
          >
            <Trash2 size={14} /> 删除选中
          </button>
          <button
            className="outline-button small"
            disabled={!selectedIds.length || exporting}
            onClick={() => void exportProjects(selectedIds)}
          >
            <ArrowDownToLine size={14} /> {exporting ? "导出中…" : "导出选中"}
          </button>
          <button
            className="outline-button small"
            disabled={!apiProjects.length}
            onClick={() =>
              void deleteProjects(apiProjects.map(project => project.id))
            }
          >
            删除全部
          </button>
        </div>
      </div>
      <div className="project-grid">
        {loading ? (
          <div className="empty-output">
            <FolderKanban size={27} />
            <p>正在读取项目…</p>
          </div>
        ) : displayProjects.length ? (
          displayProjects.map((project, index) => (
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
                  checked={project.id ? selectedIds.includes(project.id) : false}
                  onChange={() => project.id && toggleSelected(project.id)}
                />
              </label>
              <ProjectCardTools
                onCover={() => setCoverProject(apiProjects[index])}
                onRename={() => void renameProject(apiProjects[index])}
                onDelete={() => project.id && void deleteProjects([project.id])}
              />
              <ProjectCard {...project} image={(project.id && coverUrls[project.id]) || project.image} scope={scope} />
            </div>
          ))
        ) : (
          <div className="empty-output">
            <FolderKanban size={27} />
            <p>
              还没有画布项目
              <br />
              点击“新建项目”开始。
            </p>
          </div>
        )}
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
