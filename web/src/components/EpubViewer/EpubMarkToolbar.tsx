import { MessageSquarePlusIcon, UnderlineIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslate } from "@/utils/i18n";
import { EPUB_MARK_COLORS } from "./epubMarks";

interface Props {
  /** Position (in reading-container coordinates) to anchor the toolbar over. */
  x: number;
  y: number;
  onColor: (colorKey: string) => void;
  onUnderline: () => void;
  onNote: () => void;
}

// The floating mark toolbar, shown both when finishing a text selection (to create a mark)
// and when clicking an existing mark (to restyle it): a note button, six highlight colors,
// and an underline toggle. onMouseDown-preventDefault keeps the text selection from
// collapsing before the click lands.
export const EpubMarkToolbar = ({ x, y, onColor, onUnderline, onNote }: Props) => {
  const t = useTranslate();
  return (
    <div
      className="absolute z-20 flex -translate-x-1/2 -translate-y-full items-center gap-1 rounded-lg border border-border bg-popover p-1 shadow-md"
      style={{ left: x, top: y - 6 }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <Button variant="ghost" size="icon" className="h-7 w-7" title={t("epub.add-annotation")} onClick={onNote}>
        <MessageSquarePlusIcon className="h-3.5 w-3.5" />
      </Button>
      <div className="mx-0.5 h-5 w-px bg-border" />
      {EPUB_MARK_COLORS.map((c) => (
        <button
          key={c.key}
          type="button"
          title={t("epub.highlight")}
          aria-label={c.key}
          className="h-5 w-5 rounded-full border border-black/10 transition-transform hover:scale-110"
          style={{ backgroundColor: c.color }}
          onClick={() => onColor(c.key)}
        />
      ))}
      <div className="mx-0.5 h-5 w-px bg-border" />
      <Button variant="ghost" size="icon" className="h-7 w-7" title={t("epub.underline")} onClick={onUnderline}>
        <UnderlineIcon className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
};
