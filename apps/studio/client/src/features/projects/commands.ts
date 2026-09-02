import { createProject } from "@/entities/project";
import { publicApiError } from "@/shared/api/errors";
import { toast } from "sonner";

export async function createAndOpenProject(
  navigate: (path: string) => void
) {
  const title = window.prompt("请输入画布项目名称", "未命名画布")?.trim();
  if (!title) return;
  try {
    const project = await createProject({
      title,
      data: { nodes: [], edges: [] },
    });
    navigate(`/canvas/${encodeURIComponent(project.id)}`);
    toast.success("画布项目已创建");
  } catch (error) {
    toast.error(publicApiError(error, "创建画布项目失败"));
  }
}
