import { Link, NavbarBackLink } from "konsta/react";
import { LibraryBigIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { COPY } from "../copy";
import { useBackToShelf } from "../lib/nav";
import { MOBILE_ROUTES } from "../routes";

interface Props {
  /** Where back goes; undefined while that page's title is loading. */
  text?: string;
  onBack: () => void;
  /** Adds the shelf button; leave it off where back already returns to the shelf. */
  shelf?: boolean;
}

/**
 * The navbar's left capsule inside a knowledge base: back one level, and beside it a button straight to the
 * shelf, the two sharing one glass capsule. The row fills the capsule's height so the shelf button is a
 * 44pt square like Konsta's own icon links.
 */
export default function BackCapsule({ text, onBack, shelf = true }: Props) {
  const toShelf = useBackToShelf(MOBILE_ROUTES.SHELF);
  return (
    // The back link pads 16px on each side; with the shelf button after it, its right padding shrinks so the
    // two read as one group, and the row adds 4px so the capsule's ends match (16px either way).
    <div className={cn("flex h-full items-center", shelf && "pr-1")}>
      <NavbarBackLink text={text} showText onClick={onBack} className={shelf ? "!pr-2" : undefined} />
      {shelf && (
        <Link iconOnly onClick={toShelf} aria-label={COPY.nav.toShelf}>
          <LibraryBigIcon className="h-[22px] w-[22px]" />
        </Link>
      )}
    </div>
  );
}
