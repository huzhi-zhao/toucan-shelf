import { useDelayedFlag } from "@/hooks/useDelayedFlag";
import { COPY } from "../copy";

/**
 * A full-screen spinner while the app starts or a page's code loads, in the list background. It appears only after
 * `delay` ms, so a fast load does not flash it. mobile.html draws the same spinner before any script runs.
 */
export default function LoadingScreen({ delay = 200 }: { delay?: number }) {
  const visible = useDelayedFlag(true, delay);
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#f2f2f7] dark:bg-black" role="status" aria-label={COPY.loading}>
      {(visible || delay === 0) && (
        <span className="h-7 w-7 animate-spin rounded-full border-[2.5px] border-black/10 border-t-black/45 dark:border-white/15 dark:border-t-white/60" />
      )}
    </div>
  );
}
