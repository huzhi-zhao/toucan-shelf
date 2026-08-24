// 站点管理 — the admin surface for outward-facing sites and what is published to
// them. See docs/dev/design/20260823-public-publishing/tech-design.md.
//
// Two things this screen is careful about. A site's `status` is its own online
// switch, unrelated to whether the instance serves anonymous visitors — a private
// instance can still publish one site. And a publication row is a frozen snapshot,
// so "outdated" here does not mean "broken", it means readers are still being
// served the older text.

import { timestampDate } from "@bufbuild/protobuf/wkt";
import { ConnectError } from "@connectrpc/connect";
import { ExternalLinkIcon, GlobeIcon, Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";
import { Link } from "react-router-dom";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  type SiteInit,
  useCreateSite,
  useDeleteSite,
  useSitePublications,
  useSites,
  useUnpublishMemo,
  useUpdatePublicationSlug,
  useUpdateSite,
} from "@/hooks/useSiteQueries";
import { publicPagePath, publicSitePath } from "@/router/routes";
import { type Publication, type Site, SiteStatus } from "@/types/proto/api/v1/site_service_pb";
import { useTranslate } from "@/utils/i18n";
import { SettingList, SettingListItem } from "./SettingList";
import SettingSection from "./SettingSection";
import SiteChromeEditor from "./SiteChromeEditor";

const STATUS_OPTIONS: SiteStatus[] = [SiteStatus.DRAFT, SiteStatus.ONLINE, SiteStatus.OFFLINE];

const statusLabelKey = (status: SiteStatus) =>
  ({
    [SiteStatus.DRAFT]: "setting.site.status-draft",
    [SiteStatus.ONLINE]: "setting.site.status-online",
    [SiteStatus.OFFLINE]: "setting.site.status-offline",
    [SiteStatus.SITE_STATUS_UNSPECIFIED]: "setting.site.status-draft",
  })[status] as "setting.site.status-draft";

const errorMessage = (e: unknown, fallback: string) => (e instanceof ConnectError ? e.message : fallback);

const CreateSiteDialog = ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) => {
  const t = useTranslate();
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const createSite = useCreateSite();

  const handleCreate = async () => {
    if (!displayName.trim()) return;
    try {
      await createSite.mutateAsync({ displayName: displayName.trim(), description: description.trim(), status: SiteStatus.DRAFT });
      toast.success(t("setting.site.create-success"));
      setDisplayName("");
      setDescription("");
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e, t("setting.site.save-failed")));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("setting.site.create")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Input placeholder={t("setting.site.display-name")} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          <Textarea
            placeholder={t("setting.site.description-field")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          {/* A new site always starts as a draft: standing one up and putting it on
              the open internet are two decisions, and the second one is made below. */}
          <p className="text-xs text-muted-foreground">{t("setting.site.create-starts-draft")}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!displayName.trim() || createSite.isPending} onClick={handleCreate}>
            {createSite.isPending && <Loader2Icon className="mr-1 h-4 w-4 animate-spin" />}
            {t("common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const PublicationRow = ({ site, publication }: { site: Site; publication: Publication }) => {
  const t = useTranslate();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [slug, setSlug] = useState(publication.slug);
  const unpublish = useUnpublishMemo();
  const updateSlug = useUpdatePublicationSlug();

  // The slug is generated once and frozen afterwards, but an author may still
  // change it by hand — at the cost of breaking whatever already linked to the
  // old path, which is why it is an explicit edit rather than a rename that
  // follows the title.
  const handleSlugSave = async () => {
    try {
      await updateSlug.mutateAsync({ name: publication.name, slug: slug.trim() });
      toast.success(t("setting.site.save-success"));
    } catch (e) {
      setSlug(publication.slug);
      toast.error(errorMessage(e, t("setting.site.save-failed")));
    }
  };

  const handleUnpublish = async () => {
    try {
      const response = await unpublish.mutateAsync(publication.name);
      if (response.affectedPublications.length > 0) {
        // The snapshot model's price: pages that linked here keep the now-dead
        // link until they are republished, so the author has to be told which.
        toast(
          t("setting.site.unpublish-affected", {
            titles: response.affectedPublications.map((p) => p.title || p.slug).join("、"),
          }),
          { duration: 8000 },
        );
      } else {
        toast.success(t("setting.site.unpublish-success"));
      }
    } catch (e) {
      toast.error(errorMessage(e, t("setting.site.unpublish-failed")));
    }
  };

  return (
    <>
      <SettingListItem
        label={
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate">{publication.title || publication.slug}</span>
            {publication.outdated && (
              <span className="shrink-0 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-700 dark:text-amber-400">
                {t("setting.site.outdated")}
              </span>
            )}
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>/</span>
            <Input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className="h-7 w-56 font-mono text-xs"
              aria-label={t("setting.site.slug")}
            />
            {slug.trim() !== publication.slug && (
              <Button variant="ghost" size="sm" disabled={!slug.trim() || updateSlug.isPending} onClick={handleSlugSave}>
                {t("common.save")}
              </Button>
            )}
            {publication.updateTime && <span>{timestampDate(publication.updateTime).toLocaleString()}</span>}
          </span>
        }
        controlClassName="gap-2"
      >
        <Link
          to={publicPagePath(site.name, publication.slug)}
          target="_blank"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          <ExternalLinkIcon className="h-3.5 w-3.5" />
          {t("setting.site.open-page")}
        </Link>
        <Button variant="outline" size="sm" disabled={unpublish.isPending} onClick={() => setConfirmOpen(true)}>
          {t("setting.site.unpublish")}
        </Button>
      </SettingListItem>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("setting.site.unpublish-confirm-title")}
        description={t("setting.site.unpublish-confirm-description")}
        confirmLabel={t("setting.site.unpublish")}
        cancelLabel={t("common.cancel")}
        confirmVariant="destructive"
        onConfirm={handleUnpublish}
      />
    </>
  );
};

const SiteCard = ({ site }: { site: Site }) => {
  const t = useTranslate();
  const [displayName, setDisplayName] = useState(site.displayName);
  const [description, setDescription] = useState(site.description);
  const [domain, setDomain] = useState(site.domain);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const updateSite = useUpdateSite();
  const deleteSite = useDeleteSite();
  const { data: publications, isLoading } = useSitePublications(site.name);

  const dirty = displayName !== site.displayName || description !== site.description || domain !== site.domain;

  const save = async (paths: string[], overrides: SiteInit = {}) => {
    try {
      await updateSite.mutateAsync({
        site: { name: site.name, displayName, description, domain, ...overrides },
        paths,
      });
      toast.success(t("setting.site.save-success"));
    } catch (e) {
      toast.error(errorMessage(e, t("setting.site.save-failed")));
    }
  };

  const handleDelete = async () => {
    try {
      await deleteSite.mutateAsync(site.name);
      toast.success(t("setting.site.delete-success"));
    } catch (e) {
      toast.error(errorMessage(e, t("setting.site.save-failed")));
    }
  };

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-background p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={t("setting.site.display-name")} />
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("setting.site.description-field")}
            rows={2}
          />
          <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder={t("setting.site.domain-placeholder")} />
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:w-44">
          <Select value={String(site.status)} onValueChange={(value) => void save(["status"], { status: Number(value) as SiteStatus })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((status) => (
                <SelectItem key={status} value={String(status)}>
                  {t(statusLabelKey(status))}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Link
            to={publicSitePath(site.name)}
            target="_blank"
            className="inline-flex items-center justify-center gap-1 text-sm text-primary hover:underline"
          >
            <ExternalLinkIcon className="h-3.5 w-3.5" />
            {t("setting.site.open-site")}
          </Link>
          <Button
            variant="outline"
            size="sm"
            disabled={!dirty || updateSite.isPending}
            onClick={() => void save(["display_name", "description", "domain"])}
          >
            {t("common.save")}
          </Button>
          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2Icon className="mr-1 h-4 w-4" />
            {t("common.delete")}
          </Button>
        </div>
      </div>

      {site.status !== SiteStatus.ONLINE && <p className="text-xs text-muted-foreground">{t("setting.site.offline-hint")}</p>}

      <SiteChromeEditor site={site} />

      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground/60">
          {t("setting.site.published-pages")} {publications ? `(${publications.length})` : ""}
        </p>
        {isLoading ? (
          <Loader2Icon className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : !publications || publications.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("setting.site.no-pages")}</p>
        ) : (
          <SettingList>
            {publications.map((publication) => (
              <PublicationRow key={publication.name} site={site} publication={publication} />
            ))}
          </SettingList>
        )}
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("setting.site.delete-confirm-title")}
        description={t("setting.site.delete-confirm-description", { name: site.displayName })}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        confirmVariant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  );
};

const SitesSection = () => {
  const t = useTranslate();
  const [createOpen, setCreateOpen] = useState(false);
  const { data: sites, isLoading, isError } = useSites();

  return (
    <SettingSection
      title={t("setting.site.title")}
      description={t("setting.site.description")}
      actions={
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <PlusIcon className="mr-1 h-4 w-4" />
          {t("setting.site.create")}
        </Button>
      }
    >
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="h-4 w-4 animate-spin" />
          {t("common.loading")}
        </div>
      ) : isError ? (
        <p className="text-sm text-destructive">{t("setting.site.load-error")}</p>
      ) : !sites || sites.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-10 text-sm text-muted-foreground">
          <GlobeIcon className="h-6 w-6 opacity-50" />
          {t("setting.site.empty")}
        </div>
      ) : (
        sites.map((site) => <SiteCard key={site.name} site={site} />)
      )}
      <CreateSiteDialog open={createOpen} onOpenChange={setCreateOpen} />
    </SettingSection>
  );
};

export default SitesSection;
