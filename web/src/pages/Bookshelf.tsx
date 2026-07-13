import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import PromptDialog from "@/components/Notebook/PromptDialog";
import useCurrentUser from "@/hooks/useCurrentUser";
import { useLastOpened } from "@/hooks/useLastOpened";
import usePageTitle from "@/hooks/usePageTitle";
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
  usePageTitle(t("bookshelf.title"));
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const { data: workspaces = [] } = useWorkspaces();
  const createWorkspace = useCreateWorkspace();
  const { setLastOpened } = useLastOpened(currentUser?.name);
  const [createOpen, setCreateOpen] = useState(false);

  const openWorkspace = async (name: string, title: string) => {
    navigate(`/${encodeURIComponent(title)}`, { state: { workspace: name } });
    setLastOpened(name, "");
  };

  return (
    <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-6">
      <h1 className="text-2xl font-medium mb-6">{t("bookshelf.title")}</h1>
      <div className="rounded-lg bg-gradient-to-b from-amber-950/5 to-amber-950/10 dark:from-black/20 dark:to-black/30 p-5 sm:p-8 pb-0">
        <div className="grid items-start gap-x-2 gap-y-6 sm:gap-x-3 sm:gap-y-8 [--col-min:5.2rem] grid-cols-[repeat(auto-fit,minmax(var(--col-min),1fr))] sm:grid-cols-[repeat(auto-fill,7.2rem)]">
          {workspaces.map((workspace, index) => (
            <div key={workspace.name} className="relative">
              <button
                onClick={() => openWorkspace(workspace.name, workspace.title)}
                className="group relative flex w-full aspect-[2/3] sm:w-[7.2rem] sm:aspect-auto sm:h-[10.8rem] drop-shadow-md hover:-translate-y-2.5 hover:drop-shadow-xl transition-all duration-200 ease-out cursor-pointer"
              >
                {/* Spine */}
                <div
                  className="relative flex-1 flex flex-col justify-between rounded-t-[3px] rounded-b-[2px] border border-black/25 shadow-[inset_2px_0_0_rgba(255,255,255,0.12),inset_-2px_0_0_rgba(0,0,0,0.25)]"
                  style={
                    workspace.coverColor
                      ? { backgroundColor: workspace.coverColor }
                      : undefined
                  }
                >
                  <div
                    className={`absolute inset-0 rounded-t-[3px] rounded-b-[2px] bg-gradient-to-b ${SPINE_COLORS[index % SPINE_COLORS.length]} ${
                      workspace.coverColor ? "hidden" : ""
                    }`}
                  />
                  {/* Spine ribbing (raised bands like a hardcover binding) */}
                  <div className="absolute inset-x-1.5 top-3.5 h-[3px] rounded-full bg-black/20 shadow-[0_1px_0_rgba(255,255,255,0.15)]" />
                  {/* Gold foil title bar */}
                  <div className="relative px-1.5 pt-4.5 pb-1 text-center shrink-0">
                    <span className="text-amber-50/95 text-xs sm:text-sm font-semibold tracking-wide line-clamp-1 drop-shadow-[0_1px_1px_rgba(0,0,0,0.4)]">
                      {workspace.title}
                    </span>
                  </div>
                  {/* Cover image */}
                  <div className="relative flex-1 flex items-center justify-center px-2 min-h-0">
                    <div className="w-[65%] aspect-square translate-x-[6%] rounded-[2px] overflow-hidden">
                      {workspace.coverImage && (
                        <img src={workspace.coverImage} alt="" className="w-full h-full object-cover opacity-60" />
                      )}
                    </div>
                  </div>
                  <div className="relative px-1  pb-0.5 text-center shrink-0">
                    <div className="absolute inset-x-1.5 top-1.5 h-[3px] rounded-full bg-black/20 shadow-[0_1px_0_rgba(255,255,255,0.15)]" />
                    <span className="text-[8px]  text-white/60">
                      {workspace.createTime ? new Date(Number(workspace.createTime.seconds) * 1000).toLocaleDateString() : ""}
                    </span>
                  </div>
                  {/* Sheen highlight */}
                  <div className="pointer-events-none absolute inset-y-0 left-1 w-1.5 bg-white/25 rounded-full blur-[1px]" />
                </div>
                {/* Page edges (fanned pages peeking from behind the spine) */}
                <div className="w-2 shrink-0 self-stretch mt-[2px] mb-0 bg-gradient-to-b from-stone-50 to-stone-300 dark:from-stone-200 dark:to-stone-400 rounded-r-[2px] border-y border-r border-black/10 shadow-[inset_-1px_0_0_rgba(0,0,0,0.08)]" />
              </button>
              {/* Per-row shelf plank, anchored to this book so it stays aligned regardless of row count */}
              <div className="pointer-events-none absolute -left-1 -right-1 sm:-left-1.5 sm:-right-1.5 top-full h-1.5 sm:h-2 rounded-[1px] bg-gradient-to-b from-amber-800 via-amber-900 to-amber-950 dark:from-zinc-700 dark:via-zinc-800 dark:to-zinc-900 shadow-[0_2px_4px_rgba(0,0,0,0.3)]" />
            </div>
          ))}

          <div className="relative">
            <button
              onClick={() => setCreateOpen(true)}
              className="flex flex-col items-center justify-center gap-2 w-full aspect-[2/3] sm:w-[7.2rem] sm:aspect-auto sm:h-[10.8rem] rounded-t-[3px] border-2 border-dashed border-muted-foreground/30 text-muted-foreground hover:text-foreground hover:border-muted-foreground/60 hover:bg-muted/20 transition-colors cursor-pointer"
            >
              <PlusIcon className="w-5 h-5" />
              <span className="text-[11px] text-center px-1">{t("bookshelf.new-workspace")}</span>
            </button>
            <div className="pointer-events-none absolute -left-1 -right-1 sm:-left-1.5 sm:-right-1.5 top-full h-1.5 sm:h-2 rounded-[1px] bg-gradient-to-b from-amber-800 via-amber-900 to-amber-950 dark:from-zinc-700 dark:via-zinc-800 dark:to-zinc-900 shadow-[0_2px_4px_rgba(0,0,0,0.3)]" />
          </div>
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
          await createWorkspace.mutateAsync(title);
        }}
      />
    </div>
  );
};

export default Bookshelf;
