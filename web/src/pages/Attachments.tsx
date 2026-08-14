import { create } from "@bufbuild/protobuf";
import { LoaderCircleIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import {
  AttachmentAudioRows,
  AttachmentDocumentRows,
  AttachmentLibraryEmptyState,
  AttachmentLibraryErrorState,
  AttachmentLibrarySkeletonGrid,
  AttachmentLibraryToolbar,
  AttachmentLibraryUnusedPanel,
  AttachmentMediaGrid,
  AttachmentUnusedRows,
} from "@/components/AttachmentLibrary";
import ConfirmDialog from "@/components/ConfirmDialog";
import MobileHeader from "@/components/MobileHeader";
import PreviewImageDialog from "@/components/PreviewImageDialog";
import { Button } from "@/components/ui/button";
import { attachmentServiceClient } from "@/connect";
import {
  type AttachmentLibraryListItem,
  type AttachmentLibraryStats,
  type AttachmentLibraryTab,
  useAttachmentLibrary,
} from "@/hooks/useAttachmentLibrary";
import { useBatchDeleteAttachments, useDeleteAttachment } from "@/hooks/useAttachmentQueries";
import useDialog from "@/hooks/useDialog";
import useMediaQuery from "@/hooks/useMediaQuery";
import usePageTitle from "@/hooks/usePageTitle";
import i18n from "@/i18n";
import { handleError } from "@/lib/error";
import { ListAttachmentsRequestSchema } from "@/types/proto/api/v1/attachment_service_pb";
import { useTranslate } from "@/utils/i18n";

const UNUSED_PAGE_SIZE = 1000;
const BATCH_DELETE_SIZE = 100;

const TAB_COUNT_SELECTOR = {
  audio: (stats: AttachmentLibraryStats) => stats.audio,
  documents: (stats: AttachmentLibraryStats) => stats.documents,
  media: (stats: AttachmentLibraryStats) => stats.media,
} as const;

const chunkNames = (names: string[], size: number) => {
  const chunks: string[][] = [];

  for (let index = 0; index < names.length; index += size) {
    chunks.push(names.slice(index, index + size));
  }

  return chunks;
};

const listUnusedAttachmentNames = async () => {
  const names: string[] = [];
  let pageToken = "";

  do {
    const response = await attachmentServiceClient.listAttachments(
      create(ListAttachmentsRequestSchema, {
        filter: "memo_id == null",
        pageSize: UNUSED_PAGE_SIZE,
        pageToken,
      }),
    );

    names.push(...response.attachments.map((attachment) => attachment.name));
    pageToken = response.nextPageToken;
  } while (pageToken);

  return names;
};

const Attachments = () => {
  const t = useTranslate();
  usePageTitle(t("common.attachments"));
  const md = useMediaQuery("md");
  const deleteUnusedAttachmentsDialog = useDialog();
  const [activeTab, setActiveTab] = useState<AttachmentLibraryTab>("media");
  const [previewState, setPreviewState] = useState({ open: false, initialIndex: 0 });
  const [showUnusedSection, setShowUnusedSection] = useState(false);
  const [pendingDeleteItem, setPendingDeleteItem] = useState<AttachmentLibraryListItem | undefined>(undefined);
  const { mutateAsync: batchDeleteAttachments, isPending: isDeletingUnused } = useBatchDeleteAttachments();
  const { mutateAsync: deleteAttachment, isPending: isDeletingOne, variables: deletingName } = useDeleteAttachment();
  const {
    audioItems,
    documentItems,
    error,
    fetchNextPage,
    hasNextPage,
    isError,
    isFetching,
    isFetchingNextPage,
    isLoading,
    mediaGroups,
    mediaPreviewItems,
    refetch,
    stats,
    unusedItems,
  } = useAttachmentLibrary(i18n.language);

  const currentItemsCount = useMemo(() => TAB_COUNT_SELECTOR[activeTab](stats), [activeTab, stats]);

  useEffect(() => {
    if (stats.unused === 0) {
      setShowUnusedSection(false);
    }
  }, [stats.unused]);

  const handlePreview = (itemId: string) => {
    const initialIndex = mediaPreviewItems.findIndex((item) => item.id === itemId);
    setPreviewState({ open: true, initialIndex: initialIndex >= 0 ? initialIndex : 0 });
  };

  const handleDeleteUnusedAttachments = async () => {
    try {
      const names = await listUnusedAttachmentNames();

      if (names.length === 0) {
        await refetch();
        return;
      }

      for (const chunk of chunkNames(names, BATCH_DELETE_SIZE)) {
        await batchDeleteAttachments(chunk);
      }

      toast.success(t("resource.delete-all-unused-success"));
      await refetch();
    } catch (deleteError) {
      handleError(deleteError, toast.error, {
        context: "Failed to delete unused attachments",
        fallbackMessage: t("resource.delete-all-unused-error"),
      });
    }
  };

  const handleDeleteUnusedAttachment = async () => {
    if (!pendingDeleteItem) {
      return;
    }

    try {
      await deleteAttachment(pendingDeleteItem.attachment.name);
      toast.success(t("attachment-library.unused.delete-one-success", { name: pendingDeleteItem.attachment.filename }));
      await refetch();
    } catch (deleteError) {
      handleError(deleteError, toast.error, {
        context: "Failed to delete unused attachment",
        fallbackMessage: t("resource.delete-all-unused-error"),
      });
    } finally {
      setPendingDeleteItem(undefined);
    }
  };

  const renderContent = () => {
    if (isLoading) {
      return <AttachmentLibrarySkeletonGrid />;
    }

    if (isError) {
      return <AttachmentLibraryErrorState error={error instanceof Error ? error : undefined} onRetry={() => refetch()} />;
    }

    if (currentItemsCount === 0) {
      return <AttachmentLibraryEmptyState tab={activeTab} />;
    }

    if (activeTab === "media") {
      return <AttachmentMediaGrid groups={mediaGroups} onPreview={handlePreview} />;
    }

    if (activeTab === "documents") {
      return <AttachmentDocumentRows items={documentItems} />;
    }

    if (activeTab === "audio") {
      return <AttachmentAudioRows items={audioItems} />;
    }

    return null;
  };

  return (
    <section className="@container w-full min-h-full pb-10 sm:pt-3 md:pt-6">
      {!md && <MobileHeader />}

      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 sm:gap-6 sm:px-6">
        <AttachmentLibraryToolbar activeTab={activeTab} onTabChange={setActiveTab} stats={stats} />

        {stats.unused > 0 && (
          <AttachmentLibraryUnusedPanel
            count={stats.unused}
            isDeleting={isDeletingUnused}
            isExpanded={showUnusedSection}
            onDelete={() => deleteUnusedAttachmentsDialog.open()}
            onToggle={() => setShowUnusedSection((state) => !state)}
          />
        )}

        {/* Kept directly under the panel: the toggle has to show its result without a scroll. */}
        {showUnusedSection && stats.unused > 0 && (
          <div className="space-y-3">
            <AttachmentUnusedRows
              items={unusedItems}
              onDelete={setPendingDeleteItem}
              deletingName={isDeletingOne ? deletingName : undefined}
            />
          </div>
        )}

        <div className="min-h-[16rem] pt-1">
          {renderContent()}

          {hasNextPage && (
            <div className="mt-6 flex justify-center">
              <Button variant="outline" className="rounded-full px-4" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
                {isFetchingNextPage ? <LoaderCircleIcon className="h-4 w-4 animate-spin" /> : null}
                {isFetchingNextPage ? t("resource.fetching-data") : t("memo.load-more")}
              </Button>
            </div>
          )}

          {!isLoading && isFetching && !isFetchingNextPage && (
            <div className="mt-4 text-center text-xs text-muted-foreground">{t("resource.fetching-data")}</div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(pendingDeleteItem)}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDeleteItem(undefined);
          }
        }}
        title={t("resource.delete-resource")}
        description={t("attachment-library.unused.delete-one-description", { name: pendingDeleteItem?.attachment.filename ?? "" })}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onConfirm={handleDeleteUnusedAttachment}
        confirmVariant="destructive"
      />

      <ConfirmDialog
        open={deleteUnusedAttachmentsDialog.isOpen}
        onOpenChange={deleteUnusedAttachmentsDialog.setOpen}
        title={t("resource.delete-all-unused-confirm")}
        description={t("attachment-library.unused.confirm-description")}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onConfirm={handleDeleteUnusedAttachments}
        confirmVariant="destructive"
      />

      <PreviewImageDialog
        open={previewState.open}
        onOpenChange={(open) => setPreviewState((prev) => ({ ...prev, open }))}
        items={mediaPreviewItems}
        initialIndex={previewState.initialIndex}
      />
    </section>
  );
};

export default Attachments;
