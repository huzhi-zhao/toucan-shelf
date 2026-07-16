import { useMemo } from "react";
import { useTranslate } from "@/utils/i18n";
import { GridCard } from "./grid/GridCard";
import { parseGridBlock } from "./grid/parseGridBlock";
import { extractCodeContent } from "./utils";

interface GridBlockProps {
  children?: React.ReactNode;
  className?: string;
}

export const GridBlock = ({ children }: GridBlockProps) => {
  const t = useTranslate();
  const codeContent = extractCodeContent(children);
  const cards = useMemo(() => parseGridBlock(codeContent), [codeContent]);

  if (cards.length === 0) {
    return <div className="text-sm text-muted-foreground px-1 py-2">{t("markdown.grid-block.empty")}</div>;
  }

  return (
    <div className="not-prose grid gap-4 grid-cols-[repeat(auto-fill,minmax(260px,1fr))]">
      {cards.map((card, index) => (
        <GridCard key={index} card={card} />
      ))}
    </div>
  );
};
