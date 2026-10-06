import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  /** The document's emoji icon (`memo.icon`); empty or undefined falls back to `children`. */
  icon?: string;
  /** Side length in px of the box the emoji fills — match the default icon it replaces. */
  size?: number;
  className?: string;
  /** The default icon, shown when the document has no emoji of its own. */
  children: ReactNode;
}

/**
 * A document's icon wherever the app shows a document by its default icon: its own emoji when it
 * has one, otherwise the default passed as `children`, unchanged.
 */
const DocIcon = ({ icon, size = 16, className, children }: Props) => {
  if (!icon) return <>{children}</>;
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center leading-none select-none", className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.9) }}
    >
      {icon}
    </span>
  );
};

export default DocIcon;
