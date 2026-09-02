export {
  getProjects,
  createProject,
  getProject,
  updateProject,
  deleteProject,
  getProjectSnapshot,
  saveProjectSnapshot,
} from "@/entities/project";
export { listComicProjects as getComicProjects } from "@/entities/comic";
export type {
  WorkspaceScope,
  CanvasProject,
  CanvasSnapshotResponse,
} from "@/entities/project";
