import { create } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { isEqual } from "lodash-es";
import {
  CheckCircleIcon,
  ChevronRightIcon,
  Code2Icon,
  DownloadIcon,
  GlobeIcon,
  HashIcon,
  ImageIcon,
  LinkIcon,
  type LucideIcon,
  RadioIcon,
  Share2Icon,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import useCurrentUser from "@/hooks/useCurrentUser";
import { cn } from "@/lib/utils";
import { Memo, Memo_DocType, Memo_PropertySchema } from "@/types/proto/api/v1/memo_service_pb";
import { isLayoutDoc } from "@/utils/docType";
import { parseFrontmatter } from "@/utils/frontmatter";
import { type Translations, useTranslate } from "@/utils/i18n";
import { extractHeadings, type HeadingItem } from "@/utils/markdown-manipulation";
import { buildMemoFileBaseName } from "@/utils/memo";
import { isSuperUser } from "@/utils/user";
import MemoOutline from "./MemoOutline";
import MemoPublishPanel from "./MemoPublishPanel";
import MemoSharePanel from "./MemoSharePanel";
import MemoSiteHomePanel from "./MemoSiteHomePanel";

interface Props {
  memo: Memo;
  className?: string;
  onShareImageOpen?: () => void;
  /** Live editor draft content, while editing — outline is regenerated from this instead of `memo.content`. */
  liveContent?: string;
  /** Whether the memo is currently open in its inline editor (no rendered DOM anchors to scroll to). */
  isEditing?: boolean;
  /** Scrolls the editor to a given 1-indexed line of its full (frontmatter-included) content. Required when `isEditing`. */
  onScrollToLine?: (line: number) => void;
}

interface PropertyBadge {
  icon: LucideIcon;
  labelKey: Translations;
}

const SidebarSection = ({ label, count, children }: { label: string; count?: number; children: React.ReactNode }) => (
  <div className="w-full space-y-2">
    <div className="flex items-center gap-1.5">
      <p className="text-xs font-medium text-muted-foreground/50 uppercase tracking-wider">{label}</p>
      {count != null && <span className="text-xs text-muted-foreground/30">({count})</span>}
    </div>
    {children}
  </div>
);

const PROPERTY_BADGE_CLASSES =
  "inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-border/60 bg-muted/60 text-xs text-muted-foreground";

const TAG_BADGE_CLASSES =
  "inline-flex items-center gap-1 px-1 rounded-md border border-border/60 bg-muted/60 text-sm text-muted-foreground hover:bg-muted hover:text-foreground/80 transition-colors cursor-pointer";

const SHARE_ACTION_ROW_CLASSES =
  "h-auto min-h-0 w-full justify-between rounded-none px-2 py-1.5 text-xs font-normal leading-tight text-muted-foreground transition-colors hover:bg-muted/40 hover:text-muted-foreground focus-visible:ring-offset-0 gap-1.5";

/** Sanitized title (or the memo's uid as a fallback) for the downloaded .md filename. */
const buildMemoMarkdownFileName = (memo: Memo) => `${buildMemoFileBaseName(memo)}.md`;

const MemoDetailSidebar = ({ memo, className, onShareImageOpen, liveContent, isEditing, onScrollToLine }: Props) => {
  const t = useTranslate();
  const currentUser = useCurrentUser();
  const [sharePanelOpen, setSharePanelOpen] = useState(false);
  const [publishPanelOpen, setPublishPanelOpen] = useState(false);
  const [siteHomePanelOpen, setSiteHomePanelOpen] = useState(false);
  const property = create(Memo_PropertySchema, memo.property || {});
  const canManageShares = !memo.parent && (memo.creator === currentUser?.name || isSuperUser(currentUser));
  // Publishing is a team-level action, so the entry point follows the same rule
  // the server enforces (canPublish == ADMIN) rather than document ownership.
  // A layout document is not an article: a site home page is chosen in the site
  // settings and a view never leaves the knowledge base at all, so there is
  // nothing to publish here and the server refuses both.
  const canPublish = !memo.parent && !isLayoutDoc(memo.docType) && isSuperUser(currentUser);
  // A site home document has no publish action — it has no slug and never
  // becomes a page. What it has instead is the choice that freezes it, which is
  // the only outward action this document type has at all.
  const canSetSiteHome = !memo.parent && memo.docType === Memo_DocType.BLOGVIEW && isSuperUser(currentUser);
  const hasUpdated = !isEqual(memo.createTime, memo.updateTime);
  const content = liveContent ?? memo.content;
  // Headings' `line` is relative to the body (frontmatter stripped) — add back the
  // number of lines the frontmatter block occupies in the full document so it lines
  // up with the editor's CodeMirror content, which includes frontmatter verbatim.
  const { body, frontmatterLineCount } = useMemo(() => {
    const parsedBody = parseFrontmatter(content).body;
    if (parsedBody === content) return { body: parsedBody, frontmatterLineCount: 0 };
    const totalLines = content.replace(/\r\n/g, "\n").split("\n").length;
    const bodyLines = parsedBody.split("\n").length;
    return { body: parsedBody, frontmatterLineCount: totalLines - bodyLines };
  }, [content]);
  const headings = useMemo(() => extractHeadings(body), [body]);

  const handleHeadingSelect = useCallback(
    (heading: HeadingItem) => {
      if (isEditing && onScrollToLine) {
        onScrollToLine(heading.line + frontmatterLineCount);
        return;
      }
      const el = document.getElementById(heading.slug);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        window.history.replaceState(null, "", `#${heading.slug}`);
      }
    },
    [isEditing, onScrollToLine, frontmatterLineCount],
  );

  const handleDownloadMarkdown = useCallback(() => {
    const blob = new Blob([memo.content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = buildMemoMarkdownFileName(memo);
    anchor.click();
    URL.revokeObjectURL(url);
  }, [memo]);

  const propertyBadges = useMemo(() => {
    const badges: PropertyBadge[] = [];
    if (property.hasLink) badges.push({ icon: LinkIcon, labelKey: "memo.links" });
    if (property.hasTaskList) badges.push({ icon: CheckCircleIcon, labelKey: "memo.to-do" });
    if (property.hasCode) badges.push({ icon: Code2Icon, labelKey: "memo.code" });
    return badges;
  }, [property.hasLink, property.hasTaskList, property.hasCode]);

  return (
    <aside className={cn("relative w-full h-auto max-h-screen overflow-auto flex flex-col gap-5", className)}>
      {headings.length > 0 && (
        <SidebarSection label={t("memo.outline")}>
          <MemoOutline headings={headings} onSelect={handleHeadingSelect} />
        </SidebarSection>
      )}

      <SidebarSection label={t("memo.share.section-label")}>
        <div className="overflow-hidden rounded-md border border-border/50 bg-muted/20">
          {onShareImageOpen && (
            <Button variant="ghost" size="sm" className={SHARE_ACTION_ROW_CLASSES} onClick={onShareImageOpen}>
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <ImageIcon className="size-3.5 shrink-0 text-muted-foreground/90" />
                <span className="truncate">{t("memo.share.open-image")}</span>
              </span>
              <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground/35" />
            </Button>
          )}
          {onShareImageOpen && canManageShares && <div className="border-t border-border/50" />}
          {canManageShares && (
            <Button variant="ghost" size="sm" className={SHARE_ACTION_ROW_CLASSES} onClick={() => setSharePanelOpen(true)}>
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <Share2Icon className="size-3.5 shrink-0 text-muted-foreground/90" />
                <span className="truncate">{t("memo.share.open-panel")}</span>
              </span>
              <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground/35" />
            </Button>
          )}
          {canPublish && (onShareImageOpen || canManageShares) && <div className="border-t border-border/50" />}
          {canPublish && (
            <Button variant="ghost" size="sm" className={SHARE_ACTION_ROW_CLASSES} onClick={() => setPublishPanelOpen(true)}>
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <RadioIcon className="size-3.5 shrink-0 text-muted-foreground/90" />
                <span className="truncate">{t("memo.publish.open-panel")}</span>
              </span>
              <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground/35" />
            </Button>
          )}
          {canSetSiteHome && (onShareImageOpen || canManageShares) && <div className="border-t border-border/50" />}
          {canSetSiteHome && (
            <Button variant="ghost" size="sm" className={SHARE_ACTION_ROW_CLASSES} onClick={() => setSiteHomePanelOpen(true)}>
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <GlobeIcon className="size-3.5 shrink-0 text-muted-foreground/90" />
                <span className="truncate">{t("memo.site-home.open-panel")}</span>
              </span>
              <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground/35" />
            </Button>
          )}
          {(onShareImageOpen || canManageShares || canPublish || canSetSiteHome) && <div className="border-t border-border/50" />}
          <Button variant="ghost" size="sm" className={SHARE_ACTION_ROW_CLASSES} onClick={handleDownloadMarkdown}>
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <DownloadIcon className="size-3.5 shrink-0 text-muted-foreground/90" />
              <span className="truncate">{t("memo.share.download-markdown")}</span>
            </span>
          </Button>
        </div>
      </SidebarSection>

      <SidebarSection label={t("common.created-at")}>
        <div className="flex flex-col gap-1">
          <p className="text-sm text-foreground/70">{memo.createTime ? timestampDate(memo.createTime).toLocaleString() : "—"}</p>
          {hasUpdated && (
            <p className="text-xs text-muted-foreground">
              {t("common.last-updated-at")}: {memo.updateTime ? timestampDate(memo.updateTime).toLocaleString() : "—"}
            </p>
          )}
        </div>
      </SidebarSection>

      {propertyBadges.length > 0 && (
        <SidebarSection label={t("common.properties")}>
          <div className="flex flex-wrap gap-1.5">
            {propertyBadges.map(({ icon: Icon, labelKey }) => (
              <span key={labelKey} className={PROPERTY_BADGE_CLASSES}>
                <Icon className="w-3.5 h-3.5" />
                {t(labelKey)}
              </span>
            ))}
          </div>
        </SidebarSection>
      )}

      {memo.tags.length > 0 && (
        <SidebarSection label={t("common.tags")} count={memo.tags.length}>
          <div className="flex flex-wrap gap-1.5">
            {memo.tags.map((tag) => (
              <span key={tag} className={TAG_BADGE_CLASSES}>
                <HashIcon className="w-3 h-3 opacity-50" />
                {tag}
              </span>
            ))}
          </div>
        </SidebarSection>
      )}

      {publishPanelOpen && <MemoPublishPanel memoName={memo.name} open={publishPanelOpen} onClose={() => setPublishPanelOpen(false)} />}
      {siteHomePanelOpen && <MemoSiteHomePanel memoName={memo.name} open={siteHomePanelOpen} onClose={() => setSiteHomePanelOpen(false)} />}
      {sharePanelOpen && <MemoSharePanel memoName={memo.name} open={sharePanelOpen} onClose={() => setSharePanelOpen(false)} />}
    </aside>
  );
};

export default MemoDetailSidebar;
