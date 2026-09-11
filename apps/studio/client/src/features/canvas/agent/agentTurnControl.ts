export const AGENT_INTERRUPTED_MESSAGE = "已中断当前指令。";

export function isAgentTurnCancelled(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ("name" in error && (error as { name?: string }).name === "AbortError") return true;
  if ("cancelled" in error && Boolean((error as { cancelled?: unknown }).cancelled)) return true;
  return false;
}

export async function copyAgentMessageText(text: string): Promise<"empty" | "copied" | "failed"> {
  const value = text.trim();
  if (!value) return "empty";
  try {
    await navigator.clipboard.writeText(value);
    return "copied";
  } catch {
    return "failed";
  }
}
