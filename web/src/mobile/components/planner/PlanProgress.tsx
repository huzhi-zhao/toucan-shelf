import { COPY } from "../../copy";

/** "完成 4/6" next to a plan's title: how many planned exercises the check-in recorded. */
export default function PlanProgress({ inRecord }: { inRecord: boolean[] }) {
  if (inRecord.length === 0) return null;
  return (
    <span className="text-[13px] font-normal text-black/45 dark:text-white/45">
      {COPY.checkIn.planProgress(inRecord.filter(Boolean).length, inRecord.length)}
    </span>
  );
}
