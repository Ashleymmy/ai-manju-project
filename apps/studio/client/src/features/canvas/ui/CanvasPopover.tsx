import { createContext, useContext, useEffect, useId, useRef, useState, type ComponentProps, type MutableRefObject } from "react";

import { Popover as BasePopover, PopoverContent as BaseContent, PopoverTrigger as BaseTrigger } from "@/components/ui/popover";
import { useOutsidePress } from "@/shared/lib/useOutsidePress";

type PopoverContext = { path: string; restoreFocus: MutableRefObject<boolean> };
const Context = createContext<PopoverContext | null>(null);

/** Canvas popovers keep ordinary Radix behavior, including keyboard and form interaction. */
export function CanvasPopover({ open: controlledOpen, defaultOpen = false, onOpenChange, active = true, children, ...props }:
  ComponentProps<typeof BasePopover> & { active?: boolean }) {
  const parent = useContext(Context);
  const id = useId();
  const path = [parent?.path, id].filter(Boolean).join(" ");
  const [localOpen, setLocalOpen] = useState(defaultOpen);
  const restoreFocus = useRef(true);
  const open = controlledOpen ?? localOpen;
  const setOpen = (next: boolean) => {
    if (next) restoreFocus.current = true;
    setLocalOpen(next);
    onOpenChange?.(next);
  };

  useEffect(() => {
    if (!active && open) setOpen(false);
  }, [active, open]);

  useOutsidePress(active && open, event => event.composedPath().some(target =>
    target instanceof Element && target.getAttribute("data-canvas-popover-path")?.split(" ").includes(id)
  ), () => {
    // An outside input or toolbar keeps its focus and its original click action.
    restoreFocus.current = false;
    setOpen(false);
  });

  return <Context.Provider value={{ path, restoreFocus }}>
    <BasePopover {...props} open={active && open} onOpenChange={setOpen}>{children}</BasePopover>
  </Context.Provider>;
}

export function CanvasPopoverTrigger(props: ComponentProps<typeof BaseTrigger>) {
  const context = useContext(Context);
  return <BaseTrigger {...props} data-canvas-popover-path={context?.path} />;
}

export function CanvasPopoverContent({ onCloseAutoFocus, ...props }: ComponentProps<typeof BaseContent>) {
  const context = useContext(Context);
  return <BaseContent {...props} data-canvas-ui data-canvas-no-zoom data-canvas-popover-path={context?.path}
    onCloseAutoFocus={event => {
      onCloseAutoFocus?.(event);
      if (context && !context.restoreFocus.current) event.preventDefault();
    }} />;
}
