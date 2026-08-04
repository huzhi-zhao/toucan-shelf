import { cn } from "@/lib/utils";
import type { Workspace } from "@/types/proto/api/v1/workspace_service_pb";

// A small fixed palette to visually tell book spines apart, used only when the
// workspace has no cover color of its own. Deterministic on the book's position
// so a given shelf keeps looking the same between renders.
export const SPINE_COLORS = [
  "from-sky-700 to-sky-900 dark:from-sky-800 dark:to-sky-950",
  "from-rose-700 to-rose-900 dark:from-rose-800 dark:to-rose-950",
  "from-emerald-700 to-emerald-900 dark:from-emerald-800 dark:to-emerald-950",
  "from-amber-600 to-amber-800 dark:from-amber-700 dark:to-amber-900",
  "from-violet-700 to-violet-900 dark:from-violet-800 dark:to-violet-950",
  "from-teal-700 to-teal-900 dark:from-teal-800 dark:to-teal-950",
];

interface Props {
  workspace: Workspace;
  /** Position on the shelf; only picks the fallback gradient. */
  index?: number;
  /**
   * "shelf" is the clickable book on the bookshelf grid; "large" is the static,
   * scaled-up preview shown on the workspace detail page.
   */
  size?: "shelf" | "large";
  className?: string;
}

/**
 * The book rendering shared by the bookshelf grid and the workspace detail page.
 * Purely presentational — the shelf wraps it in a button, the detail page doesn't.
 */
const BookSpine = ({ workspace, index = 0, size = "shelf", className }: Props) => {
  const large = size === "large";
  return (
    <div
      className={cn(
        "relative flex drop-shadow-md",
        large ? "w-[11rem] h-[16.5rem]" : "w-full aspect-[2/3] sm:w-[7.2rem] sm:aspect-auto sm:h-[10.8rem]",
        className,
      )}
    >
      {/* Spine */}
      <div
        className="relative flex-1 min-w-0 flex flex-col justify-between rounded-t-[3px] rounded-b-[2px] border border-black/25 shadow-[inset_2px_0_0_rgba(255,255,255,0.12),inset_-2px_0_0_rgba(0,0,0,0.25)]"
        style={workspace.coverColor ? { backgroundColor: workspace.coverColor } : undefined}
      >
        <div
          className={cn(
            "absolute inset-0 rounded-t-[3px] rounded-b-[2px] bg-gradient-to-b",
            SPINE_COLORS[index % SPINE_COLORS.length],
            workspace.coverColor && "hidden",
          )}
        />
        {/* Spine ribbing (raised bands like a hardcover binding) */}
        <div className="absolute inset-x-1.5 top-3.5 h-[3px] rounded-full bg-black/20 shadow-[0_1px_0_rgba(255,255,255,0.15)]" />
        {/* Gold foil title bar */}
        <div className={cn("relative min-w-0 px-1.5 pb-1 text-center shrink-0", large ? "pt-6" : "pt-4.5")}>
          {/*
           * `break-all` matters as much as the clamp: a long unbroken title (a URL, or
           * CJK/latin text with no spaces) has no wrap opportunity, so without it the
           * text overflows the spine instead of being cut with an ellipsis.
           */}
          <span
            className={cn(
              "block text-amber-50/95 font-semibold tracking-wide line-clamp-1 break-all drop-shadow-[0_1px_1px_rgba(0,0,0,0.4)]",
              large ? "text-base" : "text-xs sm:text-sm",
            )}
            title={workspace.title}
          >
            {workspace.title}
          </span>
        </div>
        {/* Cover image */}
        <div className="relative flex-1 flex items-center justify-center px-2 min-h-0">
          <div className="w-[65%] aspect-square translate-x-[6%] rounded-[2px] overflow-hidden">
            {workspace.coverImage && <img src={workspace.coverImage} alt="" className="w-full h-full object-cover opacity-60" />}
          </div>
        </div>
        <div className="relative px-1 pb-0.5 text-center shrink-0">
          <div className="absolute inset-x-1.5 top-1.5 h-[3px] rounded-full bg-black/20 shadow-[0_1px_0_rgba(255,255,255,0.15)]" />
          <span className={cn("text-white/60", large ? "text-[10px]" : "text-[8px]")}>
            {workspace.createTime ? new Date(Number(workspace.createTime.seconds) * 1000).toLocaleDateString() : ""}
          </span>
        </div>
        {/* Sheen highlight */}
        <div className="pointer-events-none absolute inset-y-0 left-1 w-1.5 bg-white/25 rounded-full blur-[1px]" />
      </div>
      {/* Page edges (fanned pages peeking from behind the spine) */}
      <div
        className={cn(
          "shrink-0 self-stretch mt-[2px] mb-0 bg-gradient-to-b from-stone-50 to-stone-300 dark:from-stone-200 dark:to-stone-400 rounded-r-[2px] border-y border-r border-black/10 shadow-[inset_-1px_0_0_rgba(0,0,0,0.08)]",
          large ? "w-3" : "w-2",
        )}
      />
    </div>
  );
};

export default BookSpine;
