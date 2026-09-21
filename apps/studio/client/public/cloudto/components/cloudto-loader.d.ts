export type CloudtoState = 'queued' | 'running' | 'complete' | 'error' | 'cancelled';
export interface CloudtoLoaderElement extends HTMLElement {
  setProgress(value: number | null): void;
  setState(status: CloudtoState, message?: string, detail?: string): void;
  replay(): void;
}
declare global {
  interface HTMLElementTagNameMap { 'cloudto-loader': CloudtoLoaderElement; }
  interface Window { Cloudto: {version: string; showIntro<T>(ready: Promise<T>, options?: {root?: HTMLElement; theme?: 'auto' | 'light' | 'dark'; once?: boolean; key?: string}): Promise<T>}; }
}
