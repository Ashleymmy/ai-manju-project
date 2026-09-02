import type { ReactNode } from "react";

export default function CanvasLayout({ children }: { children: ReactNode }) {
  return (
    <div className="studio-app canvas-focus canvas-focus-direct">
      <main className="main-stage">{children}</main>
    </div>
  );
}
