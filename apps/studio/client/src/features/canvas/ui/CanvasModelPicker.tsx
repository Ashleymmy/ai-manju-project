import { ChevronDown } from "lucide-react";
import { useState } from "react";

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

  return (
    <Popover active={active} open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="node-chip node-chip-model" title={label} aria-label="选择生成模型">
          {label} <ChevronDown size={12} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="node-pop-card" align="start" sideOffset={8}>
        <p className="eyebrow">模型</p>
        <div className="node-pop-scroll">
          {options.map(option => (
            <button key={option.value} type="button" disabled={option.disabled} className={`${value === option.value ? "node-pop-item active" : "node-pop-item"} disabled:opacity-40 disabled:cursor-not-allowed`}
              onClick={() => { onSelect(option.value); setOpen(false); }}>{option.label}</button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
