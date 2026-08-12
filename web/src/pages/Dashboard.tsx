import { ChevronLeftIcon, ChevronRightIcon, MoreHorizontalIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import ConfirmDialog from "@/components/ConfirmDialog";
import GalleryViewForm from "@/components/GalleryView/GalleryViewForm";
import GalleryViewRenderer from "@/components/GalleryView/GalleryViewRenderer";
import {
  emptyHomeConfig,
  emptySection,
  type HomeSection,
  type HomeViewConfig,
  parseHomeViewConfig,
  serializeHomeViewConfig,
} from "@/components/GalleryView/home";
import { parseGalleryViewConfig, serializeGalleryViewConfig, type ViewBlock } from "@/components/GalleryView/types";
import PromptDialog from "@/components/Notebook/PromptDialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useHomeDocument } from "@/hooks/useHomeDocument";
import { useUpdateMemo } from "@/hooks/useMemoQueries";
import { useWorkspaces } from "@/hooks/useWorkspaceQueries";
import { cn } from "@/lib/utils";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";

// The Home page: one per-user VIEW document whose blocks are grouped into
// sections shown as tabs. Unlike an ordinary view, its blocks may scan any
// knowledge base, and clicking a card opens that document in its own knowledge
// base's notebook page.

/** Serializes one section's blocks as an ordinary gallery view, which is what the block editor edits. */
const sectionAsViewContent = (section: HomeSection, frontmatter?: string): string =>
  serializeGalleryViewConfig({ viewType: "gallery", blocks: section.blocks, frontmatter });

const Dashboard = () => {
  const t = useTranslate();
  const navigate = useNavigate();
  const { sectionId } = useParams();
  const { data: workspaces = [] } = useWorkspaces();
  const { memo, isLoading } = useHomeDocument(t("home.default-section"));
  const updateMemo = useUpdateMemo();

  const [editing, setEditing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [renaming, setRenaming] = useState<HomeSection | undefined>();
  const [deleting, setDeleting] = useState<HomeSection | undefined>();

  const config: HomeViewConfig = useMemo(
    () => (memo && parseHomeViewConfig(memo.content, t("home.default-section"))) || emptyHomeConfig(t("home.default-section")),
    [memo, t],
  );
  const sections = config.sections;
  // An unknown (or absent) section id falls back to the first tab.
  const activeIndex = Math.max(
    0,
    sections.findIndex((s) => s.id === sectionId),
  );
  const active = sections[activeIndex];

  const workspaceOptions = useMemo(() => workspaces.map((w) => ({ name: w.name, title: w.title })), [workspaces]);
  // Cards can come from any knowledge base, so a click routes by the target
  // document's own workspace rather than the Home document's.
  const workspaceTitles = useMemo(() => new Map(workspaces.map((w) => [w.name, w.title])), [workspaces]);

  const save = async (next: HomeViewConfig) => {
    if (!memo) return;
    await updateMemo.mutateAsync({
      update: { name: memo.name, content: serializeHomeViewConfig(next) },
      updateMask: ["content"],
    });
  };

  const selectSection = (section: HomeSection) => navigate(`/dashboard/${section.id}`, { replace: true });

  const addSection = async (title: string) => {
    const section = emptySection(title);
    await save({ ...config, sections: [...sections, section] });
    selectSection(section);
    // A brand new section has nothing to show, so go straight to its editor.
    setEditing(true);
  };

  const renameSection = async (section: HomeSection, title: string) => {
    await save({ ...config, sections: sections.map((s) => (s.id === section.id ? { ...s, title } : s)) });
  };

  const deleteSection = async (section: HomeSection) => {
    const remaining = sections.filter((s) => s.id !== section.id);
    // The page always keeps at least one tab: deleting the last one leaves an
    // empty default section rather than a page with nothing to select.
    const next = remaining.length > 0 ? remaining : [emptySection(t("home.default-section"))];
    await save({ ...config, sections: next });
    selectSection(next[Math.min(activeIndex, next.length - 1)]);
  };

  const moveSection = async (from: number, to: number) => {
    if (to < 0 || to >= sections.length) return;
    const next = [...sections];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    await save({ ...config, sections: next });
  };

  const saveBlocks = async (content: string) => {
    // The editor round-trips through the ordinary gallery-view format; take its
    // blocks back into the active section (an unparseable result means no blocks).
    const parsed = parseGalleryViewConfig(content);
    const blocks: ViewBlock[] = parsed?.blocks ?? [];
    await save({
      ...config,
      frontmatter: parsed?.frontmatter,
      sections: sections.map((s, i) => (i === activeIndex ? { ...s, blocks } : s)),
    });
    setEditing(false);
  };

  const openDoc = (memoName: string, doc?: Memo) => {
    const title = doc && workspaceTitles.get(doc.workspace);
    // Path-based notebook URL (`/<workspace title>/<memo name>`), the same page
    // used for reading and editing a document anywhere else in the app.
    if (title) navigate(`/${encodeURIComponent(title)}/${encodeURIComponent(memoName)}`);
    else navigate(`/${memoName}`);
  };

  if (isLoading || !memo) {
    return <div className="w-full p-6 text-sm text-muted-foreground">{t("home.loading")}</div>;
  }

  return (
    <section className="w-full min-h-full flex flex-col">
      <div className="w-full flex items-center gap-1 border-b border-border px-4 overflow-x-auto shrink-0">
        {sections.map((section, index) => (
          <div key={section.id} className="flex items-center shrink-0">
            <button
              type="button"
              className={cn(
                "px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors",
                index === activeIndex
                  ? "border-primary text-foreground font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
              onClick={() => selectSection(section)}
            >
              {section.title}
            </button>
            {index === activeIndex && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="w-6 h-6">
                    <MoreHorizontalIcon className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => setRenaming(section)}>
                    <PencilIcon className="w-4 h-4" />
                    {t("home.rename-section")}
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={index === 0} onClick={() => moveSection(index, index - 1)}>
                    <ChevronLeftIcon className="w-4 h-4" />
                    {t("home.move-left")}
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={index === sections.length - 1} onClick={() => moveSection(index, index + 1)}>
                    <ChevronRightIcon className="w-4 h-4" />
                    {t("home.move-right")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setDeleting(section)}>
                    <Trash2Icon className="w-4 h-4" />
                    {t("home.delete-section")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        ))}
        <Button variant="ghost" size="icon" className="w-7 h-7 shrink-0" title={t("home.add-section")} onClick={() => setAddOpen(true)}>
          <PlusIcon className="w-4 h-4" />
        </Button>
        <div className="grow" />
        <Button variant={editing ? "secondary" : "ghost"} size="sm" className="shrink-0" onClick={() => setEditing((v) => !v)}>
          {editing ? t("common.cancel") : t("common.edit")}
        </Button>
      </div>

      <div className="w-full grow overflow-auto">
        {editing ? (
          <GalleryViewForm
            key={`${memo.name}:${active.id}`}
            content={sectionAsViewContent(active, config.frontmatter)}
            workspace={memo.workspace}
            memoName={memo.name}
            workspaceOptions={workspaceOptions}
            onSave={saveBlocks}
            onCancel={() => setEditing(false)}
          />
        ) : active.blocks.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">{t("home.empty-section")}</div>
        ) : (
          <div className="px-6 py-4">
            <GalleryViewRenderer memo={memo} blocks={active.blocks} hideProperties onOpenDoc={openDoc} />
          </div>
        )}
      </div>

      <PromptDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        title={t("home.add-section")}
        placeholder={t("home.section-name")}
        onConfirm={addSection}
      />
      <PromptDialog
        open={Boolean(renaming)}
        onOpenChange={(open) => !open && setRenaming(undefined)}
        title={t("home.rename-section")}
        defaultValue={renaming?.title}
        onConfirm={(title) => renaming && renameSection(renaming, title)}
      />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(undefined)}
        title={t("home.delete-section")}
        description={t("home.delete-section-confirm")}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        confirmVariant="destructive"
        onConfirm={() => deleting && deleteSection(deleting)}
      />
    </section>
  );
};

export default Dashboard;
