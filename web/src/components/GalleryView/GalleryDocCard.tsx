import { LayoutGridIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { parseGalleryViewConfig } from "./types";

interface Props {
  title: string;
  memoName: string;
  content: string;
}

// Compact card for VIEW documents in memo lists: shows the view's title and
// intro snippet and links to the document, instead of dumping the config JSON.
export const GalleryDocCard = ({ title, memoName, content }: Props) => {
  const config = parseGalleryViewConfig(content);
  const snippet = config?.description?.split("\n")[0];
  return (
    <Link
      to={`/${memoName}`}
      className="w-full flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 hover:bg-accent/60 transition-colors"
    >
      <LayoutGridIcon className="w-5 h-5 shrink-0 text-primary/80" />
      <div className="min-w-0">
        <div className="text-sm font-medium truncate">{title || memoName}</div>
        {snippet && <div className="text-xs text-muted-foreground truncate">{snippet}</div>}
      </div>
    </Link>
  );
};
