import { useEffect, useRef, useState, type ComponentPropsWithRef, type ReactNode } from "react";
import { ImageOff, RotateCcw } from "lucide-react";
import { authenticatedImageSource, recoverAuthenticatedImage } from "@/shared/api/imageRecovery";
import "./RetryImage.css";

// Brief connection failures should not leave a card blank for the whole visit.
const PREVIEW_RETRY_DELAYS_MS = [1000, 2000] as const;
// Bound a failed API recovery so cancellation and manual retry remain responsive.
const IMAGE_RECOVERY_TIMEOUT_MS = 15_000;
type Props = ComponentPropsWithRef<"img"> & {
  fallback?: ReactNode;
  // Opt in only outside interactive cards to avoid nesting buttons.
  showRetryButton?: boolean;
};

/** Native lazy loading keeps off-screen previews out of the download queue.
 * Remount on retry without altering external signed URLs. onError fires only
 * after the bounded retries, so callers can then show a terminal fallback.
 */
export function RetryImage(props: Props) {
  const [revision, setRevision] = useState(0);
  return <RetryImageSource key={`${props.src}:${revision}`} {...props} retry={() => setRevision(value => value + 1)} />;
}

function RetryImageSource({ src, onError, onLoad, fallback, showRetryButton = false, retry, ...props }: Props & { retry: () => void }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [recoveredSrc, setRecoveredSrc] = useState("");
  const recovery = useRef<AbortController | null>(null);
  const ownedUrl = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => {
    clearTimeout(timer.current);
    recovery.current?.abort();
    if (ownedUrl.current) URL.revokeObjectURL(ownedUrl.current);
  }, []);
  if (failed) return fallback !== undefined ? <>{fallback}</> : (
    <span className={`retry-image-error ${props.className || ""}`} style={props.style} title={props.alt}>
      <ImageOff size={20} aria-hidden="true" />
      <span>图片加载失败</span>
      {showRetryButton ? <button type="button" aria-label="重新加载图片" title="重新加载图片" onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); retry(); }}><RotateCcw size={14} /></button> : null}
    </span>
  );
  return <img loading="lazy" decoding="async" {...props} src={recoveredSrc || src} key={attempt}
    onLoad={event => { clearTimeout(timer.current); timer.current = undefined; onLoad?.(event); }}
    onError={event => {
      if (timer.current !== undefined) return;
      if (!recoveredSrc && src && authenticatedImageSource(src)) {
        if (recovery.current) return;
        const controller = new AbortController();
        recovery.current = controller;
        timer.current = setTimeout(() => {
          timer.current = undefined;
          controller.abort();
          setFailed(true);
          onError?.(event);
        }, IMAGE_RECOVERY_TIMEOUT_MS);
        void recoverAuthenticatedImage(src, controller.signal).then(blob => {
          if (controller.signal.aborted) return;
          ownedUrl.current = URL.createObjectURL(blob);
          setRecoveredSrc(ownedUrl.current);
        }).catch(() => {
          if (controller.signal.aborted) return;
          setFailed(true);
          onError?.(event);
        }).finally(() => {
          clearTimeout(timer.current);
          timer.current = undefined;
        });
        return;
      }
      if (!recoveredSrc && src && !/^(blob|data):/i.test(src) && attempt < PREVIEW_RETRY_DELAYS_MS.length) {
        timer.current = setTimeout(() => {
          timer.current = undefined;
          setAttempt(value => value + 1);
        }, PREVIEW_RETRY_DELAYS_MS[attempt]);
      } else {
        setFailed(true);
        onError?.(event);
      }
    }} />;
}
