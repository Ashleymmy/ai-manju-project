import { canvasNodeTitle } from "./nodeTitles";

/** Provider placeholders and upload defaults are not descriptive asset names. */
const GENERATED_EXACT =
  /^(provider_\d+|generated[-_ ]?image(?:[-_ ]?\d+)?|untitled|未命名|图片占位|新图片|图片|生成图片)$/i;
/** Older uploads also used screenshot, numbered image and short hash names. */
const GENERATED_PREFIX = /^(screenshot|image[-_]?\d+|img[-_]?\d+)/i;

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
