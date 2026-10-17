import { MonitorIcon } from "lucide-react";
import { COPY } from "../copy";

interface Props {
  title: string;
  onCopyDesktopLink: () => void;
}

/** Shown in place of content the phone does not render (requirement §7): says what it is and where to read it. */
export default function BlockPlaceholderCard({ title, onCopyDesktopLink }: Props) {
  return (
    <div className="my-4 rounded-2xl border border-black/10 dark:border-white/15 bg-black/[0.03] dark:bg-white/[0.06] p-4 flex gap-3 items-start not-prose">
      <MonitorIcon className="w-5 h-5 shrink-0 text-black/45 dark:text-white/50 mt-0.5" />
      <div className="flex-1 text-[15px] leading-snug">
        <div className="font-semibold">{title}</div>
        <div className="mt-1 text-black/55 dark:text-white/55">{COPY.reader.unsupportedBody}</div>
        <button type="button" onClick={onCopyDesktopLink} className="mt-2 text-primary active:opacity-50">
          {COPY.reader.copyDesktopLink}
        </button>
      </div>
    </div>
  );
}
