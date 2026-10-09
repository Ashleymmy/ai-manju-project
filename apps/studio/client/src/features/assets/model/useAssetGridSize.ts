import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import { settingsQueryKeys, updatePreferences, usePreferencesQuery } from "@/features/settings";

/** Keep card sizing local to the library and retain a usable thumbnail width. */
export const ASSET_GRID_SIZE = {
  /** Used until the user picks a column count; the choice is stored in their account preferences. */
  defaultColumns: 4,
  minColumns: 3,
  maxColumns: 8,
  /** 116px lets the default 4 columns fit the ~498px browser column on 1366px-wide screens. */
  minCardWidth: 116,
  gap: 10,
  /** Rapid zoom clicks are coalesced into one preference write. */
  saveDelayMs: 400,
} as const;

/**
 * The thumbnail viewport is sized to show exactly `rows` rows at `columns` columns,
 * independent of the current zoom level and of the folder tree height.
 */
export const ASSET_GRID_VIEWPORT = {
  columns: 4,
  rows: 3,
  /** Matches `.asset-card-media { aspect-ratio: 1.16 }`. */
  mediaAspectRatio: 1.16,
  /** Card caption (name row) plus the 1px top/bottom card borders. */
  cardChromeHeight: 52,
  /** Horizontal card borders subtracted from the card width before applying the media ratio. */
  cardBorderWidth: 2,
  minHeight: 320,
} as const;

export function assetGridViewportHeight(contentWidth: number, verticalPadding = 0) {
  const { columns, rows, mediaAspectRatio, cardChromeHeight, cardBorderWidth, minHeight } = ASSET_GRID_VIEWPORT;
  const cardWidth = (contentWidth - ASSET_GRID_SIZE.gap * (columns - 1)) / columns;
  const rowHeight = Math.max(0, cardWidth - cardBorderWidth) / mediaAspectRatio + cardChromeHeight;
  return Math.max(minHeight, Math.ceil(rowHeight * rows + ASSET_GRID_SIZE.gap * (rows - 1) + verticalPadding));
}

export function savedAssetGridColumns(value: unknown) {
  return Number.isInteger(value) && (value as number) >= ASSET_GRID_SIZE.minColumns && (value as number) <= ASSET_GRID_SIZE.maxColumns
    ? value as number
    : null;
}

export function useAssetGridSize() {
  const queryClient = useQueryClient();
  const preferencesQuery = usePreferencesQuery();
  // A callback ref reattaches the observer when switching back from 真人素材.
  const [container, containerRef] = useState<HTMLElement | null>(null);
  const [chosenColumns, setChosenColumns] = useState<number | null>(null);
  const [availableColumns, setAvailableColumns] = useState<number>(ASSET_GRID_SIZE.maxColumns);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const pendingSave = useRef<number | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const preferredColumns = chosenColumns
    ?? savedAssetGridColumns(preferencesQuery.data?.canvas?.assetGridColumns)
    ?? ASSET_GRID_SIZE.defaultColumns;

  const flushSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const value = pendingSave.current;
    if (value === null) return;
    pendingSave.current = null;
    void updatePreferences({ canvas: { assetGridColumns: value } })
      .then(saved => queryClient.setQueryData(settingsQueryKeys.preferences(), saved))
      .catch(() => { /* The in-session choice still applies; it is retried on the next change. */ });
  }, [queryClient]);

  // Leaving the library must not drop a choice still waiting for the debounce.
  useEffect(() => flushSave, [flushSave]);

  useEffect(() => {
    const element = container;
    if (!element) return;
    const measure = (width: number) => {
      setAvailableColumns(Math.max(ASSET_GRID_SIZE.minColumns, Math.min(
        ASSET_GRID_SIZE.maxColumns,
        Math.floor((width + ASSET_GRID_SIZE.gap) / (ASSET_GRID_SIZE.minCardWidth + ASSET_GRID_SIZE.gap)),
      )));
      const style = getComputedStyle(element);
      const verticalPadding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
      if (width > 0) setViewportHeight(assetGridViewportHeight(width, verticalPadding));
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

  const columns = Math.min(preferredColumns, availableColumns);
  const changeColumns = (delta: number) => {
    const next = Math.max(ASSET_GRID_SIZE.minColumns, Math.min(availableColumns, columns + delta));
    if (next === columns) return;
    setChosenColumns(next);
    pendingSave.current = next;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushSave, ASSET_GRID_SIZE.saveDelayMs);
  };

  return {
    container,
    containerRef,
    columns,
    canZoomIn: columns > ASSET_GRID_SIZE.minColumns,
    canZoomOut: columns < availableColumns,
    zoomIn: () => changeColumns(-1),
    zoomOut: () => changeColumns(1),
    gridStyle: {
      "--asset-grid-columns": columns,
      "--asset-grid-gap": `${ASSET_GRID_SIZE.gap}px`,
      ...(viewportHeight ? { "--asset-grid-viewport-height": `${viewportHeight}px` } : {}),
    } as CSSProperties,
  };
}
