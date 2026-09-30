import type { CanvasProject } from "@/entities/project";

export type ProjectCardData = {
  id?: string;
  title: string;
  code: string;
  image: string;
  state: string;
  color: "blue" | "red" | "sand";
  time: string;
};

export function projectToCard(
  project: CanvasProject,
  index: number
): ProjectCardData {
  return {
    id: project.id,
    title: project.title,
    code: `PRJ-${project.id.slice(-4).toUpperCase()}`,
    image: "",
    state: "进行中",
    color: (["blue", "red", "sand"] as const)[index % 3],
    time: new Date(project.updated_at).toLocaleDateString("zh-CN", {
      month: "long",
      day: "numeric",
    }),
  };
}
