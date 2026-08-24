// 发布 / 更新发布面板。
//
// The panel exists because publishing is not a toggle. Readers see a frozen
// snapshot, so an edit made after publishing does not reach them until someone
// republishes — that is the "线上落后于当前版本" state shown here. And publishing
// never changes an attachment's permissions, so files the page pulls in that an
// anonymous reader cannot fetch are listed for the author to act on rather than
// quietly opened. See docs/dev/requirements/20260823-public-blog-publishing.md §9.

import { timestampDate } from "@bufbuild/protobuf/wkt";
import { ConnectError } from "@connectrpc/connect";
import { AlertTriangleIcon, ExternalLinkIcon, FileWarningIcon, Loader2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useMemoPublications, usePreviewPublish, usePublishMemo, useSites, useUnpublishMemo } from "@/hooks/useSiteQueries";
import { publicPagePath } from "@/router/routes";
import type { PreviewPublishResponse, Publication, Site } from "@/types/proto/api/v1/site_service_pb";
import { SiteStatus } from "@/types/proto/api/v1/site_service_pb";
import { useTranslate } from "@/utils/i18n";

const errorMessage = (e: unknown, fallback: string) => (e instanceof ConnectError ? e.message : fallback);

/** Blockers and the not-public attachment list, as returned by PreviewPublish. */
const PreviewReport = ({ preview }: { preview: PreviewPublishResponse }) => {
  const t = useTranslate();
  return (
    <div className="flex flex-col gap-2">
      {preview.blockers.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          <p className="mb-1 flex items-center gap-1 font-medium">
            <AlertTriangleIcon className="h-3.5 w-3.5" />
            {t("memo.publish.blockers-title")}
          </p>
          <ul className="list-disc space-y-0.5 pl-4">
            {preview.blockers.map((blocker, index) => (
              <li key={`${blocker.reference}-${index}`}>
                <span className="font-mono">{blocker.reference}</span>
                {blocker.detail ? ` — ${blocker.detail}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      {preview.attachmentsNotPublic.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
          <p className="mb-1 flex items-center gap-1 font-medium">
            <FileWarningIcon className="h-3.5 w-3.5" />
            {t("memo.publish.attachments-not-public-title")}
          </p>
          <ul className="list-disc space-y-0.5 pl-4">
            {preview.attachmentsNotPublic.map((attachment) => (
              <li key={attachment.attachment}>{attachment.filename}</li>
            ))}
          </ul>
          {/* Publishing moves content only: opening a file to the world stays a
              separate, deliberate act by whoever owns the file. */}
          <p className="mt-1">{t("memo.publish.attachments-not-public-hint")}</p>
        </div>
      )}
      {preview.secretBlocksRemoved > 0 && (
        <p className="text-xs text-muted-foreground">{t("memo.publish.secret-blocks-removed", { count: preview.secretBlocksRemoved })}</p>
      )}
      {preview.proposedSlug && (
        <p className="text-xs text-muted-foreground">
          {t("memo.publish.proposed-slug")}: <span className="font-mono">/{preview.proposedSlug}</span>
        </p>
      )}
    </div>
  );
};

interface SiteRowProps {
  site: Site;
  memoName: string;
  publication?: Publication;
}

const SiteRow = ({ site, memoName, publication }: SiteRowProps) => {
  const t = useTranslate();
  const [preview, setPreview] = useState<PreviewPublishResponse | undefined>();
  const previewPublish = usePreviewPublish();
  const publishMemo = usePublishMemo();
  const unpublishMemo = useUnpublishMemo();

  // The preview is re-run whenever the panel opens on this site: the body keeps
  // changing after a publish (editor, memogit push, MCP agent) and each of those
  // edits can drag a new unpublished reference or private attachment along.
  useEffect(() => {
    let cancelled = false;
    previewPublish
      .mutateAsync({ site: site.name, memo: memoName })
      .then((response) => {
        if (!cancelled) setPreview(response);
      })
      .catch(() => {
        if (!cancelled) setPreview(undefined);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.name, memoName]);

  const blocked = (preview?.blockers.length ?? 0) > 0;

  const handlePublish = async () => {
    try {
      await publishMemo.mutateAsync({ site: site.name, memo: memoName });
      toast.success(publication ? t("memo.publish.republished") : t("memo.publish.published"));
    } catch (e) {
      toast.error(errorMessage(e, t("memo.publish.failed")));
    }
  };

  const handleUnpublish = async () => {
    if (!publication) return;
    try {
      const response = await unpublishMemo.mutateAsync(publication.name);
      if (response.affectedPublications.length > 0) {
        toast(
          t("memo.publish.unpublish-affected", {
            titles: response.affectedPublications.map((p) => p.title || p.slug).join("、"),
          }),
          { duration: 8000 },
        );
      } else {
        toast.success(t("memo.publish.unpublished"));
      }
    } catch (e) {
      toast.error(errorMessage(e, t("memo.publish.unpublish-failed")));
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{site.displayName}</p>
          <p className="text-xs text-muted-foreground">
            {publication ? (
              <>
                <span className="font-mono">/{publication.slug}</span>
                {publication.updateTime && ` · ${timestampDate(publication.updateTime).toLocaleString()}`}
              </>
            ) : (
              t("memo.publish.not-published-here")
            )}
          </p>
        </div>
        {publication && (
          <a
            href={publicPagePath(site.name, publication.slug)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1 text-xs text-primary hover:underline"
          >
            <ExternalLinkIcon className="h-3 w-3" />
            {t("memo.publish.open-page")}
          </a>
        )}
      </div>

      {site.status !== SiteStatus.ONLINE && <p className="text-xs text-muted-foreground">{t("memo.publish.site-not-online")}</p>}

      {/* The whole reason this panel is not a toggle: readers are still being
          served the older text until the author republishes. */}
      {publication?.outdated && (
        <p className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-400">
          {t("memo.publish.outdated-hint")}
        </p>
      )}

      {previewPublish.isPending && !preview ? (
        <Loader2Icon className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : preview ? (
        <PreviewReport preview={preview} />
      ) : null}

      <div className="flex items-center gap-2">
        <Button size="sm" disabled={blocked || publishMemo.isPending} onClick={handlePublish}>
          {publishMemo.isPending && <Loader2Icon className="mr-1 h-4 w-4 animate-spin" />}
          {publication ? t("memo.publish.republish") : t("memo.publish.publish")}
        </Button>
        {publication && (
          <Button variant="outline" size="sm" disabled={unpublishMemo.isPending} onClick={handleUnpublish}>
            {t("memo.publish.unpublish")}
          </Button>
        )}
      </div>
    </div>
  );
};

interface Props {
  memoName: string;
  open: boolean;
  onClose: () => void;
}

const MemoPublishPanel = ({ memoName, open, onClose }: Props) => {
  const t = useTranslate();
  const { data: sites, isLoading: sitesLoading } = useSites(open);
  const { data: memoPublications, isLoading: publicationsLoading } = useMemoPublications(memoName, open);

  const publicationBySite = new Map<string, Publication>();
  memoPublications?.publications.forEach((publication, index) => {
    const site = memoPublications.sites[index];
    if (site) publicationBySite.set(site.name, publication);
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("memo.publish.title")}</DialogTitle>
        </DialogHeader>
        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
          {sitesLoading || publicationsLoading ? (
            <Loader2Icon className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : !sites || sites.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("memo.publish.no-sites")}</p>
          ) : (
            sites.map((site) => <SiteRow key={site.name} site={site} memoName={memoName} publication={publicationBySite.get(site.name)} />)
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default MemoPublishPanel;
