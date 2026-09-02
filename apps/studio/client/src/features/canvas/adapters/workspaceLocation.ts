import { scopeFromCanvasSearch } from "../domain/workspace";

export function scopeFromCanvasLocation(location: string): "personal" | "team" {
  const query = location.includes("?")
    ? location.slice(location.indexOf("?") + 1)
    : typeof window === "undefined"
      ? ""
      : window.location.search;
  return scopeFromCanvasSearch(query);
}
