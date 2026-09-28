import type { ComponentType, ReactNode } from "react";
import { FolderInput } from "lucide-react";
import "./assetTransfer.css";

type Props = {
  title: string;
  count: number;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  note: ReactNode;
  listLabel: string;
  footerText: string;
  footerAction?: ReactNode;
  children: ReactNode;
};

export function AssetTransferPanel({ title, count, icon: Icon, note, listLabel, footerText, footerAction, children }: Props) {
  return <div className="asset-transfer-status">
    <section className="asset-transfer-panel" aria-label={`资产${title}`}>
      <header className="asset-transfer-header">
        <span className="asset-transfer-heading-icon" aria-hidden="true"><Icon size={18} strokeWidth={1.5} /></span>
        <div className="asset-transfer-heading"><h3>{title} <span className="asset-transfer-count">{count}</span></h3></div>
        <span className="asset-transfer-header-note">{note}</span>
      </header>
      <div className="asset-transfer-scroll" tabIndex={0} role="region" aria-label={listLabel}>{children}</div>
      <footer className="asset-transfer-footer"><FolderInput size={13} aria-hidden="true" /><span>{footerText}</span>{footerAction}</footer>
    </section>
  </div>;
}

// Both directions show package sizes in the same units.
const BYTES_PER_KIB = 1024;
export function formatTransferSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < BYTES_PER_KIB) return `${bytes} B`;
  if (bytes < BYTES_PER_KIB ** 2) return `${Math.ceil(bytes / BYTES_PER_KIB)} KB`;
  return `${(bytes / BYTES_PER_KIB ** 2).toFixed(1)} MB`;
}
