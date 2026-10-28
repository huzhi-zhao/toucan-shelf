import { ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { type UserSetting_MeItem, UserSetting_MeItem_Style } from "@/types/proto/api/v1/user_service_pb";

/**
 * The card a block of "Me" items sits in, like a grouped list in iOS Settings or WeChat: one rounded card per
 * block, its rows split by hairlines.
 */
export function MeCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-4 overflow-hidden rounded-3xl bg-white dark:bg-[#1c1c1e]", className)}>{children}</div>;
}

// Soft tile backgrounds, one picked per item from its id so a tile keeps its color across edits and reorders.
const TILE_COLORS = [
  "bg-blue-100 dark:bg-blue-400/20",
  "bg-red-100 dark:bg-red-400/20",
  "bg-amber-100 dark:bg-amber-400/20",
  "bg-green-100 dark:bg-green-400/20",
  "bg-violet-100 dark:bg-violet-400/20",
  "bg-cyan-100 dark:bg-cyan-400/20",
];
const tileColor = (id: string) => TILE_COLORS[[...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % TILE_COLORS.length];

/** The grid of tile items at the top of the "Me" page: four to a row, in one card. */
export function MeGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <MeCard className={cn("grid grid-cols-4 gap-y-3.5 px-2 pt-4 pb-3", className)}>{children}</MeCard>;
}

/** A tile item in the grid: its icon on a rounded square, its title under it. The note is not shown. */
export function MeTile({ item, onOpen }: { item: UserSetting_MeItem; onOpen?: () => void }) {
  const content = (
    <>
      <span className={cn("flex h-[54px] w-[54px] items-center justify-center rounded-[14px] text-[28px]", tileColor(item.id))}>
        {item.icon}
      </span>
      <span className="w-full truncate px-1 text-center text-[12px] text-black/70 dark:text-white/70">{item.title}</span>
    </>
  );
  const className = "flex min-w-0 flex-col items-center gap-1.5";
  return onOpen ? (
    <button type="button" onClick={onOpen} className={cn(className, "active:opacity-50")}>
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}

/**
 * One custom item on the "Me" page, a row in its block's card (requirement phase 3 §5). Multi-line puts the
 * note under the title and lets it wrap; single-line keeps the note on the title's row and truncates it. The
 * icon column has a fixed width, so titles line up down the card whether or not an item has an icon.
 */
export default function MeItemStrip({
  item,
  onOpen,
  chevron = Boolean(onOpen),
}: {
  item: UserSetting_MeItem;
  onOpen?: () => void;
  /** Whether to show the "opens something" chevron; by default, when the row can be tapped. */
  chevron?: boolean;
}) {
  const single = item.style === UserSetting_MeItem_Style.SINGLE_LINE;
  const content = (
    <>
      <span className={cn("w-7 shrink-0 text-center text-[22px] leading-7", !single && "self-start")}>{item.icon}</span>
      {single ? (
        <span className="flex min-w-0 flex-1 items-baseline gap-3">
          <span className="shrink-0 text-[17px]">{item.title}</span>
          <span className="min-w-0 flex-1 truncate text-right text-[15px] text-black/45 dark:text-white/45">{item.note}</span>
        </span>
      ) : (
        <span className="min-w-0 flex-1 py-0.5">
          <span className="block text-[17px] font-medium leading-6">{item.title}</span>
          {item.note && (
            <span className="mt-0.5 block whitespace-pre-wrap break-words text-[15px] leading-snug text-black/55 dark:text-white/55">
              {item.note}
            </span>
          )}
        </span>
      )}
      {chevron && <ChevronRightIcon className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" />}
    </>
  );
  const className = cn(
    "relative flex w-full items-center gap-3 px-4 py-3 text-left",
    // Hairline under every row but the last, starting where the text does (16px + 28px icon + 12px gap).
    "after:absolute after:bottom-0 after:left-14 after:right-0 after:h-px after:bg-black/10 dark:after:bg-white/10 last:after:hidden",
  );

  return onOpen ? (
    <button type="button" onClick={onOpen} className={cn(className, "active:bg-black/5 dark:active:bg-white/10")}>
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}
