import type { Workspace } from "@/types/proto/api/v1/workspace_service_pb";

// Same fallback idea as the web shelf: a workspace without a cover colour still
// gets a stable one, derived from its name so it never changes between visits.
const FALLBACK_COLORS = ["#2f6fdb", "#7a4fd6", "#1f8a4c", "#b8336a", "#c78a14", "#0f7b8a", "#c2512d"];

export function coverColorOf(workspace: Pick<Workspace, "name" | "coverColor">): string {
  if (workspace.coverColor) return workspace.coverColor;
  let hash = 0;
  for (const ch of workspace.name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length];
}

interface Props {
  workspace: Workspace;
  onClick: () => void;
}

/**
 * A knowledge base drawn as a hardcover book: coloured cover with a bound spine
 * on the left, page edges showing on the right, the title near the top and the
 * cover image as a square emblem in the middle (about half the cover's
 * width) rather than a full-bleed picture.
 */
export default function WorkspaceCover({ workspace, onClick }: Props) {
  const color = coverColorOf(workspace);
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative block w-full aspect-[3/4] text-left active:scale-[0.97] transition-transform duration-150 [filter:drop-shadow(0_6px_10px_rgb(0_0_0/0.18))_drop-shadow(0_1px_2px_rgb(0_0_0/0.2))]"
    >
      {/* Page block peeking out on the right and bottom, behind the cover. */}
      <div
        className="absolute left-2 right-0 top-1.5 bottom-0 rounded-r-[10px] rounded-bl-[3px] border border-black/10"
        style={{ background: "repeating-linear-gradient(90deg, #fbf8f1 0 2px, #e8e2d4 2px 3px)" }}
      />

      {/* The cover itself. */}
      <div
        className="absolute left-0 top-0 right-1.5 bottom-1.5 overflow-hidden rounded-l-[4px] rounded-r-[10px] text-white"
        style={{ background: `linear-gradient(155deg, ${color}, color-mix(in oklab, ${color} 62%, black))` }}
      >
        {/* Spine: a darker binding strip, then the hinge crease. */}
        <div className="absolute inset-y-0 left-0 w-3.5 bg-gradient-to-r from-black/35 via-black/15 to-black/5" />
        <div className="absolute inset-y-0 left-3.5 w-px bg-white/20" />
        <div className="absolute inset-y-0 left-[15px] w-px bg-black/20" />
        {/* Soft light across the board, brightest at the top. */}
        <div className="absolute inset-0 bg-gradient-to-b from-white/12 via-transparent to-black/10" />

        <div className="relative h-full flex flex-col pl-6 pr-3 pt-3.5 pb-4">
          <div className="text-[17px] font-bold leading-snug line-clamp-2 break-words [text-shadow:0_1px_2px_rgb(0_0_0/0.35)]">
            {workspace.title}
          </div>
          <div className="flex-1 flex items-center justify-center min-h-0">
            {/* Two thirds of the padded content box is about half the cover's width. */}
            {workspace.coverImage && (
              <img
                src={workspace.coverImage}
                alt=""
                className="w-2/3 aspect-square object-cover rounded-xl ring-1 ring-black/10 shadow-[0_2px_6px_rgb(0_0_0/0.25)]"
              />
            )}
          </div>
          {/* A thin foil rule near the foot, like a hardcover's stamped band. */}
          <div className="h-px bg-white/30 mx-1" />
        </div>
      </div>
    </button>
  );
}
