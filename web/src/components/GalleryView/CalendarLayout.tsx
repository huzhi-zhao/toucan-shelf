import { create } from "@bufbuild/protobuf";
import dayjs from "dayjs";
import { CalendarDaysIcon, ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import { useTodayDate, useWeekdayLabels } from "@/components/ActivityCalendar/hooks";
import { useCalendarMatrix } from "@/components/ActivityCalendar/useCalendar";
import { MARK_EXCLUDE_ATTR } from "@/components/DocComments/textAnchor";
import PromptDialog from "@/components/Notebook/PromptDialog";
import { Button } from "@/components/ui/button";
import { useInstance } from "@/contexts/InstanceContext";
import { useCreateMemo, useMemos } from "@/hooks/useMemoQueries";
import { cn } from "@/lib/utils";
import { State } from "@/types/proto/api/v1/common_pb";
import { type Memo, MemoSchema } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import { docCalendarDate, newCalendarDoc } from "./calendar";
import { fieldValue, matchesScope, propertyMap } from "./fields";
import type { CalendarLayoutBlock } from "./types";

interface Props {
  block: CalendarLayoutBlock;
  memo: Memo;
  openDoc: (memoName: string) => void;
}

const MAX_TILE_DOCS = 3;

// A compact card for a document on a calendar tile / in the day panel: label
// only, click navigates to the document.
const DocChip = ({ label, onOpen, className }: { label: string; onOpen: () => void; className?: string }) => (
  <button
    type="button"
    onClick={(e) => {
      e.stopPropagation();
      onOpen();
    }}
    className={cn(
      "w-full truncate rounded bg-card px-1.5 py-0.5 text-left text-[11px] leading-tight text-foreground border border-border/60 hover:border-accent hover:bg-accent/40 transition-colors",
      className,
    )}
    title={label}
  >
    {label}
  </button>
);

// Renders one calendar layout block: a month grid on the left (top on mobile)
// whose tiles carry the documents scanned by the block's scope, and a panel for
// the selected day on the right (bottom on mobile) with an add-document button.
const CalendarLayout = ({ block, memo, openDoc }: Props) => {
  const t = useTranslate();
  const { generalSetting } = useInstance();
  const today = useTodayDate();
  const weekDays = useWeekdayLabels();
  const createMemo = useCreateMemo();

  const { data, isLoading } = useMemos({
    pageSize: 1000,
    state: State.NORMAL,
    filter: `workspace == ${JSON.stringify(memo.workspace)}`,
  });

  const [month, setMonth] = useState(() => dayjs(today).format("YYYY-MM"));
  const [selectedDate, setSelectedDate] = useState(today);
  const [addOpen, setAddOpen] = useState(false);

  // Bucket every in-scope document by its resolved calendar date. Rebuilt from a
  // live query on each render — nothing is cached or stored.
  const docsByDate = useMemo(() => {
    const ctx = { viewFolderPath: memo.folderPath };
    const map = new Map<string, Memo[]>();
    for (const doc of data?.memos ?? []) {
      if (doc.name === memo.name) continue;
      const props = propertyMap(doc.content);
      if (!matchesScope(doc, props, block.scope, ctx)) continue;
      const date = docCalendarDate(doc, props, block);
      if (!date) continue;
      const list = map.get(date);
      if (list) list.push(doc);
      else map.set(date, [doc]);
    }
    return map;
  }, [data, block, memo.name, memo.folderPath]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const [date, list] of docsByDate) c[date] = list.length;
    return c;
  }, [docsByDate]);

  const { weeks, weekDays: rotatedWeekDays } = useCalendarMatrix({
    month,
    data: counts,
    weekDays,
    weekStartDayOffset: generalSetting.weekStartDayOffset,
    today,
    selectedDate,
  });
  const days = useMemo(() => weeks.flatMap((w) => w.days), [weeks]);

  const monthLabel = useMemo(() => dayjs(month).format("MMM YYYY"), [month]);
  const isCurrentMonth = month === dayjs(today).format("YYYY-MM");
  const shiftMonth = (delta: number) => setMonth(dayjs(`${month}-01`).add(delta, "month").format("YYYY-MM"));

  const labelOf = (doc: Memo) => fieldValue(doc, propertyMap(doc.content), block.cardField) || doc.title || doc.name;

  const selectedDocs = docsByDate.get(selectedDate) ?? [];

  const handleCreate = async (title: string) => {
    const { folderPath, content } = newCalendarDoc(block, memo.folderPath, selectedDate, title);
    try {
      const created = await createMemo.mutateAsync(create(MemoSchema, { workspace: memo.workspace, folderPath, title, content }));
      openDoc(created.name);
    } catch {
      toast.error(t("gallery.calendar-add-failed"));
    }
  };

  return (
    <div {...{ [MARK_EXCLUDE_ATTR]: "" }} className="w-full flex flex-col md:flex-row gap-4">
      {/* Month grid */}
      <div className="md:flex-[7] md:min-w-0 flex flex-col gap-1.5">
        <div className="flex items-center justify-between px-1">
          <span className="text-sm font-medium text-foreground">{monthLabel}</span>
          <div className="inline-flex items-center gap-0.5 rounded-lg border border-border/30 bg-muted/10 p-0.5">
            <Button variant="ghost" size="sm" onClick={() => shiftMonth(-1)} className="h-6 w-6 p-0" aria-label="Previous month">
              <ChevronLeftIcon className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMonth(dayjs(today).format("YYYY-MM"))}
              disabled={isCurrentMonth}
              className="h-6 px-2 text-[10px] font-medium uppercase tracking-wider"
            >
              {t("common.today")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => shiftMonth(1)} className="h-6 w-6 p-0" aria-label="Next month">
              <ChevronRightIcon className="w-4 h-4" />
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {rotatedWeekDays.map((label, i) => (
            <div key={i} className="flex h-4 items-center justify-center text-[10px] uppercase tracking-wide text-muted-foreground/60">
              {label}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {days.map((day) => {
            if (!day.isCurrentMonth) return <div key={day.date} className="min-h-16 md:min-h-20" aria-hidden="true" />;
            const docs = docsByDate.get(day.date) ?? [];
            return (
              <button
                key={day.date}
                type="button"
                onClick={() => setSelectedDate(day.date)}
                className={cn(
                  "flex min-h-16 flex-col gap-0.5 overflow-hidden rounded-md border border-border/10 bg-muted/10 p-1 text-left transition-colors hover:bg-muted/40 md:min-h-20",
                  day.isToday && "ring-1 ring-inset ring-primary",
                  day.isSelected && "ring-2 ring-inset ring-primary bg-accent/30",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground">{day.label}</span>
                  {/* Mobile: just the doc count. */}
                  {docs.length > 0 && (
                    <span className="rounded-full bg-primary/15 px-1 text-[10px] font-medium text-primary md:hidden">{docs.length}</span>
                  )}
                </div>
                {/* Desktop: up to 3 doc cards, then an overflow hint. */}
                <div className="hidden flex-col gap-0.5 md:flex">
                  {docs.slice(0, MAX_TILE_DOCS).map((doc) => (
                    <DocChip key={doc.name} label={labelOf(doc)} onOpen={() => openDoc(doc.name)} />
                  ))}
                  {docs.length > MAX_TILE_DOCS && (
                    <span className="px-1 text-[10px] text-muted-foreground">
                      {t("gallery.calendar-more", { count: docs.length - MAX_TILE_DOCS })}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected-day panel */}
      <div className="md:flex-[3] min-w-0 flex flex-col gap-3 md:border-l md:border-border md:pl-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <CalendarDaysIcon className="w-4 h-4 text-primary" />
            {dayjs(selectedDate).format("MMM D, YYYY")}
          </div>
          <Button size="sm" variant="secondary" onClick={() => setAddOpen(true)}>
            <PlusIcon className="w-4 h-4 mr-1" />
            {t("gallery.calendar-add")}
          </Button>
        </div>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">{t("gallery.loading")}</div>
        ) : selectedDocs.length === 0 ? (
          <div className="text-sm text-muted-foreground">{t("gallery.calendar-empty-day")}</div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {selectedDocs.map((doc) => (
              <DocChip key={doc.name} label={labelOf(doc)} onOpen={() => openDoc(doc.name)} className="px-2 py-1.5 text-sm" />
            ))}
          </div>
        )}
      </div>

      <PromptDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        title={t("gallery.calendar-add")}
        placeholder={t("notebook.document-title-placeholder")}
        onConfirm={handleCreate}
      />
    </div>
  );
};

export default CalendarLayout;
