export const AGENT_INTERRUPTED_MESSAGE = "已中断当前指令。";

export function isAgentTurnCancelled(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ("name" in error && (error as { name?: string }).name === "AbortError") return true;
  if ("cancelled" in error && Boolean((error as { cancelled?: unknown }).cancelled)) return true;
  return false;
}

function copyWithLegacyCommand(value: string): boolean {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") return false;
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  const selection = document.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index)) : [];
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  textarea.remove();
  if (selection) {
    selection.removeAllRanges();
    ranges.forEach(range => selection.addRange(range));
  }
  return copied;
}

export async function copyAgentMessageText(text: string): Promise<"empty" | "copied" | "failed"> {
  const value = text.trim();
  if (!value) return "empty";
  try {
    if (typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function") {
      await navigator.clipboard.writeText(value);
      return "copied";
    }
  } catch {
    // Safari、HTTP 环境以及浏览器权限策略可能拒绝异步剪贴板，继续尝试兼容方案。
  }
  return copyWithLegacyCommand(value) ? "copied" : "failed";
}
