import { useEffect, useRef, useState, type ComponentPropsWithRef, type ReactNode } from "react";

// Brief connection failures should not leave a card blank for the whole visit.
const PREVIEW_RETRY_DELAYS_MS = [1000, 2000] as const;
type Props = ComponentPropsWithRef<"img"> & { fallback?: ReactNode };

/** Native lazy loading keeps off-screen previews out of the download queue.
 * Remount on retry without altering external signed URLs. onError fires only
 * after the bounded retries, so callers can then show a terminal fallback.
 */
export function RetryImage(props: Props) {
  return <RetryImageSource key={props.src} {...props} />;
}

function RetryImageSource({ src, onError, onLoad, fallback, ...props }: Props) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (failed && fallback !== undefined) return <>{fallback}</>;
  return <img loading="lazy" decoding="async" {...props} src={src} key={attempt}
    onLoad={event => { clearTimeout(timer.current); timer.current = undefined; onLoad?.(event); }}
    onError={event => {
      if (timer.current !== undefined) return;
      if (src && !/^(blob|data):/i.test(src) && attempt < PREVIEW_RETRY_DELAYS_MS.length) {
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
