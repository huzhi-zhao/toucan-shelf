import { StarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { COPY } from "../../copy";

/** A check-in's 1-to-5 rating as stars. Tapping a star rates that; tapping the current one clears it (0). */
export default function RatingStars({ value, onChange }: { value: number; onChange?: (value: number) => void }) {
  return (
    <span className="inline-flex items-center">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          aria-label={COPY.checkIn.rate(n)}
          disabled={!onChange}
          onClick={() => onChange?.(n === value ? 0 : n)}
          className="p-0.5 active:opacity-50 disabled:active:opacity-100"
        >
          <StarIcon className={cn("w-5 h-5", n <= value ? "fill-amber-400 text-amber-400" : "text-black/20 dark:text-white/25")} />
        </button>
      ))}
    </span>
  );
}
