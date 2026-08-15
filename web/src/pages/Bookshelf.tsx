import { EyeIcon, InfoIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import BookSpine from "@/components/Bookshelf/BookSpine";
import PromptDialog from "@/components/Notebook/PromptDialog";
import { Button } from "@/components/ui/button";
import useCurrentUser from "@/hooks/useCurrentUser";
import { useLastOpened } from "@/hooks/useLastOpened";
import usePageTitle from "@/hooks/usePageTitle";
import { useCreateWorkspace, useSetWorkspaceHidden, useWorkspaces } from "@/hooks/useWorkspaceQueries";
import { cn } from "@/lib/utils";
import { workspaceDetailPath } from "@/router/routes";
import { useTranslate } from "@/utils/i18n";
import { isSuperUser } from "@/utils/user";

const Bookshelf = () => {
  const t = useTranslate();
  usePageTitle(t("bookshelf.title"));
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  // Knowledge bases are the team owner's to create, rename and hide (the server
  // requires owner access for every workspace mutation); a member only browses
  // the ones granted to them, so none of those controls are rendered for them.
  const canManage = isSuperUser(currentUser);
  const [showHidden, setShowHidden] = useState(false);
  const { data: workspaces = [] } = useWorkspaces(showHidden);
  const createWorkspace = useCreateWorkspace();
  const setHidden = useSetWorkspaceHidden();
  const { setLastOpened } = useLastOpened(currentUser?.name);
  const [createOpen, setCreateOpen] = useState(false);

  const openWorkspace = async (name: string, title: string) => {
    navigate(`/${encodeURIComponent(title)}`, { state: { workspace: name } });
    setLastOpened(name, "");
  };

  return (
    <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-6">
      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="text-3xl font-medium flex items-center gap-3 min-w-0">
          <img src="/logo.svg" alt="" className="w-12 h-12 shrink-0" />
          <span className="truncate">{t("bookshelf.title")}</span>
        </h1>
        {/*
         * The only way back to a hidden workspace. It has to exist before hiding is
         * usable at all, otherwise hiding the last entry point strands the data.
         */}
        {canManage && (
          <Button variant={showHidden ? "secondary" : "ghost"} size="sm" className="shrink-0" onClick={() => setShowHidden((v) => !v)}>
            <EyeIcon className="w-4 h-4 mr-1.5" />
            {t("bookshelf.show-hidden")}
          </Button>
        )}
      </div>
      <div className="rounded-lg bg-gradient-to-b from-amber-950/5 to-amber-950/10 dark:from-black/20 dark:to-black/30 p-5 sm:p-8 pb-0">
        <div className="grid items-start gap-x-2 gap-y-6 sm:gap-x-3 sm:gap-y-8 [--col-min:5.2rem] grid-cols-[repeat(auto-fit,minmax(var(--col-min),1fr))] sm:grid-cols-[repeat(auto-fill,7.2rem)]">
          {workspaces.map((workspace, index) => (
            <div key={workspace.name} className="relative group/book">
              <button
                onClick={() => openWorkspace(workspace.name, workspace.title)}
                className={cn(
                  "block w-full cursor-pointer transition-all duration-200 ease-out hover:-translate-y-2.5 hover:drop-shadow-xl",
                  // Hidden books stay on the shelf while the toggle is on, but read as
                  // set aside rather than as ordinary entries.
                  workspace.hidden && "opacity-40 grayscale",
                )}
              >
                <BookSpine workspace={workspace} index={index} />
              </button>
              <button
                title={t("bookshelf.details")}
                onClick={() => navigate(workspaceDetailPath(workspace.name))}
                className="absolute top-1 right-1 p-1 rounded-full bg-black/40 text-white/90 opacity-0 group-hover/book:opacity-100 focus-visible:opacity-100 hover:bg-black/60 transition-opacity cursor-pointer"
              >
                <InfoIcon className="w-3.5 h-3.5" />
              </button>
              {canManage && workspace.hidden && (
                <button
                  onClick={() => setHidden.mutateAsync({ workspace, hidden: false })}
                  className="absolute inset-x-1 bottom-1 py-0.5 text-[10px] rounded bg-black/60 text-white/90 hover:bg-black/80 cursor-pointer"
                >
                  {t("bookshelf.unhide")}
                </button>
              )}
              {/* Per-row shelf plank, anchored to this book so it stays aligned regardless of row count */}
              <div className="pointer-events-none absolute -left-1 -right-1 sm:-left-1.5 sm:-right-1.5 top-full h-1.5 sm:h-2 rounded-[1px] bg-gradient-to-b from-amber-800 via-amber-900 to-amber-950 dark:from-zinc-700 dark:via-zinc-800 dark:to-zinc-900 shadow-[0_2px_4px_rgba(0,0,0,0.3)]" />
            </div>
          ))}

          {canManage && (
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
          )}
        </div>

        {/* Shelf plank */}
        <div className="relative h-1.5 sm:h-2 rounded-[2px] bg-gradient-to-b from-amber-800 via-amber-900 to-amber-950 dark:from-zinc-700 dark:via-zinc-800 dark:to-zinc-900 shadow-[0_4px_8px_rgba(0,0,0,0.35)]">
          <div className="absolute inset-x-0 top-0 h-[2px] bg-white/10" />
        </div>
        <div className="h-4 sm:h-5" />
      </div>

      {canManage && (
        <PromptDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          title={t("bookshelf.new-workspace")}
          onConfirm={async (title) => {
            await createWorkspace.mutateAsync(title);
          }}
        />
      )}
    </div>
  );
};

export default Bookshelf;
