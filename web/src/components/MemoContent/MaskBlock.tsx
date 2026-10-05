import { EyeOffIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";
import { maskBlockText } from "@/utils/mask-block";
import { blockCopyProps, SegmentedSecret } from "./SecretCanvas";
import { extractCodeContent } from "./utils";

interface MaskBlockProps {
  children?: ReactNode;
  className?: string;
}

/**
 * Renders a ```mask fence: the text never becomes a DOM text node, and each
 * four-character segment is drawn only while it is held down.
 */
export const MaskBlock = ({ children, className }: MaskBlockProps) => {
  const t = useTranslate();
  const text = maskBlockText(extractCodeContent(children));
  return (
    <div className={cn("my-2 rounded-lg border border-border bg-muted/30 px-3 py-2 select-none", className)} {...blockCopyProps}>
      <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        <EyeOffIcon className="w-3.5 h-3.5" />
        {t("mask-block.hold-to-reveal")}
      </div>
      {text === "" ? (
        <p className="text-sm text-muted-foreground">{t("mask-block.empty")}</p>
      ) : (
        <SegmentedSecret text={text} segmentLabel={(n) => t("mask-block.segment", { n })} />
      )}
    </div>
  );
};
