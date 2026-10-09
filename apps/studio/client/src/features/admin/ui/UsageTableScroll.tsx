import type { ReactNode } from "react";
import * as ScrollArea from "@radix-ui/react-scroll-area";

/** Height of the sticky table header; the vertical bar starts below it so it only spans the rows. */
const TABLE_HEAD_HEIGHT = 40;
/** Gap between the overlay scrollbars and the table edges, in px. */
const SCROLLBAR_INSET = 4;

/**
 * Table container with overlay scrollbars drawn inside the table. Native scrollbars are hidden
 * app-wide, so without these users cannot tell that the capped-height tables scroll.
 */
export function UsageTableScroll({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <ScrollArea.Root type="auto" className={`usage-table-scroll ${className}`.trim()}>
      <ScrollArea.Viewport className="usage-table-viewport">{children}</ScrollArea.Viewport>
      <ScrollArea.Scrollbar
        orientation="vertical"
        className="usage-scrollbar"
        style={{ top: TABLE_HEAD_HEIGHT + SCROLLBAR_INSET, right: SCROLLBAR_INSET, bottom: SCROLLBAR_INSET }}
      >
        <ScrollArea.Thumb className="usage-scrollbar-thumb" />
      </ScrollArea.Scrollbar>
      <ScrollArea.Scrollbar
        orientation="horizontal"
        className="usage-scrollbar"
        style={{ left: SCROLLBAR_INSET, right: SCROLLBAR_INSET, bottom: SCROLLBAR_INSET }}
      >
        <ScrollArea.Thumb className="usage-scrollbar-thumb" />
      </ScrollArea.Scrollbar>
    </ScrollArea.Root>
  );
}
