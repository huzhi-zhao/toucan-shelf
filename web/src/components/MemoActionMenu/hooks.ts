import { useQueryClient } from "@tanstack/react-query";
import copy from "copy-to-clipboard";
import { useCallback } from "react";
import toast from "react-hot-toast";
import { useLocation } from "react-router-dom";
import { useInstance } from "@/contexts/InstanceContext";
import { useCreateMemoHistory, useRestoreMemoHistory } from "@/hooks/useMemoHistoryQueries";
import { memoKeys, useDeleteMemo, useUpdateMemo } from "@/hooks/useMemoQueries";
import useNavigateTo from "@/hooks/useNavigateTo";
import { userKeys } from "@/hooks/useUserQueries";
import { handleError } from "@/lib/error";
import { ROUTES } from "@/router/routes";
import { State } from "@/types/proto/api/v1/common_pb";
import type { Memo, MemoHistory } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import { checkAllTasks, uncheckAllTasks } from "@/utils/markdown-task-actions";
import { attachmentUIDsOf, hashMemoState } from "@/utils/memoState";

interface UseMemoActionHandlersOptions {
  memo: Memo;
  onEdit?: () => void;
  setDeleteDialogOpen: (open: boolean) => void;
  setMoveDialogOpen: (open: boolean) => void;
  setCreateVersionDialogOpen: (open: boolean) => void;
}

export const useMemoActionHandlers = ({
  memo,
  onEdit,
  setDeleteDialogOpen,
  setMoveDialogOpen,
  setCreateVersionDialogOpen,
}: UseMemoActionHandlersOptions) => {
  const t = useTranslate();
  const location = useLocation();
  const navigateTo = useNavigateTo();
  const queryClient = useQueryClient();
  const { profile } = useInstance();
  const { mutateAsync: updateMemo } = useUpdateMemo();
  const { mutateAsync: deleteMemo } = useDeleteMemo();
  const { mutateAsync: createMemoHistory } = useCreateMemoHistory();
  const { mutateAsync: restoreMemoHistory } = useRestoreMemoHistory();
  const isInMemoDetailPage = location.pathname.startsWith(`/${memo.name}`);

  const memoUpdatedCallback = useCallback(() => {
    // Invalidate user stats to trigger refetch
    queryClient.invalidateQueries({ queryKey: userKeys.stats() });
  }, [queryClient]);

  const updateMemoContent = useCallback(
    async (nextContent: string, context: string) => {
      if (nextContent === memo.content) {
        return;
      }

      try {
        await updateMemo({
          update: {
            name: memo.name,
            content: nextContent,
          },
          updateMask: ["content", "update_time"],
        });
        toast.success(t("memo.task-actions.updated"));
      } catch (error: unknown) {
        handleError(error, toast.error, {
          context,
          fallbackMessage: "An error occurred",
        });
      }
    },
    [memo.content, memo.name, t, updateMemo],
  );

  const handleTogglePinMemoBtnClick = useCallback(async () => {
    try {
      await updateMemo({
        update: {
          name: memo.name,
          pinned: !memo.pinned,
        },
        updateMask: ["pinned"],
      });
    } catch {
      // do nothing
    }
  }, [memo.name, memo.pinned, updateMemo]);

  const handleEditMemoClick = useCallback(() => {
    onEdit?.();
  }, [onEdit]);

  const handleToggleMemoStatusClick = useCallback(async () => {
    const isArchiving = memo.state !== State.ARCHIVED;
    const state = memo.state === State.ARCHIVED ? State.NORMAL : State.ARCHIVED;
    const message = memo.state === State.ARCHIVED ? t("message.restored-successfully") : t("message.archived-successfully");

    try {
      await updateMemo({
        update: {
          name: memo.name,
          state,
        },
        updateMask: ["state"],
      });
      toast.success(message);
    } catch (error: unknown) {
      handleError(error, toast.error, {
        context: `${isArchiving ? "Archive" : "Restore"} memo`,
        fallbackMessage: "An error occurred",
      });
      return;
    }

    if (isInMemoDetailPage) {
      navigateTo(memo.state === State.ARCHIVED ? ROUTES.HOME : ROUTES.ARCHIVED);
    }
    memoUpdatedCallback();
  }, [memo.name, memo.state, t, isInMemoDetailPage, navigateTo, memoUpdatedCallback, updateMemo]);

  const handleCopyLink = useCallback(() => {
    let host = profile.instanceUrl;
    if (host === "") {
      host = window.location.origin;
    }
    copy(`${host}/${memo.name}`);
    toast.success(t("message.succeed-copy-link"));
    if (!isInMemoDetailPage) {
      navigateTo(`/${memo.name}`);
    }
  }, [memo.name, t, profile.instanceUrl, isInMemoDetailPage, navigateTo]);

  // Opens the bare reader in a new tab, leaving the current one where it is —
  // the reader is a terminal surface (read it, or print it to PDF and close it).
  const handleOpenReader = useCallback(() => {
    window.open(`/${memo.name}/reader`, "_blank", "noopener");
  }, [memo.name]);

  const handleCopyContent = useCallback(() => {
    copy(memo.content);
    toast.success(t("message.succeed-copy-content"));
  }, [memo.content, t]);

  const handleCheckAllTaskListItemsClick = useCallback(async () => {
    await updateMemoContent(checkAllTasks(memo.content), "Check memo task list items");
  }, [memo.content, updateMemoContent]);

  const handleUncheckAllTaskListItemsClick = useCallback(async () => {
    await updateMemoContent(uncheckAllTasks(memo.content), "Uncheck memo task list items");
  }, [memo.content, updateMemoContent]);

  const handleDeleteMemoClick = useCallback(() => {
    setDeleteDialogOpen(true);
  }, [setDeleteDialogOpen]);

  const handleMoveMemoClick = useCallback(() => {
    setMoveDialogOpen(true);
  }, [setMoveDialogOpen]);

  const handleCreateVersionClick = useCallback(() => {
    setCreateVersionDialogOpen(true);
  }, [setCreateVersionDialogOpen]);

  const confirmCreateVersion = useCallback(
    async (displayName: string) => {
      try {
        await createMemoHistory({ memoName: memo.name, displayName });
        toast.success(t("memo.version-saved"));
      } catch (error: unknown) {
        handleError(error, toast.error, { context: "Create memo version", fallbackMessage: "An error occurred" });
      }
    },
    [createMemoHistory, memo.name, t],
  );

  // Switches the memo's content and attachment set to a historical version.
  // Blocks only if the memo's current state (content + attachments) matches NO
  // saved version — a memo already sitting at an older restored version is
  // still safe (that state is recoverable via its own history record); only
  // truly unsaved changes must be saved as a version first. The server
  // re-checks the same condition as a backstop.
  const handleSwitchVersion = useCallback(
    async (history: MemoHistory, histories: MemoHistory[]) => {
      const currentHash = await hashMemoState(memo.content, attachmentUIDsOf(memo));
      if (!histories.some((h) => h.contentHash === currentHash)) {
        toast.error(t("memo.switch-version-blocked"));
        return;
      }
      try {
        await restoreMemoHistory({ historyName: history.name, memoName: memo.name });
        toast.success(t("memo.version-switched"));
      } catch (error: unknown) {
        handleError(error, toast.error, { context: "Switch memo version", fallbackMessage: "An error occurred" });
      }
    },
    [memo, t, restoreMemoHistory],
  );

  const confirmMoveMemo = useCallback(
    async (workspace: string, folderPath: string) => {
      await updateMemo({
        update: {
          name: memo.name,
          workspace,
          folderPath,
        },
        updateMask: ["workspace", "folder_path"],
      });
      toast.success(t("common.save"));
    },
    [memo.name, t, updateMemo],
  );

  const confirmDeleteMemo = useCallback(async () => {
    try {
      await deleteMemo(memo.name);
    } catch (error: unknown) {
      handleError(error, toast.error, { context: "Delete memo", fallbackMessage: "An error occurred" });
      return;
    }
    toast.success(t("message.deleted-successfully"));
    if (memo.parent) {
      queryClient.invalidateQueries({ queryKey: memoKeys.comments(memo.parent) });
    }
    if (isInMemoDetailPage) {
      navigateTo(ROUTES.HOME);
    }
    memoUpdatedCallback();
  }, [memo.name, memo.parent, t, isInMemoDetailPage, navigateTo, memoUpdatedCallback, deleteMemo, queryClient]);

  return {
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
  };
};
