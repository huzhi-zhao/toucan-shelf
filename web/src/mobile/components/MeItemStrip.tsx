import { ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { type UserSetting_MeItem, UserSetting_MeItem_Style } from "@/types/proto/api/v1/user_service_pb";

/**
 * One custom item on the "Me" page, as a strip of its own (requirement phase 3 §5). Multi-line puts the note
 * under the title and lets it wrap; single-line keeps the note on the title's row and truncates it.
 */
export default function MeItemStrip({ item, onOpen }: { item: UserSetting_MeItem; onOpen?: () => void }) {
  const single = item.style === UserSetting_MeItem_Style.SINGLE_LINE;
  const content = (
    <>
      {item.icon && <span className={cn("shrink-0 leading-none", single ? "text-[22px]" : "text-[28px]")}>{item.icon}</span>}
      {single ? (
        <span className="flex min-w-0 flex-1 items-baseline gap-3">
          <span className="shrink-0 text-[17px] font-medium">{item.title}</span>
          <span className="min-w-0 flex-1 truncate text-right text-[15px] text-black/45 dark:text-white/45">{item.note}</span>
        </span>
      ) : (
        <span className="min-w-0 flex-1">
          <span className="block text-[17px] font-semibold">{item.title}</span>
          {item.note && (
            <span className="mt-0.5 block whitespace-pre-wrap break-words text-[15px] leading-snug text-black/55 dark:text-white/55">
              {item.note}
            </span>
          )}
        </span>
      )}
      {onOpen && <ChevronRightIcon className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" />}
    </>
  );
  const className = cn("flex w-full items-center gap-3 rounded-2xl bg-white px-4 text-left dark:bg-[#1c1c1e]", single ? "py-3" : "py-3.5");

  return onOpen ? (
    <button type="button" onClick={onOpen} className={cn(className, "active:opacity-60")}>
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}
