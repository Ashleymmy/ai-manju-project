import { useEffect, useState, type CSSProperties } from "react";

/** Keep card sizing local to the library and retain a usable thumbnail width. */
export const ASSET_GRID_SIZE = {
  defaultColumns: 3,
  minColumns: 3,
  maxColumns: 8,
  minCardWidth: 120,
  gap: 10,
  storageKey: "ai-manju:asset-grid-columns",
} as const;

function readPreferredColumns() {
  try {
    const value = Number(localStorage.getItem(ASSET_GRID_SIZE.storageKey));
    if (Number.isInteger(value) && value >= ASSET_GRID_SIZE.minColumns && value <= ASSET_GRID_SIZE.maxColumns) return value;
  } catch { /* Restricted storage must not prevent browsing assets. */ }
  return ASSET_GRID_SIZE.defaultColumns;
}

export function useAssetGridSize() {
  // A callback ref reattaches the observer when switching back from 真人素材.
  const [container, containerRef] = useState<HTMLElement | null>(null);
  const [preferredColumns, setPreferredColumns] = useState(readPreferredColumns);
  const [availableColumns, setAvailableColumns] = useState<number>(ASSET_GRID_SIZE.maxColumns);

  useEffect(() => {
    const element = container;
    if (!element) return;
    const measure = (width: number) => {
      setAvailableColumns(Math.max(ASSET_GRID_SIZE.minColumns, Math.min(
        ASSET_GRID_SIZE.maxColumns,
        Math.floor((width + ASSET_GRID_SIZE.gap) / (ASSET_GRID_SIZE.minCardWidth + ASSET_GRID_SIZE.gap)),
      )));
    };
    const measureElement = () => {
      const style = getComputedStyle(element);
      measure(element.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0));
    };
    measureElement();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measureElement);
      return () => window.removeEventListener("resize", measureElement);
    }
    const observer = new ResizeObserver(entries => {
      if (entries[0]) measure(entries[0].contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [container]);

  useEffect(() => {
    try { localStorage.setItem(ASSET_GRID_SIZE.storageKey, String(preferredColumns)); }
    catch { /* In-memory sizing still works if preferences cannot be persisted. */ }
  }, [preferredColumns]);

  const columns = Math.min(preferredColumns, availableColumns);
  const changeColumns = (delta: number) => setPreferredColumns(current => Math.max(
    ASSET_GRID_SIZE.minColumns,
    Math.min(availableColumns, Math.min(current, availableColumns) + delta),
  ));

  return {
    containerRef,
    columns,
    canZoomIn: columns > ASSET_GRID_SIZE.minColumns,
    canZoomOut: columns < availableColumns,
    zoomIn: () => changeColumns(-1),
    zoomOut: () => changeColumns(1),
    gridStyle: {
      "--asset-grid-columns": columns,
      "--asset-grid-gap": `${ASSET_GRID_SIZE.gap}px`,
    } as CSSProperties,
  };
}
