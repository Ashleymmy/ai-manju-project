import {
  createProject as createCanvasProject,
  setCanvasBootstrap as writeCanvasBootstrap,
} from "@/entities/project";

import {
  createInitialCanvasSnapshot,
  type ChatCanvasSnapshot,
} from "./model/createInitialCanvasSnapshot";

export type ChatProjectCreatePayload = {
  title: string;
  scope: "personal";
  data: ChatCanvasSnapshot;
};

export type ChatProjectFlowDependencies = {
  navigate: (path: string) => void;
  createProject?: (
    payload: ChatProjectCreatePayload
  ) => Promise<{ id: string }>;
  setCanvasBootstrap?: (projectId: string, prompt: string) => void;
  createId?: () => string;
};

export type ChatProjectFlow = (prompt: string) => Promise<void>;

export function createChatProjectFlow({
  navigate,
  createProject = createCanvasProject,
  setCanvasBootstrap = writeCanvasBootstrap,
  createId = () => crypto.randomUUID(),
}: ChatProjectFlowDependencies): ChatProjectFlow {
  return async rawPrompt => {
    const prompt = rawPrompt.trim();
    const project = await createProject({
      title: prompt.slice(0, 50),
      scope: "personal",
      data: createInitialCanvasSnapshot(prompt, createId),
    });

    setCanvasBootstrap(project.id, prompt);
    navigate(`/canvas/${encodeURIComponent(project.id)}?scope=personal`);
  };
}
