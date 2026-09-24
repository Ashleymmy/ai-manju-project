import type { CanvasNodeData } from "./types";
import { stringValue } from "./value";
import { canvasNodeTitle } from "./nodeTitles";

/** Keep automatic titles short enough to scan on an image card. */
const GENERATED_IMAGE_TITLE_LENGTH = 24;
/** Provider placeholders and upload defaults are not descriptive asset names. */
const GENERATED_EXACT =
  /^(provider_\d+|generated[-_ ]?image(?:[-_ ]?\d+)?|untitled|未命名|图片占位|新图片|图片|生成图片)$/i;
/** Older uploads also used screenshot, numbered image and short hash names. */
const GENERATED_PREFIX = /^(screenshot|image[-_]?\d+|img[-_]?\d+)/i;
/** Internal reference IDs should never leak into automatic card titles. */
const PROMPT_REFERENCE = /@\[(?:node|asset):[^\]]+\]/g;

export function looksLikeGeneratedAssetName(name: string): boolean {
  const value = name.trim();
  if (!value) return true;
  const base = canvasNodeTitle(value);
  return (
    GENERATED_EXACT.test(base) ||
    GENERATED_PREFIX.test(base) ||
    /^[0-9a-f]{8}$/i.test(base)
  );
}

export function generatedImageTitle(
  name: string,
  prompt = "",
): string {
  if (name.trim() && !looksLikeGeneratedAssetName(name)) return canvasNodeTitle(name);
  const summary =
    prompt
      .replace(PROMPT_REFERENCE, "")
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(Boolean) || "";
  const text = /^(?:https?:\/\/|data:|blob:|asset:|\/)/i.test(summary)
    ? ""
    : summary;
  const characters = Array.from(
    text ? canvasNodeTitle(text.replace(/\s+/g, " ")) : ""
  );
  const title = characters.length
    ? characters.slice(0, GENERATED_IMAGE_TITLE_LENGTH).join("") +
      (characters.length > GENERATED_IMAGE_TITLE_LENGTH ? "…" : "")
    : "生成图片";
  // The graph assigns collision numbers for all generation results, including batches.
  return title;
}

/** Migrate old automatic titles without changing imported images or batch summaries. */
export function normalizeGeneratedImageTitle(node: CanvasNodeData): string {
  if (
    node.kind !== "image" ||
    node.metadata?.titleEdited ||
    node.metadata?.canvasOrigin === "imported" ||
    node.metadata?.isBatchRoot ||
    node.metadata?.status === "loading" ||
    node.metadata?.status === "error"
  )
    return node.title;
  const hasImage = Boolean(
    node.imageAssetId || node.imageSrc || node.metadata?.assetId
  );
  if (!hasImage || !looksLikeGeneratedAssetName(node.title)) return node.title;
  return generatedImageTitle(
    node.title,
    stringValue(node.metadata?.prompt) || node.content
  );
}
