import { timestampDate } from "@bufbuild/protobuf/wkt";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  BookmarkMinusIcon,
  BookmarkPlusIcon,
  CheckCheckIcon,
  CopyIcon,
  Edit3Icon,
  ExpandIcon,
  FileTextIcon,
  FolderInputIcon,
  HistoryIcon,
  LinkIcon,
  ListChecksIcon,
  ListRestartIcon,
  MoreVerticalIcon,
  PaperclipIcon,
  SaveIcon,
  TrashIcon,
} from "lucide-react";
import { useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";
import MoveDocumentDialog from "@/components/Notebook/MoveDocumentDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMemoHistories } from "@/hooks/useMemoHistoryQueries";
import { State } from "@/types/proto/api/v1/common_pb";
import { useTranslate } from "@/utils/i18n";
import { countTasks } from "@/utils/markdown-manipulation";
import CreateVersionDialog from "./CreateVersionDialog";
import { useMemoActionHandlers } from "./hooks";
import type { MemoActionMenuProps } from "./types";

const MemoActionMenu = (props: MemoActionMenuProps) => {
  const { memo, readonly } = props;
  const t = useTranslate();

  // Dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [createVersionDialogOpen, setCreateVersionDialogOpen] = useState(false);
  // Lazily load versions only once the "view versions" submenu is opened, so we
  // don't fire a request for every memo card that renders this menu.
  const [versionsMenuOpen, setVersionsMenuOpen] = useState(false);

  // Derived state
  const isComment = Boolean(memo.parent);
  const isArchived = memo.state === State.ARCHIVED;
  const taskStats = countTasks(memo.content);
  const canMutateTasks = !readonly && !isArchived && taskStats.total > 0;
  const hasOpenTasks = taskStats.completed < taskStats.total;
  const hasCompletedTasks = taskStats.completed > 0;
  const canManageVersions = !readonly && !isArchived && !isComment;

  const { data: histories = [] } = useMemoHistories(memo.name, { enabled: canManageVersions && versionsMenuOpen });

  // Action handlers
  const {
    handleTogglePinMemoBtnClick,
    handleEditMemoClick,
    handleToggleMemoStatusClick,
    handleCopyLink,
    handleCopyContent,
    handleOpenReader,
    handleCheckAllTaskListItemsClick,
    handleUncheckAllTaskListItemsClick,
    handleDeleteMemoClick,
    confirmDeleteMemo,
    handleMoveMemoClick,
    confirmMoveMemo,
    handleCreateVersionClick,
    confirmCreateVersion,
    handleSwitchVersion,
  } = useMemoActionHandlers({
    memo,
    onEdit: props.onEdit,
    setDeleteDialogOpen,
    setMoveDialogOpen,
    setCreateVersionDialogOpen,
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-4">
          <MoreVerticalIcon className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={2}>
        {/* Edit actions (non-readonly, non-archived) */}
        {!readonly && !isArchived && (
          <>
            {!isComment && (
              <DropdownMenuItem onClick={handleTogglePinMemoBtnClick}>
                {memo.pinned ? <BookmarkMinusIcon className="w-4 h-auto" /> : <BookmarkPlusIcon className="w-4 h-auto" />}
                {memo.pinned ? t("common.unpin") : t("common.pin")}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={handleEditMemoClick}>
              <Edit3Icon className="w-4 h-auto" />
              {t("common.edit")}
            </DropdownMenuItem>
          </>
        )}

        {/* Bare reader in a new tab — also the entry point for printing to PDF. */}
        <DropdownMenuItem onClick={handleOpenReader}>
          <ExpandIcon className="w-4 h-auto" />
          {t("memo.fullscreen-view")}
        </DropdownMenuItem>

        {/* Copy submenu (non-archived) */}
        {!isArchived && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <CopyIcon className="w-4 h-auto" />
              {t("common.copy")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onClick={handleCopyLink}>
                <LinkIcon className="w-4 h-auto" />
                {t("memo.copy-link")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleCopyContent}>
                <FileTextIcon className="w-4 h-auto" />
                {t("memo.copy-content")}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        {/* Task submenu (writable task memos) */}
        {canMutateTasks && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <ListChecksIcon className="w-4 h-auto" />
              {t("memo.task-actions.title")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem disabled={!hasOpenTasks} onClick={handleCheckAllTaskListItemsClick}>
                <CheckCheckIcon className="w-4 h-auto" />
                {t("memo.task-actions.check-all")}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!hasCompletedTasks} onClick={handleUncheckAllTaskListItemsClick}>
                <ListRestartIcon className="w-4 h-auto" />
                {t("memo.task-actions.uncheck-all")}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        {/* Write actions (non-readonly) */}
        {!readonly && (
          <>
            {/* Archive/Restore (non-comment) */}
            {!isComment && (
              <DropdownMenuItem onClick={handleToggleMemoStatusClick}>
                {isArchived ? <ArchiveRestoreIcon className="w-4 h-auto" /> : <ArchiveIcon className="w-4 h-auto" />}
                {isArchived ? t("common.restore") : t("common.archive")}
              </DropdownMenuItem>
            )}

            {/* Move */}
            {!isComment && (
              <DropdownMenuItem onClick={handleMoveMemoClick}>
                <FolderInputIcon className="w-4 h-auto" />
                {t("notebook.move")}
              </DropdownMenuItem>
            )}

            {/* Version submenu */}
            {canManageVersions && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <HistoryIcon className="w-4 h-auto" />
                  {t("memo.version-history")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={handleCreateVersionClick}>
                    <SaveIcon className="w-4 h-auto" />
                    {t("memo.create-as-version")}
                  </DropdownMenuItem>
                  <DropdownMenuSub onOpenChange={setVersionsMenuOpen}>
                    <DropdownMenuSubTrigger>
                      <HistoryIcon className="w-4 h-auto" />
                      {t("memo.view-versions")}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
                      {histories.length === 0 ? (
                        <DropdownMenuItem disabled>{t("memo.no-versions")}</DropdownMenuItem>
                      ) : (
                        histories.map((history) => (
                          <DropdownMenuItem key={history.name} onClick={() => handleSwitchVersion(history, histories)}>
                            <div className="flex flex-col">
                              <span className="text-sm">{history.displayName || t("memo.unnamed-version")}</span>
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                {history.createTime && timestampDate(history.createTime).toLocaleString()}
                                {history.attachments.length > 0 && (
                                  <span className="inline-flex items-center gap-0.5">
                                    <PaperclipIcon className="w-3 h-3" />
                                    {history.attachments.length}
                                  </span>
                                )}
                              </span>
                            </div>
                          </DropdownMenuItem>
                        ))
                      )}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}

            {/* Delete */}
            <DropdownMenuItem onClick={handleDeleteMemoClick}>
              <TrashIcon className="w-4 h-auto" />
              {t("common.delete")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={t("memo.delete-confirm")}
        confirmLabel={t("common.delete")}
        description={t("memo.delete-confirm-description")}
        cancelLabel={t("common.cancel")}
        onConfirm={confirmDeleteMemo}
        confirmVariant="destructive"
      />

      {/* Move dialog */}
      <MoveDocumentDialog
        open={moveDialogOpen}
        onOpenChange={setMoveDialogOpen}
        currentWorkspace={memo.workspace}
        onConfirm={confirmMoveMemo}
      />

      {/* Create version dialog */}
      <CreateVersionDialog open={createVersionDialogOpen} onOpenChange={setCreateVersionDialogOpen} onConfirm={confirmCreateVersion} />
    </DropdownMenu>
  );
};

export default MemoActionMenu;
