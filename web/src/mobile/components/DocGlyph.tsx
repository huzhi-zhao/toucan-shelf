import { FileCode2Icon, FileTextIcon, LayoutGridIcon, type LucideIcon } from "lucide-react";
import DocIcon from "@/components/DocIcon";

// The tree reports doc_type as a string ("MARKDOWN", "HTML", "PDF", "VIEW").
const DEFAULT_ICONS: Record<string, LucideIcon> = { HTML: FileCode2Icon, VIEW: LayoutGridIcon };

interface Props {
  icon?: string;
  docType?: string;
  size?: number;
}

/** A document's emoji, or its type's default glyph when it has none. */
export default function DocGlyph({ icon, docType = "", size = 24 }: Props) {
  const Default = DEFAULT_ICONS[docType] ?? FileTextIcon;
  return (
    <DocIcon icon={icon} size={size}>
      <Default className="text-black/40 dark:text-white/45" width={size} height={size} strokeWidth={1.6} />
    </DocIcon>
  );
}
