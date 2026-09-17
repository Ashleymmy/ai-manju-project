function copyWithLegacyCommand(value: string): boolean {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") return false;
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.cssText = "position:fixed;top:0;left:-9999px;opacity:0";
  const activeElement = document.activeElement;
  const selection = document.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
  try {
    document.body.appendChild(textarea);
    textarea.focus({ preventScroll: true });
    textarea.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
    if (activeElement instanceof HTMLElement && activeElement.isConnected) activeElement.focus({ preventScroll: true });
    if (selection) {
      selection.removeAllRanges();
      ranges.forEach(range => selection.addRange(range));
    }
  }
}

/** Keep a synchronous fallback for HTTP pages and browsers that reject async clipboard writes. */
export async function copyTextToClipboard(text: string): Promise<"empty" | "copied" | "failed"> {
  if (!text.trim()) return "empty";
  try {
    if (typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return "copied";
    }
  } catch {
    // Continue with the browser's legacy copy command if the async API rejects the write.
  }
  return copyWithLegacyCommand(text) ? "copied" : "failed";
}
