import { useMemo } from "react";
import { useTranslate } from "@/utils/i18n";
import { GridCard } from "./grid/GridCard";
import { gridHidesCovers } from "./grid/layout";
import { parseGridBlock } from "./grid/parseGridBlock";
import { extractCodeContent } from "./utils";

interface GridBlockProps {
  children?: React.ReactNode;
  className?: string;
}

export const GridBlock = ({ children }: GridBlockProps) => {
  const t = useTranslate();
  const codeContent = extractCodeContent(children);
  const data = useMemo(() => parseGridBlock(codeContent), [codeContent]);
  const { cards, style, columns } = data;

  if (cards.length === 0) {
    return <div className="text-sm text-muted-foreground px-1 py-2">{t("markdown.grid-block.empty")}</div>;
  }

  const longbar = style === "longbar";
  const effectiveNocover = gridHidesCovers(data);

  // A fixed `columns: N` wins; otherwise cards auto-fill by width (longbar uses a
  // narrower min so strips still pack several per row instead of stacking).
  const gap = longbar ? "gap-2" : "gap-4";
  const gridStyle = columns
    ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }
    : { gridTemplateColumns: `repeat(auto-fill, minmax(${longbar ? "200px" : "260px"}, 1fr))` };

  return (
    <div className={`not-prose grid ${gap}`} style={gridStyle}>
      {cards.map((card, index) => (
        <GridCard key={index} card={card} nocover={effectiveNocover} longbar={longbar} />
      ))}
    </div>
  );
};
