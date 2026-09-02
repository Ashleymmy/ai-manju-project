export type SystemPrompt = {
  id: string;
  title: string;
  prompt: string;
  tags: string[];
  category: string;
  preview?: string;
  coverUrl?: string;
  githubUrl?: string;
};

export type SystemPromptListResult = {
  items: SystemPrompt[];
  total: number;
  tags?: string[];
  categories?: string[];
};

export type SystemPromptQuery = {
  keyword?: string;
  category?: string;
  tags?: string[];
};

export type PromptPresetPriority = "pinned" | "high" | "normal" | "low";

export type PromptPreset = {
  id: string;
  title: string;
  prompt: string;
  tags: string[];
  priority: PromptPresetPriority;
  sort_order: number;
  createdAt: string;
  updatedAt: string;
};

export type PromptPresetContainer = {
  canvas?: { promptPresets?: PromptPreset[] };
};

export function promptPresetsFrom(container: PromptPresetContainer | null) {
  return container?.canvas?.promptPresets || [];
}

export function promptPresetPreferencesPayload(promptPresets: PromptPreset[]) {
  return { canvas: { promptPresets } };
}
