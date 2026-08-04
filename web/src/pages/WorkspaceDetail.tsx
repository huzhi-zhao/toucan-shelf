import { ArrowLeftIcon, EyeOffIcon, ImageIcon, PaletteIcon, PencilIcon, PlusIcon, RotateCcwIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import BookSpine from "@/components/Bookshelf/BookSpine";
import PromptDialog from "@/components/Notebook/PromptDialog";
import { WorkspaceCoverColorDialog, WorkspaceCoverImageDialog } from "@/components/Notebook/WorkspaceCoverDialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import usePageTitle from "@/hooks/usePageTitle";
import {
  useCreateWorkspace,
  useSetWorkspaceHidden,
  useSetWorkspaceOrder,
  useUpdateWorkspace,
  useWorkspace,
  useWorkspaceTree,
} from "@/hooks/useWorkspaceQueries";
import { ROUTES, workspaceDetailPath } from "@/router/routes";
import { type WorkspaceTreeNode, WorkspaceTreeNode_NodeType } from "@/types/proto/api/v1/workspace_service_pb";
import { useTranslate } from "@/utils/i18n";

/** Walks the tree once, counting folders and documents at every depth. */
function countTree(nodes: WorkspaceTreeNode[]): { folders: number; documents: number } {
  let folders = 0;
  let documents = 0;
  const visit = (list: WorkspaceTreeNode[]) => {
    for (const node of list) {
      if (node.type === WorkspaceTreeNode_NodeType.FOLDER) {
        folders += 1;
        visit(node.children);
      } else {
        documents += 1;
      }
    }
  };
  visit(nodes);
  return { folders, documents };
}

const formatTimestamp = (ts?: { seconds: bigint }) => (ts ? new Date(Number(ts.seconds) * 1000).toLocaleString() : "—");

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="flex items-baseline justify-between gap-4 py-1.5 border-b border-border/50 last:border-0">
    <span className="text-sm text-muted-foreground shrink-0">{label}</span>
    <span className="text-sm text-right min-w-0 truncate">{value}</span>
  </div>
);

const WorkspaceDetail = () => {
  const t = useTranslate();
  const navigate = useNavigate();
  const { workspaceUid } = useParams<{ workspaceUid: string }>();
  const name = workspaceUid ? `workspaces/${workspaceUid}` : undefined;

  const { data: workspace, isLoading, isError } = useWorkspace(name);
  const { data: nodes = [] } = useWorkspaceTree(name, false);
  const updateWorkspace = useUpdateWorkspace();
  const createWorkspace = useCreateWorkspace();
  const setHidden = useSetWorkspaceHidden();
  const setOrder = useSetWorkspaceOrder();

  const [renameOpen, setRenameOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [coverColorOpen, setCoverColorOpen] = useState(false);
  const [coverImageOpen, setCoverImageOpen] = useState(false);
  const [orderDraft, setOrderDraft] = useState<string | null>(null);

  usePageTitle(workspace?.title ?? t("bookshelf.details"));
  const stats = useMemo(() => countTree(nodes), [nodes]);

  if (isLoading) {
    return <div className="w-full max-w-3xl mx-auto px-4 py-10 text-muted-foreground">{t("common.loading")}</div>;
  }
  if (isError || !workspace) {
    return (
      <div className="w-full max-w-3xl mx-auto px-4 py-10 space-y-4">
        <p className="text-muted-foreground">{t("bookshelf.workspace-not-found")}</p>
        <Button variant="outline" onClick={() => navigate(ROUTES.SHELF)}>
          {t("bookshelf.back-to-shelf")}
        </Button>
      </div>
    );
  }

  // The input is kept as a draft string so a half-typed value (or "-") doesn't get
  // written; it is committed on blur / Enter and reverts to the stored value on Esc.
  const commitOrder = async () => {
    if (orderDraft === null) return;
    const parsed = Number.parseInt(orderDraft, 10);
    setOrderDraft(null);
    if (Number.isNaN(parsed) || parsed === workspace.displayOrder) return;
    await setOrder.mutateAsync({ workspace, displayOrder: parsed });
  };

  const sortLabel = `${t(`notebook.sort-${workspace.sortField === "updateTime" ? "update-time" : workspace.sortField === "alphabetical" ? "alphabetical" : "create-time"}`)} · ${t(workspace.sortOrder === "asc" ? "notebook.sort-asc" : "notebook.sort-desc")}`;

  return (
    <div className="w-full max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <Button variant="ghost" size="sm" className="-ml-2" onClick={() => navigate(ROUTES.SHELF)}>
        <ArrowLeftIcon className="w-4 h-4 mr-1.5" />
        {t("bookshelf.back-to-shelf")}
      </Button>

      <div className="flex flex-col sm:flex-row gap-6 sm:gap-8">
        <div className="shrink-0 self-center sm:self-start">
          <BookSpine workspace={workspace} size="large" />
        </div>
        <div className="flex-1 min-w-0 space-y-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-medium break-all">{workspace.title}</h1>
            {workspace.hidden && <p className="mt-1 text-sm text-amber-600 dark:text-amber-500">{t("bookshelf.hidden-notice")}</p>}
          </div>

          <div className="rounded-md border border-border px-3 py-1">
            <Row label={t("bookshelf.created-time")} value={formatTimestamp(workspace.createTime)} />
            <Row label={t("bookshelf.updated-time")} value={formatTimestamp(workspace.updateTime)} />
            <Row label={t("bookshelf.creator")} value={workspace.creator.replace(/^users\//, "")} />
            <Row label={t("bookshelf.document-count")} value={stats.documents} />
            <Row label={t("bookshelf.folder-count")} value={stats.folders} />
            <Row label={t("notebook.sort-by")} value={sortLabel} />
            <Row
              label={t("bookshelf.display-order")}
              value={
                <span className="inline-flex items-center gap-2">
                  <Input
                    type="number"
                    className="w-24 h-8 text-right"
                    value={orderDraft ?? String(workspace.displayOrder)}
                    onChange={(e) => setOrderDraft(e.target.value)}
                    onBlur={commitOrder}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setOrderDraft(null);
                    }}
                  />
                </span>
              }
            />
          </div>
          <p className="text-xs text-muted-foreground">{t("bookshelf.display-order-hint")}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => setRenameOpen(true)}>
          <PencilIcon className="w-4 h-4 mr-1.5" />
          {t("notebook.rename-workspace")}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setCoverColorOpen(true)}>
          <PaletteIcon className="w-4 h-4 mr-1.5" />
          {t("notebook.set-cover-color")}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setCoverImageOpen(true)}>
          <ImageIcon className="w-4 h-4 mr-1.5" />
          {t("notebook.set-cover-image")}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
          <PlusIcon className="w-4 h-4 mr-1.5" />
          {t("notebook.new-workspace")}
        </Button>
        {workspace.hidden ? (
          <Button variant="outline" size="sm" onClick={() => setHidden.mutateAsync({ workspace, hidden: false })}>
            <RotateCcwIcon className="w-4 h-4 mr-1.5" />
            {t("bookshelf.unhide")}
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={async () => {
              if (!window.confirm(t("bookshelf.hide-confirm"))) return;
              await setHidden.mutateAsync({ workspace, hidden: true });
              navigate(ROUTES.SHELF);
            }}
          >
            <EyeOffIcon className="w-4 h-4 mr-1.5" />
            {t("bookshelf.hide")}
          </Button>
        )}
      </div>

      <PromptDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title={t("notebook.rename-workspace")}
        defaultValue={workspace.title}
        onConfirm={async (title) => {
          await updateWorkspace.mutateAsync({ workspace: { ...workspace, title }, updateMask: ["title"] });
        }}
      />
      <PromptDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={t("notebook.new-workspace")}
        placeholder={t("notebook.workspace-title-placeholder")}
        onConfirm={async (title) => {
          const created = await createWorkspace.mutateAsync(title);
          navigate(workspaceDetailPath(created.name));
        }}
      />
      <WorkspaceCoverColorDialog workspace={workspace} open={coverColorOpen} onOpenChange={setCoverColorOpen} />
      <WorkspaceCoverImageDialog workspace={workspace} open={coverImageOpen} onOpenChange={setCoverImageOpen} />
    </div>
  );
};

export default WorkspaceDetail;
