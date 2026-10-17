import { cn } from "@/lib/utils";
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

/** A knowledge base drawn as a book cover: colour (or image) with a spine on the left. */
export default function WorkspaceCover({ workspace, onClick }: Props) {
  const color = coverColorOf(workspace);
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative aspect-[4/5] rounded-2xl overflow-hidden text-left text-white shadow-sm active:scale-[0.97] transition-transform duration-150"
      style={{ background: `linear-gradient(160deg, ${color}, color-mix(in oklab, ${color} 60%, black))` }}
    >
      {workspace.coverImage && <img src={workspace.coverImage} alt="" className="absolute inset-0 w-full h-full object-cover opacity-60" />}
      <div className="absolute left-0 top-0 bottom-0 w-2.5 bg-black/15" />
      <div
        className={cn("absolute inset-0 p-4 pl-6 flex flex-col", workspace.coverImage && "bg-gradient-to-b from-black/35 to-transparent")}
      >
        <div className="text-[19px] font-bold leading-tight line-clamp-3">{workspace.title}</div>
      </div>
    </button>
  );
}
