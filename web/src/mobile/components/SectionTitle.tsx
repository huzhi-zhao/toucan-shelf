import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  children: ReactNode;
  /** Something on the right of the title row, e.g. a view switch or a "clear" button. */
  action?: ReactNode;
  className?: string;
}

/**
 * A section heading with fixed spacing. Konsta's BlockTitle pulls itself into
 * the following list with a negative margin (it expects the list's own top
 * margin to absorb it); next to anything else it overlaps the content, so the
 * mobile pages use this instead and give lists no outer margin.
 */
export default function SectionTitle({ children, action, className }: Props) {
  return (
    <div className={cn("flex items-center justify-between gap-3 px-4 mt-7 mb-2.5 min-h-8", className)}>
      <h2 className="text-[17px] font-semibold">{children}</h2>
      {action}
    </div>
  );
}
