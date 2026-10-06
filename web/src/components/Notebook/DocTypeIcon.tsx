import { CodeIcon, FileIcon, FileTextIcon, GlobeIcon, LayoutGridIcon } from "lucide-react";
import DocIcon from "@/components/DocIcon";
import { cn } from "@/lib/utils";
import { isLayoutDocTypeName } from "@/utils/docType";

interface Props {
  /** The doc type's enum name ("MARKDOWN", "HTML", ...), as the workspace tree reports it. */
  docType: string | undefined;
  /** The document's emoji icon; when set it replaces the doc-type default. */
  icon?: string;
  /** Side length in px; defaults to the tree's 16. */
  size?: number;
  className?: string;
}

/** A document's icon in the notebook: its own emoji, else the default for its doc type. */
const DocTypeIcon = ({ docType, icon, size = 16, className }: Props) => {
  const iconClass = cn("shrink-0 text-muted-foreground", className);
  return (
    <DocIcon icon={icon} size={size}>
      {docType === "HTML" ? (
        <CodeIcon size={size} className={iconClass} />
      ) : docType === "PDF" ? (
        <FileIcon size={size} className={iconClass} />
      ) : docType === "BLOGVIEW" ? (
        // A site home page reads as a layout too, but it is the one document
        // in the tree that faces outward — same icon as the outward-facing
        // blocks it is made of, so it is not mistaken for a library view.
        <GlobeIcon size={size} className={iconClass} />
      ) : isLayoutDocTypeName(docType) ? (
        <LayoutGridIcon size={size} className={iconClass} />
      ) : (
        <FileTextIcon size={size} className={iconClass} />
      )}
    </DocIcon>
  );
};

export default DocTypeIcon;
