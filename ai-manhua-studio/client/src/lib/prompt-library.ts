import type { PromptPreset, SystemPrompt } from "@/services/api";

export type PromptLibraryEntry = {
  id: string;
  source: "system" | "personal";
  title: string;
  prompt: string;
  tags: string[];
  category?: string;
  priority?: PromptPreset["priority"];
};

const priorityRank: Record<PromptPreset["priority"], number> = { pinned: 0, high: 1, normal: 2, low: 3 };

export function buildPromptLibraryEntries(systemPrompts: readonly SystemPrompt[], personalPrompts: readonly PromptPreset[]) {
  const personal = personalPrompts.map<PromptLibraryEntry>((item) => ({
    id: `personal:${item.id}`,
    source: "personal",
    title: item.title,
    prompt: item.prompt,
    tags: item.tags || [],
    priority: item.priority,
  })).sort((left, right) => priorityRank[left.priority || "normal"] - priorityRank[right.priority || "normal"] || left.title.localeCompare(right.title, "zh-CN"));
  const system = systemPrompts.map<PromptLibraryEntry>((item) => ({
    id: `system:${item.id}`,
    source: "system",
    title: item.title,
    prompt: item.prompt,
    tags: item.tags || [],
    category: item.category,
  }));
  return [...personal, ...system];
}

export function filterPromptLibraryEntries(entries: readonly PromptLibraryEntry[], keyword: string) {
  const query = keyword.trim().toLocaleLowerCase();
  if (!query) return [...entries];
  return entries.filter((item) => [item.title, item.prompt, item.category || "", ...item.tags]
    .some((value) => value.toLocaleLowerCase().includes(query)));
}
