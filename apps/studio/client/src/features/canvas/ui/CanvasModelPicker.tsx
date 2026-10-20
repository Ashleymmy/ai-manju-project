import { ChevronDown } from "lucide-react";
import { useCallback, useState } from "react";

import { CanvasPopover as Popover, CanvasPopoverContent as PopoverContent, CanvasPopoverTrigger as PopoverTrigger } from "./CanvasPopover";

type Props = {
  active: boolean;
  value: string;
  label: string;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  onSelect: (value: string) => void;
};

export function CanvasModelPicker({ active, value, label, options, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  // Hidden models below the fold must be obvious: a cut-off list otherwise looks complete.
  const [moreBelow, setMoreBelow] = useState(false);
  const measure = useCallback((list: HTMLDivElement | null) => {
    if (!list) return;
    setMoreBelow(list.scrollTop + list.clientHeight < list.scrollHeight - 2);
  }, []);

  return (
    <Popover active={active} open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="node-chip node-chip-model" title={label} aria-label="选择生成模型">
          {label} <ChevronDown size={12} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="node-pop-card" align="start" sideOffset={8}>
        <p className="eyebrow">模型</p>
        <div className={moreBelow ? "node-pop-scroll-frame has-more" : "node-pop-scroll-frame"}>
          <div className="node-pop-scroll" ref={measure} onScroll={event => measure(event.currentTarget)}>
            {options.map(option => (
              <button key={option.value} type="button" disabled={option.disabled} className={`${value === option.value ? "node-pop-item active" : "node-pop-item"} disabled:opacity-40 disabled:cursor-not-allowed`}
                onClick={() => { onSelect(option.value); setOpen(false); }}>{option.label}</button>
            ))}
          </div>
          {moreBelow ? <span className="node-pop-more" aria-hidden="true">下滑查看更多 <ChevronDown size={11} /></span> : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
