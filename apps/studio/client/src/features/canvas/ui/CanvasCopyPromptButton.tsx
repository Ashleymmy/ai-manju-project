import { Check, Copy, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { copyTextToClipboard } from "@/shared/lib/clipboard";

export function CanvasCopyPromptButton({ text }: { text: string }) {
  const [pending, setPending] = useState(false);
  const copying = useRef(false);
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const copied = copiedText === text;
  return <button
    type="button"
    className="icon-button subtle"
    title={copied ? "提示词已复制，点击再次复制" : "一键复制提示词内容"}
    aria-label="复制提示词"
    aria-busy={pending}
    aria-disabled={pending}
    onClick={async () => {
      if (copying.current) return;
      copying.current = true;
      setPending(true);
      setCopiedText(null);
      try {
        const result = await copyTextToClipboard(text);
        if (result === "copied") {
          setCopiedText(text);
          toast.success("提示词已复制");
        } else if (result === "empty") {
          toast.info("当前节点没有提示词");
        } else {
          toast.error("复制失败，请选中提示词后按 Ctrl+C 复制");
        }
      } catch {
        toast.error("复制失败，请选中提示词后按 Ctrl+C 复制");
      } finally {
        copying.current = false;
        setPending(false);
      }
    }}
  >{pending ? <Loader2 className="spin" size={15} /> : copied ? <Check size={15} /> : <Copy size={15} />}</button>;
}
