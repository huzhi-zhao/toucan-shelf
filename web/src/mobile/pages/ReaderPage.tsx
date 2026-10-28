import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { Link, List, ListItem, Navbar, NavbarBackLink, Range, Segmented, SegmentedButton, Sheet, Toast } from "konsta/react";
import { ALargeSmallIcon, ExternalLinkIcon, FileIcon, FilmIcon, ListIcon, StarIcon } from "lucide-react";
import { type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import MemoContent from "@/components/MemoContent";
import { BlockPlaceholderProvider } from "@/components/MemoContent/BlockPlaceholderContext";
import { extractWorkspaceQualifiedTitles } from "@/components/MemoContent/crossWorkspace";
import { DocumentLinkProvider, makeCrossWorkspaceResolver, resolveInWorkspace } from "@/components/MemoContent/DocumentLinkContext";
import { InlineAttachmentProvider } from "@/components/MemoContent/InlineAttachmentContext";
import { SubDocReferenceProvider } from "@/components/MemoContent/SubDocReferenceContext";
import { MemoViewContext, type MemoViewContextValue } from "@/components/MemoView/MemoViewContext";
import { useAuth } from "@/contexts/AuthContext";
import { useCrossWorkspaceTrees } from "@/hooks/useCrossWorkspaceTrees";
import { useFavorites, useToggleFavorite } from "@/hooks/useFavorites";
import { useMemoHistories, useRestoreMemoHistory } from "@/hooks/useMemoHistoryQueries";
import { useMemoComments, useMemo as useMemoQuery } from "@/hooks/useMemoQueries";
import { useWorkspace, useWorkspaceTree } from "@/hooks/useWorkspaceQueries";
import { State } from "@/types/proto/api/v1/common_pb";
import { type Memo, Memo_DocType, type MemoHistory, MemoHistory_Source } from "@/types/proto/api/v1/memo_service_pb";
import { getAttachmentThumbnailUrl, getAttachmentUrl, isAppleLivePhotoVideo, isImage } from "@/utils/attachment";
import { formatFileSize } from "@/utils/format";
import { attachmentUIDsOf, hashMemoState } from "@/utils/memoState";
import { splitChildMemos } from "@/utils/subDoc";
import { parseUrlReferences } from "@/utils/urlReferences";
import BackCapsule from "../components/BackCapsule";
import BlockPlaceholderCard from "../components/BlockPlaceholderCard";
import DocGlyph from "../components/DocGlyph";
import GridPreview from "../components/GridPreview";
import KanbanPreview from "../components/KanbanPreview";
import SectionTitle from "../components/SectionTitle";
import ViewDocument from "../components/ViewDocument";
import { COPY } from "../copy";
import { formatDate } from "../lib/format";
import { useBack, useBackLabel, useGo } from "../lib/nav";
import {
  READER_FONT_SIZE_DEFAULT,
  READER_FONT_SIZE_KEY,
  READER_FONT_SIZE_MAX,
  READER_FONT_SIZE_MIN,
  READER_LEADING_KEY,
  READER_LEADINGS,
  type ReaderLeading,
  readerZoom,
} from "../lib/reading";
import { forgetRead, rememberRead } from "../lib/recent";
import { usePref } from "../lib/storage";
import { bodyOpensWithTitle } from "../lib/title";
import { folderName } from "../lib/tree";
import { desktopDocUrl, docRoute, folderRoute, MOBILE_ROUTES } from "../routes";

/** Special blocks the phone does not render (requirement §7). Fence languages, lower-case. */
const PLACEHOLDER_BLOCKS: Record<string, string> = {
  calendar: COPY.blocks.calendar,
  "toucan-secret": COPY.blocks.secret,
};
/** Special blocks the phone draws its own read-only way (phase 3 §4), from the fence body. */
const PREVIEW_BLOCKS: Record<string, (content: string) => React.ReactNode> = {
  kanban: (content) => <KanbanPreview content={content} />,
  grid: (content) => <GridPreview content={content} />,
};
const REPLACED_LANGUAGES = new Set([...Object.keys(PLACEHOLDER_BLOCKS), ...Object.keys(PREVIEW_BLOCKS)]);
const REFERENCES_ID = "mobile-references";

/** The tabs of the panel behind the list button: the outline, the references, the attachments and the saved versions. */
type PanelTab = "outline" | "references" | "attachments" | "versions";

const previewContext = (memo: Memo): MemoViewContextValue => ({
  memo,
  creator: undefined,
  currentUser: undefined,
  parentPage: "/",
  cardWidth: 0,
  isArchived: memo.state === State.ARCHIVED,
  readonly: true,
  openEditor: () => {},
  openPreview: () => {},
});

interface OutlineEntry {
  id: string;
  text: string;
  level: number;
}

/** The reading page. It scrolls the whole document, so Safari can collapse its toolbars (requirement §8). */
export default function ReaderPage() {
  const { uid = "" } = useParams();
  const memoName = `memos/${uid}`;
  const { data: memo, error, isPending } = useMemoQuery(memoName);
  const go = useGo(memo?.title);
  const back = useBack(memo ? folderRoute(memo.workspace, memo.parent ? "" : memo.folderPath) : MOBILE_ROUTES.SHELF);

  // A recent-read entry that can no longer be opened leaves the shelf (requirement §4).
  useEffect(() => {
    if (error instanceof ConnectError && (error.code === Code.NotFound || error.code === Code.PermissionDenied)) forgetRead(memoName);
  }, [error, memoName]);

  if (isPending) return <ReaderShell onBack={back} />;
  if (!memo) {
    return (
      <ReaderShell onBack={back}>
        <div className="px-8 py-24 text-center text-black/45 dark:text-white/45">{COPY.reader.notFound}</div>
      </ReaderShell>
    );
  }
  return <ReaderDocument key={memo.name} memo={memo} onBack={back} onOpen={(name) => go(docRoute(name))} />;
}

function ReaderShell({ onBack, children }: { onBack: () => void; children?: React.ReactNode }) {
  return (
    <div className="min-h-full bg-white dark:bg-black">
      <Navbar left={<NavbarBackLink text={COPY.reader.back} showText onClick={onBack} />} />
      {children}
    </div>
  );
}

function ReaderDocument({ memo, onBack, onOpen }: { memo: Memo; onBack: () => void; onOpen: (memoName: string) => void }) {
  const { data: workspace } = useWorkspace(memo.workspace);
  // Links between documents resolve against this tree; rendering before it arrives would
  // draw every such link as broken for a moment. Coming from a folder page it is cached.
  const { data: tree = [], isPending: treePending } = useWorkspaceTree(memo.workspace, false);
  const { data: parent } = useMemoQuery(memo.parent ?? "", { enabled: !!memo.parent });
  const { data: children } = useMemoComments(memo.name);
  const subDocs = useMemo(() => splitChildMemos(children?.memos ?? []).subDocs, [children]);
  const urlReferences = useMemo(() => parseUrlReferences(memo.content).references, [memo.content]);
  const crossWorkspaceTrees = useCrossWorkspaceTrees(useMemo(() => extractWorkspaceQualifiedTitles(memo.content), [memo.content]));
  const resolveCrossWorkspace = useMemo(() => makeCrossWorkspaceResolver(crossWorkspaceTrees), [crossWorkspaceTrees]);

  const [fontSize, setFontSize] = usePref(READER_FONT_SIZE_KEY, READER_FONT_SIZE_DEFAULT);
  const [leading, setLeading] = usePref<ReaderLeading>(READER_LEADING_KEY, "normal");
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>("outline");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState("");
  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 1600);
  }, []);
  // The star toggles this document on the reading list (phase 3 §2). It is shown once the list has loaded,
  // so it never flips from empty to filled under the reader's finger.
  const { data: favorites } = useFavorites();
  const toggleFavorite = useToggleFavorite();
  const isFavorite = favorites?.some((favorite) => favorite.memo === memo.name) ?? false;
  const onToggleFavorite = () =>
    toggleFavorite.mutate(
      { memo: memo.name, favorite: !isFavorite },
      { onSuccess: () => showToast(isFavorite ? COPY.reader.unfavorited : COPY.reader.favorited) },
    );
  const [scrolled, setScrolled] = useState(false);
  const [progress, setProgress] = useState(0);
  const [outline, setOutline] = useState<OutlineEntry[]>([]);
  const [zoomedImage, setZoomedImage] = useState<string>();
  const contentRef = useRef<HTMLDivElement>(null);
  const readingStyle = { zoom: readerZoom(fontSize), "--mobile-leading": READER_LEADINGS[leading] } as React.CSSProperties;

  const isHtml = memo.docType === Memo_DocType.HTML;
  const isPdf = memo.docType === Memo_DocType.PDF;
  const isView = memo.docType === Memo_DocType.VIEW;
  const pdfAttachment = isPdf ? memo.attachments.find((a) => a.type === "application/pdf") : undefined;
  // A Live Photo's video goes with its still, so it is not listed on its own.
  const attachments = memo.attachments.filter((attachment) => !isAppleLivePhotoVideo(attachment));
  const hasReferences = subDocs.length > 0 || urlReferences.length > 0;
  // The versions the author saved on purpose; the editor's automatic ones expire and are not offered. Only the
  // author can list or switch them.
  const { currentUser } = useAuth();
  const isAuthor = !!currentUser && currentUser.name === memo.creator;
  const { data: histories = [] } = useMemoHistories(memo.name, { enabled: isAuthor });
  const savedVersions = histories.filter((history) => history.source !== MemoHistory_Source.AUTO);
  const restoreHistory = useRestoreMemoHistory();
  // As on the desktop: switching is refused while the document has changes no version holds.
  const switchVersion = async (history: MemoHistory) => {
    if (!window.confirm(COPY.reader.confirmSwitchVersion(history.displayName || COPY.reader.unnamedVersion))) return;
    const current = await hashMemoState(memo.content, attachmentUIDsOf(memo));
    if (!histories.some((h) => h.contentHash === current)) {
      showToast(COPY.reader.switchVersionBlocked);
      return;
    }
    restoreHistory.mutate(
      { historyName: history.name, memoName: memo.name },
      {
        onSuccess: () => {
          setOutlineOpen(false);
          showToast(COPY.reader.versionSwitched);
        },
        onError: () => showToast(COPY.reader.switchVersionBlocked),
      },
    );
  };
  // Only the tabs with something in them; the panel opens on the outline when there is one.
  const panelTabs = (
    [
      ["outline", outline.length > 0],
      ["references", hasReferences],
      ["attachments", attachments.length > 0],
      ["versions", savedVersions.length > 0],
    ] as const
  )
    .filter(([, shown]) => shown)
    .map(([tab]) => tab);
  const openPanel = () => {
    setPanelTab(panelTabs[0]);
    setOutlineOpen(true);
  };
  const showTitle = isPdf || isView || isHtml || !bodyOpensWithTitle(memo.content, memo.title);
  // The back button names where it goes: the page it came from, else the parent document,
  // the folder or the knowledge base (opened from a deep link).
  const backText =
    useBackLabel() || parent?.title || (memo.parent ? "" : folderName(memo.folderPath)) || workspace?.title || COPY.reader.back;
  const pathLabel = [workspace?.title, ...(memo.parent ? [] : memo.folderPath.split("/").filter(Boolean))].filter(Boolean).join(" / ");

  useEffect(() => {
    rememberRead({ memoName: memo.name, title: memo.title, icon: memo.icon, workspaceTitle: workspace?.title ?? "" });
  }, [memo.name, memo.title, memo.icon, workspace?.title]);

  useEffect(() => {
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setScrolled(window.scrollY > 80);
      setProgress(max > 0 ? Math.min(1, window.scrollY / max) : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // The outline is read off the rendered headings (the renderer assigns their ids),
  // so it always matches what is on screen, embeds included.
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const collect = () =>
      setOutline(
        Array.from(el.querySelectorAll<HTMLElement>("h2[id], h3[id]")).map((h) => ({
          id: h.id,
          text: h.textContent?.trim() ?? "",
          level: h.tagName === "H3" ? 3 : 2,
        })),
      );
    collect();
    const observer = new MutationObserver(collect);
    observer.observe(el, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const copyDesktopLink = useCallback(() => {
    void navigator.clipboard?.writeText(desktopDocUrl(memo.name)).catch(() => {});
    showToast(COPY.reader.copied);
  }, [memo.name, showToast]);

  const placeholders = useMemo(
    () => ({
      languages: REPLACED_LANGUAGES,
      render: (language: string, content: string) =>
        PREVIEW_BLOCKS[language]?.(content) ?? (
          <BlockPlaceholderCard title={PLACEHOLDER_BLOCKS[language]} onCopyDesktopLink={copyDesktopLink} />
        ),
    }),
    [copyDesktopLink],
  );

  const links = useMemo(
    () => ({
      baseFolderPath: memo.folderPath,
      resolve: (href: string) => resolveInWorkspace(tree, memo.folderPath, href),
      resolveFrom: (base: string, href: string) => resolveInWorkspace(tree, base, href),
      resolveCrossWorkspace,
      navigate: (target: string) => onOpen(target),
    }),
    [tree, memo.folderPath, resolveCrossWorkspace, onOpen],
  );

  const subDocReferences = useMemo(
    () => ({
      parentMemoName: memo.name,
      subDocs: subDocs.map((s) => ({ name: s.name, title: s.title })),
      onJump: () => document.getElementById(REFERENCES_ID)?.scrollIntoView({ behavior: "smooth", block: "center" }),
    }),
    [memo.name, subDocs],
  );

  // Tapping an image opens it full screen; the renderer itself has no viewer. An image inside a link or a
  // button (a gallery card's cover) belongs to that control, so the tap goes there instead.
  const onContentClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    if (target instanceof HTMLImageElement && !target.closest("a, button")) setZoomedImage(target.currentSrc || target.src);
  };

  const scrollToHeading = (id: string) => {
    setOutlineOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // The sub-documents and the external links, at the end of the document and in the panel's references tab.
  const referenceLists = (
    <>
      {subDocs.length > 0 && (
        <List strongIos insetIos dividersIos className="!my-0">
          {subDocs.map((sub) => (
            <ListItem
              key={sub.name}
              link
              title={sub.title}
              media={<DocGlyph icon={sub.icon} size={22} />}
              onClick={() => onOpen(sub.name)}
            />
          ))}
        </List>
      )}
      {urlReferences.length > 0 && (
        <List strongIos insetIos dividersIos className={subDocs.length > 0 ? "!mt-4 !mb-0" : "!my-0"}>
          {urlReferences.map((ref) => (
            <ListItem
              key={ref.url}
              link
              chevron={false}
              title={<span className="truncate block">{ref.url.replace(/^https?:\/\//, "")}</span>}
              text={ref.note || undefined}
              after={<ExternalLinkIcon className="w-4 h-4" />}
              href={ref.url}
              target="_blank"
            />
          ))}
        </List>
      )}
    </>
  );

  const body = treePending ? (
    <div className="space-y-3 animate-pulse" aria-hidden>
      <div className="h-4 rounded bg-black/[0.06] dark:bg-white/[0.08] w-11/12" />
      <div className="h-4 rounded bg-black/[0.06] dark:bg-white/[0.08] w-full" />
      <div className="h-4 rounded bg-black/[0.06] dark:bg-white/[0.08] w-3/4" />
    </div>
  ) : isPdf ? (
    // Safari's own PDF viewer is the best reader on a phone (requirement §5).
    pdfAttachment && (
      <a
        href={getAttachmentUrl(pdfAttachment)}
        target="_blank"
        rel="noreferrer"
        className="flex items-center justify-between rounded-2xl bg-black/[0.04] dark:bg-white/[0.07] p-4 text-[16px] active:opacity-60"
      >
        <span className="truncate">{pdfAttachment.filename}</span>
        <span className="flex items-center gap-1 text-primary shrink-0">
          {COPY.reader.pdfOpen}
          <ExternalLinkIcon className="w-4 h-4" />
        </span>
      </a>
    )
  ) : (
    <MemoViewContext.Provider value={previewContext(memo)}>
      <InlineAttachmentProvider attachments={memo.attachments}>
        <SubDocReferenceProvider value={subDocReferences}>
          <DocumentLinkProvider value={links}>
            <BlockPlaceholderProvider value={placeholders}>
              {isView ? (
                // A view's text blocks follow the reading settings; its card walls keep their size.
                <ViewDocument memo={memo} onOpen={onOpen} textStyle={readingStyle} />
              ) : (
                <MemoContent content={memo.content} memoName={memo.name} density="reading" alwaysExpanded isHtml={isHtml} />
              )}
            </BlockPlaceholderProvider>
          </DocumentLinkProvider>
        </SubDocReferenceProvider>
      </InlineAttachmentProvider>
    </MemoViewContext.Provider>
  );

  return (
    <div className="mobile-reader min-h-full bg-white dark:bg-black">
      <Navbar
        title={scrolled ? memo.title : ""}
        centerTitle
        titleClassName="max-w-[52vw] truncate"
        // Opened from the shelf, back already goes there.
        left={<BackCapsule text={backText} onBack={onBack} shelf={backText !== COPY.shelf.title} />}
        right={
          // Konsta's icon links are squares as tall as their container. Filling the glass capsule's height makes
          // each one a 44pt target with its icon centred, so the capsule has even room on both ends.
          <div className="flex h-full items-center">
            {panelTabs.length > 0 && (
              <Link iconOnly onClick={openPanel} aria-label={COPY.reader.outline}>
                <ListIcon className="w-6 h-6" />
              </Link>
            )}
            {favorites && (
              <Link
                iconOnly
                onClick={onToggleFavorite}
                aria-label={isFavorite ? COPY.reader.unfavorite : COPY.reader.favorite}
                aria-pressed={isFavorite}
              >
                <StarIcon className={isFavorite ? "w-6 h-6 text-[#ff9f0a]" : "w-6 h-6"} fill={isFavorite ? "currentColor" : "none"} />
              </Link>
            )}
            <Link iconOnly onClick={() => setSettingsOpen(true)} aria-label={COPY.reader.settings}>
              <ALargeSmallIcon className="w-6 h-6" />
            </Link>
          </div>
        }
        subnavbar={
          <div className="absolute left-0 right-0 bottom-0 h-[2px]">
            <div className="h-full bg-primary origin-left" style={{ transform: `scaleX(${progress})` }} />
          </div>
        }
        subnavbarClassName="h-0"
      />

      <article className="mobile-selectable px-4 pt-14 pb-[calc(40px+env(safe-area-inset-bottom))] max-w-[720px] mx-auto">
        {pathLabel && <div className="text-[13px] text-black/45 dark:text-white/45 truncate">{pathLabel}</div>}
        {showTitle && (
          <h1 className="mt-2 text-[28px] font-bold leading-tight tracking-tight flex gap-2 items-start">
            {memo.icon && <span>{memo.icon}</span>}
            <span>{memo.title}</span>
          </h1>
        )}
        <div className="mt-1.5 mb-6 text-[13px] text-black/45 dark:text-white/45">
          {COPY.reader.updatedAt(formatDate(memo.updateTime))}
          {parent && (
            <>
              {` · ${COPY.reader.belongsTo} `}
              <button type="button" className="text-primary" onClick={() => onOpen(parent.name)}>
                {parent.title}
              </button>
            </>
          )}
        </div>

        <div ref={contentRef} onClick={onContentClick} style={isView ? undefined : readingStyle}>
          {body}
        </div>

        {hasReferences && (
          <div id={REFERENCES_ID} className="mt-10 -mx-4">
            <SectionTitle>{COPY.reader.references}</SectionTitle>
            {referenceLists}
          </div>
        )}
      </article>

      <Sheet className="pb-safe w-full max-h-[70vh] rounded-t-2xl" opened={outlineOpen} onBackdropClick={() => setOutlineOpen(false)}>
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-black/15 dark:bg-white/20" />
        {panelTabs.length > 1 ? (
          <div className="mx-4 mt-3 mb-2">
            <Segmented strong>
              {panelTabs.map((tab) => (
                <SegmentedButton key={tab} active={panelTab === tab} onClick={() => setPanelTab(tab)}>
                  {COPY.reader.panelTabs[tab]}
                </SegmentedButton>
              ))}
            </Segmented>
          </div>
        ) : (
          <SectionTitle className="mt-3">{COPY.reader.panelTabs[panelTab]}</SectionTitle>
        )}
        <div className="overflow-y-auto max-h-[calc(70vh-64px)] pb-4">
          {panelTab === "outline" && (
            <List strongIos dividersIos className="!my-0">
              {outline.map((entry) => (
                <ListItem
                  key={entry.id}
                  link
                  chevron={false}
                  title={<span className={entry.level === 3 ? "pl-4 text-[15px]" : ""}>{entry.text}</span>}
                  onClick={() => scrollToHeading(entry.id)}
                />
              ))}
            </List>
          )}
          {panelTab === "references" && referenceLists}
          {panelTab === "versions" && (
            <List strongIos insetIos dividersIos className="!my-0">
              {savedVersions.map((history) => (
                <ListItem
                  key={history.name}
                  link
                  chevron={false}
                  title={<span className="truncate block">{history.displayName || COPY.reader.unnamedVersion}</span>}
                  text={history.createTime ? timestampDate(history.createTime).toLocaleString() : undefined}
                  onClick={() => !restoreHistory.isPending && switchVersion(history)}
                />
              ))}
            </List>
          )}
          {panelTab === "attachments" && (
            <List strongIos insetIos dividersIos className="!my-0">
              {attachments.map((attachment) => {
                const image = isImage(attachment.type);
                return (
                  <ListItem
                    key={attachment.name}
                    link
                    chevron={false}
                    title={<span className="truncate block">{attachment.filename}</span>}
                    after={attachment.size ? formatFileSize(Number(attachment.size)) : undefined}
                    media={
                      image ? (
                        <img src={getAttachmentThumbnailUrl(attachment)} alt="" className="h-9 w-9 rounded-md object-cover" />
                      ) : attachment.type.startsWith("video/") ? (
                        <FilmIcon className="h-6 w-6 text-black/45 dark:text-white/45" />
                      ) : (
                        <FileIcon className="h-6 w-6 text-black/45 dark:text-white/45" />
                      )
                    }
                    // An image opens in the page's viewer; anything else in the browser's (Safari plays a video, shows a PDF).
                    {...(image
                      ? {
                          onClick: () => {
                            setOutlineOpen(false);
                            setZoomedImage(getAttachmentUrl(attachment));
                          },
                        }
                      : { href: getAttachmentUrl(attachment), target: "_blank" })}
                  />
                );
              })}
            </List>
          )}
        </div>
      </Sheet>

      <Sheet className="pb-safe w-full rounded-t-2xl" opened={settingsOpen} onBackdropClick={() => setSettingsOpen(false)}>
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-black/15 dark:bg-white/20" />
        <SectionTitle className="mt-3">{COPY.reader.fontSize}</SectionTitle>
        <div className="flex items-center gap-3 px-4">
          <span className="text-[13px]">A</span>
          <div className="flex-1">
            <Range
              value={fontSize}
              min={READER_FONT_SIZE_MIN}
              max={READER_FONT_SIZE_MAX}
              step={1}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFontSize(Number(e.target.value))}
            />
          </div>
          <span className="text-[22px]">A</span>
        </div>
        <SectionTitle className="mt-5">{COPY.reader.lineHeight}</SectionTitle>
        <div className="px-4 pb-6">
          <Segmented strong>
            {(Object.keys(READER_LEADINGS) as ReaderLeading[]).map((key) => (
              <SegmentedButton key={key} active={leading === key} onClick={() => setLeading(key)}>
                {COPY.reader.leading[key]}
              </SegmentedButton>
            ))}
          </Segmented>
        </div>
      </Sheet>

      {zoomedImage && (
        <button
          type="button"
          className="fixed inset-0 z-50 bg-black flex items-center justify-center"
          onClick={() => setZoomedImage(undefined)}
          aria-label={COPY.reader.back}
        >
          <img src={zoomedImage} alt="" className="max-w-full max-h-full object-contain" />
        </button>
      )}

      <Toast position="center" opened={toast !== ""}>
        {toast}
      </Toast>
    </div>
  );
}
