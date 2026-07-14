import { cn } from "@/lib/utils";
import type { HeadingItem } from "@/utils/markdown-manipulation";

interface MemoOutlineProps {
  headings: HeadingItem[];
  /** Overrides the default DOM-anchor scroll (e.g. to scroll the editor instead, while editing). */
  onSelect?: (heading: HeadingItem) => void;
}

const levelIndent: Record<number, string> = {
  1: "ml-0",
  2: "ml-3",
  3: "ml-6",
  4: "ml-8",
};

/** Outline navigation for memo headings (h1–h4). */
const MemoOutline = ({ headings, onSelect }: MemoOutlineProps) => {
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>, heading: HeadingItem) => {
    e.preventDefault();
    if (onSelect) {
      onSelect(heading);
      return;
    }
    const el = document.getElementById(heading.slug);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      window.history.replaceState(null, "", `#${heading.slug}`);
    }
  };

  return (
    <nav className="relative flex flex-col">
      {headings.map((heading, index) => (
        <a
          key={`${heading.slug}-${index}`}
          href={`#${heading.slug}`}
          onClick={(e) => handleClick(e, heading)}
          className={cn(
            "group relative block py-[5px] pr-1 text-[13px] leading-snug truncate",
            "text-muted-foreground/60 hover:text-foreground/90",
            "transition-colors duration-200 ease-out",
            levelIndent[heading.level],
            heading.level === 1 && "font-medium text-muted-foreground/80",
          )}
          title={heading.text}
        >
          <span className="relative">
            {heading.text}
            <span className="absolute -bottom-px left-0 h-px w-0 bg-foreground/30 transition-all duration-200 group-hover:w-full" />
          </span>
        </a>
      ))}
    </nav>
  );
};

export default MemoOutline;
