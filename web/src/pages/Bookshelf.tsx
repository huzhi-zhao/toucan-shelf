import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import PromptDialog from "@/components/Notebook/PromptDialog";
import useCurrentUser from "@/hooks/useCurrentUser";
import { useLastOpened } from "@/hooks/useLastOpened";
import { useCreateWorkspace, useWorkspaces } from "@/hooks/useWorkspaceQueries";
import { useTranslate } from "@/utils/i18n";

// A small fixed palette to visually tell book spines apart. Not user-configurable
// (cover color customization is explicitly out of scope for this pass) — just a
// deterministic pick based on the workspace's position on the shelf.
const SPINE_COLORS = [
  "from-sky-700 to-sky-900 dark:from-sky-800 dark:to-sky-950",
  "from-rose-700 to-rose-900 dark:from-rose-800 dark:to-rose-950",
  "from-emerald-700 to-emerald-900 dark:from-emerald-800 dark:to-emerald-950",
  "from-amber-600 to-amber-800 dark:from-amber-700 dark:to-amber-900",
  "from-violet-700 to-violet-900 dark:from-violet-800 dark:to-violet-950",
  "from-teal-700 to-teal-900 dark:from-teal-800 dark:to-teal-950",
];

const Bookshelf = () => {
  const t = useTranslate();
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const { data: workspaces = [] } = useWorkspaces();
  const createWorkspace = useCreateWorkspace();
  const { setLastOpened } = useLastOpened(currentUser?.name);
  const [createOpen, setCreateOpen] = useState(false);

  const openWorkspace = async (name: string) => {
    navigate("/", { state: { workspace: name } });
    setLastOpened(name, "");
  };

  return (
    <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-6">
      <h1 className="text-2xl font-medium mb-6">{t("bookshelf.title")}</h1>
      <div className="rounded-lg bg-gradient-to-b from-amber-950/5 to-amber-950/10 dark:from-black/20 dark:to-black/30 p-5 sm:p-8 pb-0">
        <div className="flex flex-wrap items-end gap-2 sm:gap-3 pb-3">
          {workspaces.map((workspace, index) => (
            <button
              key={workspace.name}
              onClick={() => openWorkspace(workspace.name)}
              className="group relative flex w-[5.66rem] sm:w-[6.36rem] h-32 sm:h-36 drop-shadow-md hover:-translate-y-2.5 hover:drop-shadow-xl transition-all duration-200 ease-out cursor-pointer"
            >
              {/* Spine */}
              <div
                className={`relative flex-1 flex flex-col justify-between bg-gradient-to-b ${SPINE_COLORS[index % SPINE_COLORS.length]} rounded-t-[3px] rounded-b-[2px] border border-black/25 shadow-[inset_2px_0_0_rgba(255,255,255,0.12),inset_-2px_0_0_rgba(0,0,0,0.25)]`}
              >
                {/* Spine ribbing (raised bands like a hardcover binding) */}
                <div className="absolute inset-x-1.5 top-3 h-[3px] rounded-full bg-black/20 shadow-[0_1px_0_rgba(255,255,255,0.15)]" />
                <div className="absolute inset-x-1.5 bottom-3 h-[3px] rounded-full bg-black/20 shadow-[0_1px_0_rgba(255,255,255,0.15)]" />
                {/* Gold foil title bar */}
                <div className="flex-1 flex items-center justify-center px-1.5 py-6 min-h-0">
                  <span className="text-amber-50/95 text-xs sm:text-sm font-semibold tracking-wide line-clamp-1 max-h-full drop-shadow-[0_1px_1px_rgba(0,0,0,0.4)]">
                    {workspace.title}
                  </span>
                </div>
                <div className="px-1 pb-2.5 text-center">
                  <span className="text-[10px] text-white/60">
                    {workspace.createTime ? new Date(Number(workspace.createTime.seconds) * 1000).toLocaleDateString() : ""}
                  </span>
                </div>
                {/* Sheen highlight */}
                <div className="pointer-events-none absolute inset-y-0 left-1 w-1.5 bg-white/25 rounded-full blur-[1px]" />
              </div>
              {/* Page edges (fanned pages peeking from behind the spine) */}
              <div className="w-2 shrink-0 self-stretch mt-[2px] mb-0 bg-gradient-to-b from-stone-50 to-stone-300 dark:from-stone-200 dark:to-stone-400 rounded-r-[2px] border-y border-r border-black/10 shadow-[inset_-1px_0_0_rgba(0,0,0,0.08)]" />
            </button>
          ))}

          <button
            onClick={() => setCreateOpen(true)}
            className="flex flex-col items-center justify-center gap-2 w-[5.66rem] sm:w-[6.36rem] h-32 sm:h-36 rounded-t-[3px] border-2 border-dashed border-muted-foreground/30 text-muted-foreground hover:text-foreground hover:border-muted-foreground/60 hover:bg-muted/20 transition-colors cursor-pointer"
          >
            <PlusIcon className="w-5 h-5" />
            <span className="text-[11px] text-center px-1">{t("bookshelf.new-workspace")}</span>
          </button>
        </div>

        {/* Shelf plank */}
        <div className="relative h-1.5 sm:h-2 rounded-[2px] bg-gradient-to-b from-amber-800 via-amber-900 to-amber-950 dark:from-zinc-700 dark:via-zinc-800 dark:to-zinc-900 shadow-[0_4px_8px_rgba(0,0,0,0.35)]">
          <div className="absolute inset-x-0 top-0 h-[2px] bg-white/10" />
        </div>
        <div className="h-4 sm:h-5" />
      </div>

      <PromptDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={t("bookshelf.new-workspace")}
        onConfirm={async (title) => {
          const workspace = await createWorkspace.mutateAsync(title);
          await openWorkspace(workspace.name);
        }}
      />
    </div>
  );
};

export default Bookshelf;
