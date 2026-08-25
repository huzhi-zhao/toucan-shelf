import {
  BookTextIcon,
  CalendarDaysIcon,
  ChevronDownIcon,
  FileIcon,
  FileTextIcon,
  GlobeIcon,
  GripVerticalIcon,
  LayoutGridIcon,
  ListIcon,
  type LucideIcon,
  PaperclipIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useMemos } from "@/hooks/useMemoQueries";
import { cn } from "@/lib/utils";
import type { Attachment } from "@/types/proto/api/v1/attachment_service_pb";
import { State } from "@/types/proto/api/v1/common_pb";
import { Memo_DocType } from "@/types/proto/api/v1/memo_service_pb";
import { formatFileSize, getFileTypeLabel } from "@/utils/format";
import { useTranslate } from "@/utils/i18n";
import {
  ALL_WORKSPACES,
  DEFAULT_BADGE_COLOR,
  DEFAULT_CALENDAR_LAYOUT_BLOCK,
  DEFAULT_GALLERY_BLOCK,
  DEFAULT_PUBLIC_FEED_BLOCK,
  DEFAULT_PUBLIC_GALLERY_BLOCK,
  type GalleryBadgeKind,
  type GalleryBadgeRule,
  type GalleryCardField,
  type GalleryCoverRule,
  type GalleryGroup,
  type GalleryMatch,
  type GalleryRule,
  type GalleryScope,
  type GallerySort,
  MAX_GALLERY_BADGES,
  type PublicFeedBlock,
  type PublicGalleryBlock,
  parseGalleryViewConfig,
  serializeGalleryViewConfig,
  type ViewBlock,
} from "./types";

interface Props {
  content: string;
  /** Workspace of the view document, scoping the document picker's candidate list. */
  workspace?: string;
  /** Resource name of the view document itself, excluded from the document picker. */
  memoName?: string;
  /** Attachments mounted on this view document, shown as a section in the editor. */
  attachments?: Attachment[];
  onSave: (content: string) => void;
  onCancel: () => void;
  /** Uploads and mounts files onto the view document. When absent, the attachment section is hidden. */
  onAddAttachments?: (files: File[]) => void | Promise<void>;
  onRemoveAttachment?: (name: string) => void | Promise<void>;
  /**
   * Knowledge bases a block's scope may target. Only the Home document passes
   * this; without it every block scans the view document's own knowledge base,
   * which is what an ordinary view has always done.
   */
  workspaceOptions?: { name: string; title: string }[];
  /**
   * Which block vocabulary this document speaks.
   *
   * "library" (a `.view`) composes live knowledge-base data: galleries,
   * calendars, document references. "site" (a `.blogview`) composes a published
   * site's home page out of publication snapshots. The two sets are disjoint —
   * each renderer ignores the other's blocks — so the editor offers one set or
   * the other rather than both.
   */
  variant?: "library" | "site";
}

// UI state for one card-field row: a "kind" (built-in token or "property") plus
// the property key used when kind === "property". "none" is a UI sentinel
// (Radix Select forbids empty-string item values) serializing to "".
interface CardFieldState {
  kind: "__title__" | "__updated__" | "__created__" | "none" | "property";
  propKey: string;
}

// Editable draft of one scope rule. Keeps every field's input around
// regardless of `kind`, so switching kinds never loses typed input.
interface RuleDraft {
  kind: "folder" | "tag" | "property";
  folderPath: string;
  includeSubfolders: boolean;
  tag: string;
  propKey: string;
  propValue: string;
}

interface GroupDraft {
  match: GalleryMatch;
  rules: RuleDraft[];
}

// Editable draft of a single gallery block. Keeps UI-only shape (scope split
// into groups of rules, card fields split into kind + propKey) so toggling
// options never loses typed input; converted to a GalleryBlock on save.
interface GalleryDraft {
  type: "gallery";
  collapsed?: boolean;
  scopeMatch: GalleryMatch;
  groups: GroupDraft[];
  /** Knowledge bases scanned; empty = the view document's own. Home only. */
  scopeWorkspaces: string[];
  sort: GallerySort;
  cover: GalleryCoverRule;
  primary: CardFieldState;
  secondary: CardFieldState;
  badges: GalleryBadgeRule[];
}

/** Editable draft of a calendar layout block (shares the scope draft shape). */
interface CalendarDraft {
  type: "calendar";
  collapsed?: boolean;
  scopeMatch: GalleryMatch;
  groups: GroupDraft[];
  /** Knowledge bases scanned; empty = the view document's own. Home only. */
  scopeWorkspaces: string[];
  dateProperty: string;
  cardField: CardFieldState;
  newDocFolder: string;
  cellUnit: "day" | "week";
}

/**
 * Editable draft of a markdown block. `docName` set means the block renders a
 * referenced knowledge-base document instead of `content`; the typed markdown is
 * kept around either way so switching sources never loses it.
 */
interface MarkdownDraft {
  type: "markdown";
  content: string;
  docName?: string;
  collapsed?: boolean;
}

/**
 * Editable drafts of the outward-facing blocks.
 *
 * Tags, slugs and the limit are held as the text the author typed, so a
 * half-written entry survives a re-render; they are split and dropped on save.
 * The whole configuration is deliberately this small — a published snapshot has
 * no folder and no frontmatter properties to filter on.
 */
interface PublicGalleryDraft {
  type: "public_gallery";
  collapsed?: boolean;
  tags: string;
  sort: "manual" | "updated_desc";
  slugs: string;
  limit: string;
  columns: 2 | 3 | 4;
}

interface PublicFeedDraft {
  type: "public_feed";
  collapsed?: boolean;
  title: string;
  tags: string;
  showTopicFilter: boolean;
  limit: string;
}

type BlockDraft = GalleryDraft | CalendarDraft | MarkdownDraft | PublicGalleryDraft | PublicFeedDraft;

/** Comma-separated input ⇄ stored list. Blank entries never make it through. */
const splitList = (raw: string): string[] =>
  raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");

// A limit is optional: a blank or nonsensical one means "everything the block
// covers", which is what a reader gets when the author has not decided yet.
const parseLimitInput = (raw: string): number | undefined => {
  const value = Number(raw.trim());
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : undefined;
};

const DEFAULT_BADGE_DRAFT: GalleryBadgeRule = {
  kind: "tag",
  title: "",
  color: DEFAULT_BADGE_COLOR,
  propertyKey: "",
  propertyValue: "",
};

function toCardFieldState(field: GalleryCardField): CardFieldState {
  if (field.startsWith("prop:")) return { kind: "property", propKey: field.slice(5) };
  if (field === "") return { kind: "none", propKey: "" };
  if (field === "__title__" || field === "__updated__" || field === "__created__") {
    return { kind: field as CardFieldState["kind"], propKey: "" };
  }
  return { kind: "__title__", propKey: "" };
}

function fromCardFieldState(state: CardFieldState): GalleryCardField {
  if (state.kind === "property") return `prop:${state.propKey.trim()}`;
  if (state.kind === "none") return "";
  return state.kind;
}

const DEFAULT_RULE_DRAFT: RuleDraft = {
  kind: "folder",
  folderPath: "",
  includeSubfolders: true,
  tag: "",
  propKey: "",
  propValue: "",
};

function toRuleDraft(rule: GalleryRule): RuleDraft {
  if (rule.kind === "tag") return { ...DEFAULT_RULE_DRAFT, kind: "tag", tag: rule.tag };
  if (rule.kind === "property")
    return {
      ...DEFAULT_RULE_DRAFT,
      kind: "property",
      propKey: rule.key,
      propValue: rule.value,
    };
  return {
    ...DEFAULT_RULE_DRAFT,
    kind: "folder",
    folderPath: rule.path ?? "",
    includeSubfolders: rule.includeSubfolders ?? true,
  };
}

// Converts a rule draft back to a GalleryRule, or undefined when the rule is
// incomplete (empty tag / property key) and should be dropped on save.
function fromRuleDraft(draft: RuleDraft): GalleryRule | undefined {
  if (draft.kind === "tag") {
    const tag = draft.tag.trim();
    return tag ? { kind: "tag", tag } : undefined;
  }
  if (draft.kind === "property") {
    const key = draft.propKey.trim();
    return key ? { kind: "property", key, value: draft.propValue } : undefined;
  }
  return {
    kind: "folder",
    path: draft.folderPath.trim() || undefined,
    includeSubfolders: draft.includeSubfolders,
  };
}

function toGroupDraft(group: GalleryGroup): GroupDraft {
  return { match: group.match, rules: group.rules.map(toRuleDraft) };
}

function toDraft(block: ViewBlock): BlockDraft {
  if (block.type === "markdown") return { type: "markdown", content: block.content, docName: block.docName };
  if (block.type === "public_gallery")
    return {
      type: "public_gallery",
      tags: block.tags.join(", "),
      sort: block.sort,
      slugs: (block.slugs ?? []).join(", "),
      limit: block.limit ? String(block.limit) : "",
      columns: block.columns,
    };
  if (block.type === "public_feed")
    return {
      type: "public_feed",
      title: block.title,
      tags: block.tags.join(", "),
      showTopicFilter: block.showTopicFilter,
      limit: block.limit ? String(block.limit) : "",
    };
  if (block.type === "calendar")
    return {
      type: "calendar",
      scopeMatch: block.scope.match,
      groups: block.scope.groups.length > 0 ? block.scope.groups.map(toGroupDraft) : [{ match: "all", rules: [{ ...DEFAULT_RULE_DRAFT }] }],
      scopeWorkspaces: block.scope.workspaces ?? [],
      dateProperty: block.dateProperty,
      cardField: toCardFieldState(block.cardField),
      newDocFolder: block.newDocFolder,
      cellUnit: block.cellUnit,
    };
  return {
    type: "gallery",
    scopeMatch: block.scope.match,
    groups: block.scope.groups.length > 0 ? block.scope.groups.map(toGroupDraft) : [{ match: "all", rules: [{ ...DEFAULT_RULE_DRAFT }] }],
    scopeWorkspaces: block.scope.workspaces ?? [],
    sort: block.sort,
    cover: block.cover,
    primary: toCardFieldState(block.cardFields.primary),
    secondary: toCardFieldState(block.cardFields.secondary),
    badges: block.badges,
  };
}

// Groups/rules that are incomplete (empty tag / property key) are dropped;
// groups left with no rules are dropped entirely.
function effectiveGroups(draft: { groups: GroupDraft[] }): GalleryGroup[] {
  return draft.groups
    .map((g) => ({
      match: g.match,
      rules: g.rules.map(fromRuleDraft).filter((r): r is GalleryRule => r !== undefined),
    }))
    .filter((g) => g.rules.length > 0);
}

// Badges missing a property key can never match a card, so they're dropped on save.
function effectiveBadges(draft: GalleryDraft): GalleryBadgeRule[] {
  return draft.badges
    .filter((b) => b.propertyKey.trim() !== "")
    .map((b) => ({
      ...b,
      title: b.title.slice(0, 5),
      propertyKey: b.propertyKey.trim(),
    }))
    .slice(0, MAX_GALLERY_BADGES);
}

// Builds a block's stored scope. `workspaces` is omitted when nothing is
// selected, so ordinary views keep serializing exactly as before.
function scopeOf(draft: GalleryDraft | CalendarDraft): GalleryScope {
  const workspaces = draft.scopeWorkspaces.filter((w) => w.trim() !== "");
  return { match: draft.scopeMatch, groups: effectiveGroups(draft), ...(workspaces.length > 0 ? { workspaces } : {}) };
}

function fromDraft(draft: BlockDraft): ViewBlock {
  if (draft.type === "public_gallery") {
    const slugs = splitList(draft.slugs);
    const block: PublicGalleryBlock = {
      type: "public_gallery",
      tags: splitList(draft.tags),
      // A manual order with nothing listed would publish an empty section.
      sort: draft.sort === "manual" && slugs.length > 0 ? "manual" : "updated_desc",
      ...(slugs.length > 0 ? { slugs } : {}),
      limit: parseLimitInput(draft.limit),
      columns: draft.columns,
    };
    return block;
  }
  if (draft.type === "public_feed") {
    const block: PublicFeedBlock = {
      type: "public_feed",
      title: draft.title.trim() || DEFAULT_PUBLIC_FEED_BLOCK.title,
      tags: splitList(draft.tags),
      showTopicFilter: draft.showTopicFilter,
      limit: parseLimitInput(draft.limit),
    };
    return block;
  }
  if (draft.type === "markdown")
    return draft.docName
      ? { type: "markdown", content: draft.content, docName: draft.docName }
      : { type: "markdown", content: draft.content };
  if (draft.type === "calendar")
    return {
      type: "calendar",
      scope: scopeOf(draft),
      dateProperty: draft.dateProperty.trim(),
      cardField: fromCardFieldState(draft.cardField),
      newDocFolder: draft.newDocFolder.trim(),
      cellUnit: draft.cellUnit,
    };
  return {
    type: "gallery",
    scope: scopeOf(draft),
    sort: draft.sort,
    cover: draft.cover,
    cardFields: {
      primary: fromCardFieldState(draft.primary),
      secondary: fromCardFieldState(draft.secondary),
    },
    badges: effectiveBadges(draft),
  };
}

function blockInvalid(draft: BlockDraft): boolean {
  // A markdown block is never invalid — an empty one is simply dropped on save.
  // Neither is an outward-facing one: every field on it is optional, and a
  // gallery with no tags is the whole site, which is a real arrangement.
  // Gallery and calendar blocks need at least one complete scope rule.
  if (draft.type === "markdown" || draft.type === "public_gallery" || draft.type === "public_feed") return false;
  return effectiveGroups(draft).length === 0;
}

// Knowledge-base selector for a block's scope, shown only on the Home document
// (an ordinary view always scans its own knowledge base). An empty selection
// means "this document's knowledge base"; `ALL_WORKSPACES` means every visible
// one and is mutually exclusive with naming individual bases.
const WorkspaceScopePicker = ({
  options,
  selected,
  onChange,
}: {
  options: { name: string; title: string }[];
  selected: string[];
  onChange: (value: string[]) => void;
}) => {
  const t = useTranslate();
  const isAll = selected.includes(ALL_WORKSPACES);
  const toggle = (name: string) => {
    if (name === ALL_WORKSPACES) {
      onChange(isAll ? [] : [ALL_WORKSPACES]);
      return;
    }
    const withoutAll = selected.filter((w) => w !== ALL_WORKSPACES);
    onChange(withoutAll.includes(name) ? withoutAll.filter((w) => w !== name) : [...withoutAll, name]);
  };
  const label = isAll
    ? t("gallery.workspace-scope-all")
    : selected.length === 0
      ? t("gallery.workspace-scope-current")
      : options
          .filter((o) => selected.includes(o.name))
          .map((o) => o.title)
          .join(", ");

  return (
    <div className="flex items-center gap-2">
      <Label className="shrink-0">{t("gallery.workspace-scope-label")}</Label>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="max-w-[16rem] justify-between">
            <span className="truncate">{label}</span>
            <ChevronDownIcon className="w-4 h-4 ml-1 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              toggle(ALL_WORKSPACES);
            }}
          >
            <Checkbox checked={isAll} className="mr-2" />
            {t("gallery.workspace-scope-all")}
          </DropdownMenuItem>
          {options.map((option) => (
            <DropdownMenuItem
              key={option.name}
              onSelect={(e) => {
                e.preventDefault();
                toggle(option.name);
              }}
            >
              <Checkbox checked={!isAll && selected.includes(option.name)} className="mr-2" />
              <span className="truncate">{option.title}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

// The scope editor (groups of folder/tag/property rules), shared by the gallery
// and calendar block forms. Patches the owning draft's `scopeMatch` / `groups`.
const ScopeEditor = ({
  index,
  scopeMatch,
  groups,
  scopeWorkspaces,
  workspaceOptions,
  onChange,
}: {
  index: number;
  scopeMatch: GalleryMatch;
  groups: GroupDraft[];
  scopeWorkspaces: string[];
  /** Selectable knowledge bases. Absent (ordinary views) hides the selector entirely. */
  workspaceOptions?: { name: string; title: string }[];
  onChange: (patch: { scopeMatch?: GalleryMatch; groups?: GroupDraft[]; scopeWorkspaces?: string[] }) => void;
}) => {
  const t = useTranslate();

  const updateGroup = (gi: number, patch: Partial<GroupDraft>) => {
    onChange({ groups: groups.map((g, i) => (i === gi ? { ...g, ...patch } : g)) });
  };
  const updateRule = (gi: number, ri: number, patch: Partial<RuleDraft>) => {
    onChange({
      groups: groups.map((g, i) => (i === gi ? { ...g, rules: g.rules.map((r, j) => (j === ri ? { ...r, ...patch } : r)) } : g)),
    });
  };
  const removeRule = (gi: number, ri: number) => {
    onChange({ groups: groups.map((g, i) => (i === gi ? { ...g, rules: g.rules.filter((_, j) => j !== ri) } : g)) });
  };
  const addRule = (gi: number) => {
    onChange({ groups: groups.map((g, i) => (i === gi ? { ...g, rules: [...g.rules, { ...DEFAULT_RULE_DRAFT }] } : g)) });
  };
  const addGroup = () => onChange({ groups: [...groups, { match: "all", rules: [{ ...DEFAULT_RULE_DRAFT }] }] });
  const removeGroup = (gi: number) => onChange({ groups: groups.filter((_, i) => i !== gi) });

  const renderRule = (rule: RuleDraft, gi: number, ri: number) => (
    <div key={ri} className="flex items-start gap-2">
      <Select value={rule.kind} onValueChange={(v) => updateRule(gi, ri, { kind: v as RuleDraft["kind"] })}>
        <SelectTrigger className="w-28 shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="folder">{t("gallery.rule-kind-folder")}</SelectItem>
          <SelectItem value="tag">{t("gallery.rule-kind-tag")}</SelectItem>
          <SelectItem value="property">{t("gallery.rule-kind-property")}</SelectItem>
        </SelectContent>
      </Select>
      <div className="flex-1 flex flex-col gap-2">
        {rule.kind === "folder" && (
          <>
            <Input
              placeholder={t("gallery.folder-path-placeholder")}
              value={rule.folderPath}
              onChange={(e) => updateRule(gi, ri, { folderPath: e.target.value })}
            />
            <div className="flex items-center gap-2">
              <Checkbox
                id={`rule-this-folder-only-${index}-${gi}-${ri}`}
                checked={!rule.includeSubfolders}
                onCheckedChange={(checked) => updateRule(gi, ri, { includeSubfolders: !checked })}
              />
              <Label htmlFor={`rule-this-folder-only-${index}-${gi}-${ri}`} className="font-normal cursor-pointer text-sm">
                {t("gallery.scope-this-folder-only")}
              </Label>
            </div>
          </>
        )}
        {rule.kind === "tag" && (
          <Input
            placeholder={t("gallery.tag-placeholder")}
            value={rule.tag}
            onChange={(e) => updateRule(gi, ri, { tag: e.target.value })}
          />
        )}
        {rule.kind === "property" && (
          <div className="flex items-center gap-2">
            <Input
              className="flex-1"
              placeholder={t("gallery.property-key-placeholder")}
              value={rule.propKey}
              onChange={(e) => updateRule(gi, ri, { propKey: e.target.value })}
            />
            <span className="text-muted-foreground text-sm">=</span>
            <Input
              className="flex-1"
              placeholder={t("gallery.property-value-placeholder")}
              value={rule.propValue}
              onChange={(e) => updateRule(gi, ri, { propValue: e.target.value })}
            />
          </div>
        )}
      </div>
      <Button variant="ghost" size="icon" className="shrink-0" onClick={() => removeRule(gi, ri)}>
        <XIcon className="w-4 h-4" />
      </Button>
    </div>
  );

  return (
    <div className="flex flex-col gap-2">
      {workspaceOptions && (
        <WorkspaceScopePicker options={workspaceOptions} selected={scopeWorkspaces} onChange={(v) => onChange({ scopeWorkspaces: v })} />
      )}
      <div className="flex items-center gap-2">
        <Label className="shrink-0">{t("gallery.scope-label")}</Label>
        <span className="text-sm text-muted-foreground">{t("gallery.match-label")}</span>
        <Select value={scopeMatch} onValueChange={(v) => onChange({ scopeMatch: v as GalleryMatch })}>
          <SelectTrigger className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("gallery.match-all")}</SelectItem>
            <SelectItem value="any">{t("gallery.match-any")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {groups.map((group, gi) => (
        <div key={gi} className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{t("gallery.group-title", { index: gi + 1 })}</span>
              <Select value={group.match} onValueChange={(v) => updateGroup(gi, { match: v as GalleryMatch })}>
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("gallery.match-all")}</SelectItem>
                  <SelectItem value="any">{t("gallery.match-any")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {groups.length > 1 && (
              <Button variant="ghost" size="icon" onClick={() => removeGroup(gi)}>
                <Trash2Icon className="w-4 h-4" />
              </Button>
            )}
          </div>
          {group.rules.map((rule, ri) => renderRule(rule, gi, ri))}
          <Button variant="outline" size="sm" className="self-start" onClick={() => addRule(gi)}>
            <PlusIcon className="w-4 h-4 mr-1" />
            {t("gallery.add-rule")}
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" className="self-start" onClick={addGroup}>
        <PlusIcon className="w-4 h-4 mr-1" />
        {t("gallery.add-group")}
      </Button>
    </div>
  );
};

// One card-field row (a "kind" select plus a property-key input), shared by the
// gallery card fields and the calendar tile label.
const CardFieldRow = ({
  label,
  state,
  allowNone,
  onChange,
}: {
  label: string;
  state: CardFieldState;
  allowNone: boolean;
  onChange: (state: CardFieldState) => void;
}) => {
  const t = useTranslate();
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <Select value={state.kind} onValueChange={(v) => onChange({ ...state, kind: v as CardFieldState["kind"] })}>
          <SelectTrigger className="flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__title__">{t("gallery.field-title")}</SelectItem>
            <SelectItem value="__updated__">{t("gallery.field-updated")}</SelectItem>
            <SelectItem value="__created__">{t("gallery.field-created")}</SelectItem>
            <SelectItem value="property">{t("gallery.field-property")}</SelectItem>
            {allowNone && <SelectItem value="none">{t("gallery.field-none")}</SelectItem>}
          </SelectContent>
        </Select>
        {state.kind === "property" && (
          <Input
            className="flex-1"
            placeholder={t("gallery.property-key-placeholder")}
            value={state.propKey}
            onChange={(e) => onChange({ ...state, propKey: e.target.value })}
          />
        )}
      </div>
    </div>
  );
};

// One editable calendar layout block. Controlled via `draft` / `onChange`.
const CalendarLayoutBlockForm = ({
  draft,
  index,
  onChange,
  onRemove,
  onToggleCollapse,
  dragHandlers,
  workspaceOptions,
}: {
  draft: CalendarDraft;
  index: number;
  onChange: (patch: Partial<CalendarDraft>) => void;
  onRemove: () => void;
  onToggleCollapse: () => void;
  dragHandlers: React.HTMLAttributes<HTMLDivElement> & { draggable: boolean };
  workspaceOptions?: { name: string; title: string }[];
}) => {
  const t = useTranslate();

  if (draft.collapsed) {
    return (
      <BlockHeader
        icon={CalendarDaysIcon}
        title={t("gallery.calendar-block-title", { index: index + 1 })}
        collapsed
        onToggleCollapse={onToggleCollapse}
        onRemove={onRemove}
        dragHandlers={dragHandlers}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <BlockHeader
        icon={CalendarDaysIcon}
        title={t("gallery.calendar-block-title", { index: index + 1 })}
        collapsed={false}
        onToggleCollapse={onToggleCollapse}
        onRemove={onRemove}
        dragHandlers={dragHandlers}
      />

      <ScopeEditor
        index={index}
        scopeMatch={draft.scopeMatch}
        groups={draft.groups}
        scopeWorkspaces={draft.scopeWorkspaces}
        workspaceOptions={workspaceOptions}
        onChange={onChange}
      />

      <div className="flex flex-col gap-1.5">
        <Label>{t("gallery.calendar-cell-unit-label")}</Label>
        <Select value={draft.cellUnit} onValueChange={(v) => onChange({ cellUnit: v as "day" | "week" })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="day">{t("gallery.calendar-cell-unit-day")}</SelectItem>
            <SelectItem value="week">{t("gallery.calendar-cell-unit-week")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{t("gallery.calendar-date-label")}</Label>
        <Input
          placeholder={t("gallery.calendar-date-placeholder")}
          value={draft.dateProperty}
          onChange={(e) => onChange({ dateProperty: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">{t("gallery.calendar-date-hint")}</p>
      </div>

      <CardFieldRow
        label={t("gallery.calendar-card-label")}
        state={draft.cardField}
        allowNone={false}
        onChange={(cardField) => onChange({ cardField })}
      />

      <div className="flex flex-col gap-1.5">
        <Label>{t("gallery.calendar-folder-label")}</Label>
        <Input
          placeholder={t("gallery.calendar-folder-placeholder")}
          value={draft.newDocFolder}
          onChange={(e) => onChange({ newDocFolder: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">{t("gallery.calendar-folder-hint")}</p>
      </div>
    </div>
  );
};

// One editable gallery block. Controlled via `draft` / `onChange`.
const GalleryBlockForm = ({
  draft,
  index,
  onChange,
  onRemove,
  onToggleCollapse,
  dragHandlers,
  workspaceOptions,
}: {
  draft: GalleryDraft;
  index: number;
  onChange: (patch: Partial<GalleryDraft>) => void;
  onRemove: () => void;
  onToggleCollapse: () => void;
  dragHandlers: React.HTMLAttributes<HTMLDivElement> & { draggable: boolean };
  workspaceOptions?: { name: string; title: string }[];
}) => {
  const t = useTranslate();

  // Split the serialized sort/cover values into their editable "kind" + property key.
  const sortMatch = draft.sort.match(/^prop_(asc|desc):(.*)$/s);
  const sortKind = sortMatch ? "property" : draft.sort;
  const sortDir = sortMatch?.[1] ?? "desc";
  const sortKey = sortMatch?.[2] ?? "";
  const setSort = (kind: string) =>
    onChange({
      sort: kind === "property" ? `prop_${sortDir}:${sortKey}` : (kind as GallerySort),
    });

  const coverIsProp = draft.cover.startsWith("prop:");
  const coverKind = coverIsProp ? "property" : draft.cover;
  const coverKey = coverIsProp ? draft.cover.slice(5) : "";
  const setCover = (kind: string) =>
    onChange({
      cover: kind === "property" ? `prop:${coverKey}` : (kind as GalleryCoverRule),
    });

  const updateBadge = (bi: number, patch: Partial<GalleryBadgeRule>) => {
    onChange({
      badges: draft.badges.map((b, i) => (i === bi ? { ...b, ...patch } : b)),
    });
  };
  const addBadge = () => onChange({ badges: [...draft.badges, { ...DEFAULT_BADGE_DRAFT }] });
  const removeBadge = (bi: number) => onChange({ badges: draft.badges.filter((_, i) => i !== bi) });

  const renderBadge = (badge: GalleryBadgeRule, bi: number) => (
    <div key={bi} className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{t("gallery.badge-title", { index: bi + 1 })}</span>
        <Button variant="ghost" size="icon" onClick={() => removeBadge(bi)}>
          <Trash2Icon className="w-4 h-4" />
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Select value={badge.kind} onValueChange={(v) => updateBadge(bi, { kind: v as GalleryBadgeKind })}>
          <SelectTrigger className="flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tag">{t("gallery.badge-style-tag")}</SelectItem>
            <SelectItem value="ribbon">{t("gallery.badge-style-ribbon")}</SelectItem>
            <SelectItem value="corner">{t("gallery.badge-style-corner")}</SelectItem>
          </SelectContent>
        </Select>
        <Input
          className="flex-1"
          maxLength={5}
          placeholder={t("gallery.badge-text-placeholder")}
          value={badge.title}
          onChange={(e) => updateBadge(bi, { title: e.target.value.slice(0, 5) })}
        />
        <div className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-2 shrink-0">
          <input
            type="color"
            className="size-6 cursor-pointer rounded border border-border bg-transparent p-0.5"
            value={badge.color}
            onChange={(e) => updateBadge(bi, { color: e.target.value })}
            aria-label={t("gallery.badge-color")}
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Input
          className="flex-1"
          placeholder={t("gallery.property-key-placeholder")}
          value={badge.propertyKey}
          onChange={(e) => updateBadge(bi, { propertyKey: e.target.value })}
        />
        <span className="text-muted-foreground text-sm">=</span>
        <Input
          className="flex-1"
          placeholder={t("gallery.property-value-placeholder")}
          value={badge.propertyValue}
          onChange={(e) => updateBadge(bi, { propertyValue: e.target.value })}
        />
      </div>
    </div>
  );

  if (draft.collapsed) {
    return (
      <BlockHeader
        icon={LayoutGridIcon}
        title={t("gallery.block-title", { index: index + 1 })}
        collapsed
        onToggleCollapse={onToggleCollapse}
        onRemove={onRemove}
        dragHandlers={dragHandlers}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <BlockHeader
        icon={LayoutGridIcon}
        title={t("gallery.block-title", { index: index + 1 })}
        collapsed={false}
        onToggleCollapse={onToggleCollapse}
        onRemove={onRemove}
        dragHandlers={dragHandlers}
      />

      <ScopeEditor
        index={index}
        scopeMatch={draft.scopeMatch}
        groups={draft.groups}
        scopeWorkspaces={draft.scopeWorkspaces}
        workspaceOptions={workspaceOptions}
        onChange={onChange}
      />

      <div className="flex flex-col gap-1.5">
        <Label>{t("gallery.sort-label")}</Label>
        <div className="flex items-center gap-2">
          <Select value={sortKind} onValueChange={setSort}>
            <SelectTrigger className="flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="updated_desc">{t("gallery.sort-updated-desc")}</SelectItem>
              <SelectItem value="updated_asc">{t("gallery.sort-updated-asc")}</SelectItem>
              <SelectItem value="created_desc">{t("gallery.sort-created-desc")}</SelectItem>
              <SelectItem value="created_asc">{t("gallery.sort-created-asc")}</SelectItem>
              <SelectItem value="title_asc">{t("gallery.sort-title-asc")}</SelectItem>
              <SelectItem value="property">{t("gallery.sort-property")}</SelectItem>
            </SelectContent>
          </Select>
          {sortKind === "property" && (
            <Select value={sortDir} onValueChange={(v) => onChange({ sort: `prop_${v}:${sortKey}` })}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="asc">{t("gallery.sort-ascending")}</SelectItem>
                <SelectItem value="desc">{t("gallery.sort-descending")}</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
        {sortKind === "property" && (
          <Input
            placeholder={t("gallery.property-key-placeholder")}
            value={sortKey}
            onChange={(e) => onChange({ sort: `prop_${sortDir}:${e.target.value}` })}
          />
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{t("gallery.cover-label")}</Label>
        <div className="flex items-center gap-2">
          <Select value={coverKind} onValueChange={setCover}>
            <SelectTrigger className="flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="first_image">{t("gallery.cover-first-image")}</SelectItem>
              <SelectItem value="none">{t("gallery.cover-none")}</SelectItem>
              <SelectItem value="property">{t("gallery.cover-property")}</SelectItem>
            </SelectContent>
          </Select>
          {coverKind === "property" && (
            <Input
              className="flex-1"
              placeholder={t("gallery.property-key-placeholder")}
              value={coverKey}
              onChange={(e) => onChange({ cover: `prop:${e.target.value}` })}
            />
          )}
        </div>
      </div>

      <CardFieldRow
        label={t("gallery.card-primary-label")}
        state={draft.primary}
        allowNone={false}
        onChange={(primary) => onChange({ primary })}
      />
      <CardFieldRow
        label={t("gallery.card-secondary-label")}
        state={draft.secondary}
        allowNone={true}
        onChange={(secondary) => onChange({ secondary })}
      />

      <div className="flex flex-col gap-2">
        <Label>{t("gallery.badges-label")}</Label>
        {draft.badges.map((badge, bi) => renderBadge(badge, bi))}
        {draft.badges.length < MAX_GALLERY_BADGES && (
          <Button variant="outline" size="sm" className="self-start" onClick={addBadge}>
            <PlusIcon className="w-4 h-4 mr-1" />
            {t("gallery.add-badge")}
          </Button>
        )}
      </div>
    </div>
  );
};

/**
 * Header shared by every block form: a drag handle for reordering, the block's
 * label, a collapse toggle and delete. Collapsing exists to make long views
 * navigable — a collapsed block is just its header, so a document's structure
 * (and the drop targets for reordering) fit on one screen.
 */
const BlockHeader = ({
  icon: Icon,
  title,
  collapsed,
  onToggleCollapse,
  onRemove,
  dragHandlers,
}: {
  icon: LucideIcon;
  title: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onRemove: () => void;
  dragHandlers: React.HTMLAttributes<HTMLDivElement> & { draggable: boolean };
}) => {
  const t = useTranslate();
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg -mx-1 px-1 py-0.5" {...dragHandlers}>
      <button
        type="button"
        onClick={onToggleCollapse}
        className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium text-left"
        title={t(collapsed ? "gallery.expand-block" : "gallery.collapse-block")}
      >
        <GripVerticalIcon className="w-4 h-4 shrink-0 text-muted-foreground cursor-grab active:cursor-grabbing" />
        <Icon className="w-4 h-4 shrink-0 text-primary" />
        <span className="truncate">{title}</span>
        <ChevronDownIcon className={cn("w-4 h-4 shrink-0 text-muted-foreground transition-transform", collapsed && "-rotate-90")} />
      </button>
      <Button variant="ghost" size="icon" className="shrink-0" onClick={onRemove} title={t("gallery.remove-block")}>
        <Trash2Icon className="w-4 h-4" />
      </Button>
    </div>
  );
};

/**
 * The outward-facing blocks' form.
 *
 * Its whole vocabulary is tags, order, count and columns — everything a
 * published snapshot carries. It is deliberately not the gallery form with
 * fields hidden: "this field does nothing in that mode" is the shape that ships
 * a block reaching for documents it must not see.
 */
const PublicBlockForm = ({
  draft,
  index,
  onChange,
  onRemove,
  onToggleCollapse,
  dragHandlers,
}: {
  draft: PublicGalleryDraft | PublicFeedDraft;
  index: number;
  onChange: (patch: Partial<PublicGalleryDraft> | Partial<PublicFeedDraft>) => void;
  onRemove: () => void;
  onToggleCollapse: () => void;
  dragHandlers: React.HTMLAttributes<HTMLDivElement> & { draggable: boolean };
}) => {
  const t = useTranslate();
  const isGallery = draft.type === "public_gallery";
  return (
    <div className="flex flex-col gap-3">
      <BlockHeader
        icon={isGallery ? GlobeIcon : ListIcon}
        title={t(isGallery ? "gallery.public-gallery-block-title" : "gallery.public-feed-block-title", { index: index + 1 })}
        collapsed={Boolean(draft.collapsed)}
        onToggleCollapse={onToggleCollapse}
        onRemove={onRemove}
        dragHandlers={dragHandlers}
      />
      {!draft.collapsed && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">{t("gallery.public-block-hint")}</p>
          {draft.type === "public_feed" && (
            <div className="flex flex-col gap-1.5">
              <Label>{t("gallery.public-title-label")}</Label>
              <Input
                value={draft.title}
                placeholder={DEFAULT_PUBLIC_FEED_BLOCK.title}
                onChange={(e) => onChange({ title: e.target.value })}
              />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label>{t("gallery.public-tags-label")}</Label>
            <Input
              value={draft.tags}
              placeholder={t("gallery.public-tags-placeholder")}
              onChange={(e) => onChange({ tags: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">{t("gallery.public-tags-hint")}</p>
          </div>
          {draft.type === "public_gallery" && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label>{t("gallery.public-sort-label")}</Label>
                <Select value={draft.sort} onValueChange={(v) => onChange({ sort: v === "manual" ? "manual" : "updated_desc" })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="updated_desc">{t("gallery.public-sort-updated")}</SelectItem>
                    <SelectItem value="manual">{t("gallery.public-sort-manual")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {draft.sort === "manual" && (
                <div className="flex flex-col gap-1.5">
                  <Label>{t("gallery.public-slugs-label")}</Label>
                  <Input value={draft.slugs} placeholder="handbook, changelog" onChange={(e) => onChange({ slugs: e.target.value })} />
                  <p className="text-xs text-muted-foreground">{t("gallery.public-slugs-hint")}</p>
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <Label>{t("gallery.public-columns-label")}</Label>
                <Select value={String(draft.columns)} onValueChange={(v) => onChange({ columns: Number(v) as 2 | 3 | 4 })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[2, 3, 4].map((columns) => (
                      <SelectItem key={columns} value={String(columns)}>
                        {columns}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
          {draft.type === "public_feed" && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={draft.showTopicFilter} onCheckedChange={(checked) => onChange({ showTopicFilter: checked === true })} />
              {t("gallery.public-topic-filter-label")}
            </label>
          )}
          <div className="flex flex-col gap-1.5">
            <Label>{t("gallery.public-limit-label")}</Label>
            <Input
              type="number"
              min={1}
              value={draft.limit}
              placeholder={t("gallery.public-limit-placeholder")}
              onChange={(e) => onChange({ limit: e.target.value })}
            />
          </div>
        </div>
      )}
    </div>
  );
};

// Picks the knowledge-base document a markdown block references: a filterable
// list of the workspace's markdown documents. The view document itself is
// excluded — a view embedding itself would recurse.
const DocumentPicker = ({
  workspace,
  excludeName,
  value,
  onChange,
}: {
  workspace?: string;
  excludeName?: string;
  value: string;
  onChange: (docName: string) => void;
}) => {
  const t = useTranslate();
  const [search, setSearch] = useState("");
  const { data, isLoading } = useMemos({
    pageSize: 1000,
    state: State.NORMAL,
    ...(workspace ? { filter: `workspace == ${JSON.stringify(workspace)}` } : {}),
  });

  const docs = (data?.memos ?? []).filter((m) => m.docType === Memo_DocType.MARKDOWN && m.name !== excludeName);
  const selected = docs.find((d) => d.name === value);
  const needle = search.trim().toLowerCase();
  const matches = needle ? docs.filter((d) => `${d.title} ${d.folderPath} ${d.name}`.toLowerCase().includes(needle)) : docs.slice(0, 50);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground shrink-0">{t("gallery.doc-block-selected")}</span>
        <span className={cn("truncate", !selected && "text-muted-foreground")}>
          {selected ? selected.title || selected.name : value ? value : t("gallery.doc-block-none")}
        </span>
      </div>
      <Input placeholder={t("gallery.doc-block-search-placeholder")} value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="max-h-56 overflow-y-auto rounded-md border border-border divide-y divide-border">
        {isLoading ? (
          <div className="px-3 py-2 text-sm text-muted-foreground">{t("gallery.loading")}</div>
        ) : matches.length === 0 ? (
          <div className="px-3 py-2 text-sm text-muted-foreground">{t("gallery.doc-block-no-results")}</div>
        ) : (
          matches.map((doc) => (
            <button
              key={doc.name}
              type="button"
              onClick={() => onChange(doc.name)}
              className={cn(
                "w-full px-3 py-2 text-left text-sm hover:bg-accent/50 transition-colors",
                doc.name === value && "bg-accent/60 font-medium",
              )}
            >
              <div className="truncate">{doc.title || doc.name}</div>
              {doc.folderPath && <div className="truncate text-xs text-muted-foreground">{doc.folderPath}</div>}
            </button>
          ))
        )}
      </div>
    </div>
  );
};

// One editable markdown block. Its content comes either from markdown typed
// here (anything the document renderer supports — grid/calendar/kanban/sheets
// fences included — so the view needs no block type of its own for them), or
// from a referenced knowledge-base document, rendered read-only in the view.
const MarkdownBlockForm = ({
  draft,
  index,
  workspace,
  excludeName,
  onChange,
  onRemove,
  onToggleCollapse,
  dragHandlers,
}: {
  draft: MarkdownDraft;
  index: number;
  workspace?: string;
  excludeName?: string;
  onChange: (patch: Partial<MarkdownDraft>) => void;
  onRemove: () => void;
  onToggleCollapse: () => void;
  dragHandlers: React.HTMLAttributes<HTMLDivElement> & { draggable: boolean };
}) => {
  const t = useTranslate();
  const isDocSource = draft.docName !== undefined;
  return (
    <div className="flex flex-col gap-3">
      <BlockHeader
        icon={FileTextIcon}
        title={t(isDocSource ? "gallery.doc-block-title" : "gallery.markdown-block-title", { index: index + 1 })}
        collapsed={Boolean(draft.collapsed)}
        onToggleCollapse={onToggleCollapse}
        onRemove={onRemove}
        dragHandlers={dragHandlers}
      />
      {!draft.collapsed && (
        <div className="flex flex-col gap-2">
          <Select
            value={isDocSource ? "doc" : "inline"}
            // Switching to inline drops the reference but keeps any typed markdown,
            // and switching back re-opens the picker with nothing selected.
            onValueChange={(v) => onChange({ docName: v === "doc" ? (draft.docName ?? "") : undefined })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inline">{t("gallery.markdown-source-inline")}</SelectItem>
              <SelectItem value="doc">{t("gallery.markdown-source-doc")}</SelectItem>
            </SelectContent>
          </Select>
          {isDocSource ? (
            <>
              <DocumentPicker
                workspace={workspace}
                excludeName={excludeName}
                value={draft.docName ?? ""}
                onChange={(docName) => onChange({ docName })}
              />
              <p className="text-xs text-muted-foreground">{t("gallery.doc-block-hint")}</p>
            </>
          ) : (
            <Textarea
              rows={6}
              className="font-mono text-sm"
              placeholder={t("gallery.markdown-placeholder")}
              value={draft.content}
              onChange={(e) => onChange({ content: e.target.value })}
            />
          )}
        </div>
      )}
    </div>
  );
};

// Editor for VIEW documents. A document may hold multiple gallery blocks; the
// bottom toolbar's "+" inserts another, and Save/Cancel are pinned bottom-right.
const GalleryViewForm = ({
  variant = "library",
  content,
  workspace,
  memoName,
  attachments = [],
  onSave,
  onCancel,
  onAddAttachments,
  onRemoveAttachment,
  workspaceOptions,
}: Props) => {
  const t = useTranslate();
  const initial = parseGalleryViewConfig(content);
  const [blocks, setBlocks] = useState<BlockDraft[]>(() => (initial?.blocks ?? []).map(toDraft));
  const [frontmatter, setFrontmatter] = useState(() => initial?.frontmatter ?? "");
  // Uploads are handled by the parent immediately on selection (independent of Save,
  // which only persists the gallery config); this input drives the "attachments" section.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const blockRefs = useRef<(HTMLDivElement | null)[]>([]);
  const attachmentsEnabled = Boolean(onAddAttachments);

  const updateBlock = (
    index: number,
    patch: Partial<GalleryDraft> | Partial<CalendarDraft> | Partial<MarkdownDraft> | Partial<PublicGalleryDraft> | Partial<PublicFeedDraft>,
  ) => {
    setBlocks((prev) => prev.map((b, i) => (i === index ? ({ ...b, ...patch } as BlockDraft) : b)));
  };

  const addGalleryBlock = () => setBlocks((prev) => [...prev, toDraft(DEFAULT_GALLERY_BLOCK)]);
  const addCalendarLayoutBlock = () => setBlocks((prev) => [...prev, toDraft(DEFAULT_CALENDAR_LAYOUT_BLOCK)]);
  const addPublicGalleryBlock = () => setBlocks((prev) => [...prev, toDraft(DEFAULT_PUBLIC_GALLERY_BLOCK)]);
  const addPublicFeedBlock = () => setBlocks((prev) => [...prev, toDraft(DEFAULT_PUBLIC_FEED_BLOCK)]);
  const addMarkdownBlock = () => setBlocks((prev) => [...prev, { type: "markdown" as const, content: "" }]);
  const addDocBlock = () => setBlocks((prev) => [...prev, { type: "markdown" as const, content: "", docName: "" }]);
  const removeBlock = (index: number) => setBlocks((prev) => prev.filter((_, i) => i !== index));
  const toggleCollapse = (index: number) => updateBlock(index, { collapsed: !blocks[index].collapsed });
  const collapseAll = (collapsed: boolean) => setBlocks((prev) => prev.map((b) => ({ ...b, collapsed })));

  // Reordering: native HTML5 drag/drop off each block header (same approach as
  // the kanban board). `dragIndex` also drives the drop indicator.
  const [dragIndex, setDragIndex] = useState<number | undefined>(undefined);
  const [dropIndex, setDropIndex] = useState<number | undefined>(undefined);

  const moveBlock = (from: number, to: number) => {
    if (from === to) return;
    setBlocks((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const dragHandlers = (index: number) => ({
    draggable: true,
    onDragStart: (event: React.DragEvent<HTMLDivElement>) => {
      setDragIndex(index);
      event.dataTransfer.effectAllowed = "move";
      // Firefox needs some payload for a drag to start at all.
      event.dataTransfer.setData("text/plain", String(index));
    },
    onDragEnd: () => {
      setDragIndex(undefined);
      setDropIndex(undefined);
    },
    onDragOver: (event: React.DragEvent<HTMLDivElement>) => {
      if (dragIndex === undefined) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDropIndex(index);
    },
    onDrop: (event: React.DragEvent<HTMLDivElement>) => {
      if (dragIndex === undefined) return;
      event.preventDefault();
      moveBlock(dragIndex, index);
      setDragIndex(undefined);
      setDropIndex(undefined);
    },
  });

  // Outline entry label for a block, mirroring its form header.
  const blockLabel = (draft: BlockDraft, index: number) => {
    if (draft.type === "markdown")
      return t(draft.docName !== undefined ? "gallery.doc-block-title" : "gallery.markdown-block-title", { index: index + 1 });
    if (draft.type === "calendar") return t("gallery.calendar-block-title", { index: index + 1 });
    if (draft.type === "public_gallery") return t("gallery.public-gallery-block-title", { index: index + 1 });
    if (draft.type === "public_feed") return t("gallery.public-feed-block-title", { index: index + 1 });
    return t("gallery.block-title", { index: index + 1 });
  };

  const scrollToBlock = (index: number) => {
    updateBlock(index, { collapsed: false });
    blockRefs.current[index]?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  const handleAddAttachmentsClick = () => fileInputRef.current?.click();

  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) onAddAttachments?.(files);
    event.target.value = "";
  };

  const handleSave = () => {
    // Blank markdown blocks are dropped rather than persisted as empty strings.
    const saved = blocks.map(fromDraft).filter((b) => b.type !== "markdown" || Boolean(b.docName) || b.content.trim() !== "");
    onSave(
      serializeGalleryViewConfig({
        viewType: "gallery",
        blocks: saved,
        frontmatter: frontmatter.trim() || undefined,
      }),
    );
  };

  const saveDisabled = blocks.length === 0 || blocks.some(blockInvalid);

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="w-full max-w-5xl mx-auto flex items-start justify-center gap-8">
          <div className="w-full max-w-lg flex flex-col gap-6">
            <div className="flex flex-col gap-1.5">
              <Label>{t("gallery.properties-label")}</Label>
              <Textarea
                rows={4}
                className="font-mono text-sm"
                placeholder={t("gallery.properties-placeholder")}
                value={frontmatter}
                onChange={(e) => setFrontmatter(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t("gallery.properties-hint")}</p>
            </div>
            {blocks.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-10">{t("gallery.empty-editor")}</div>
            ) : (
              blocks.map((draft, index) => (
                <div
                  key={index}
                  ref={(el) => {
                    blockRefs.current[index] = el;
                  }}
                  className={cn(
                    "flex flex-col gap-6 scroll-mt-4",
                    dragIndex === index && "opacity-50",
                    dropIndex === index && dragIndex !== index && "rounded-lg ring-2 ring-primary/40",
                  )}
                >
                  {index > 0 && <hr className="border-border" />}
                  {draft.type === "markdown" ? (
                    <MarkdownBlockForm
                      draft={draft}
                      index={index}
                      workspace={workspace}
                      excludeName={memoName}
                      onChange={(patch) => updateBlock(index, patch)}
                      onRemove={() => removeBlock(index)}
                      onToggleCollapse={() => toggleCollapse(index)}
                      dragHandlers={dragHandlers(index)}
                    />
                  ) : draft.type === "public_gallery" || draft.type === "public_feed" ? (
                    <PublicBlockForm
                      draft={draft}
                      index={index}
                      onChange={(patch) => updateBlock(index, patch)}
                      onRemove={() => removeBlock(index)}
                      onToggleCollapse={() => toggleCollapse(index)}
                      dragHandlers={dragHandlers(index)}
                    />
                  ) : draft.type === "calendar" ? (
                    <CalendarLayoutBlockForm
                      draft={draft}
                      index={index}
                      onChange={(patch) => updateBlock(index, patch)}
                      onRemove={() => removeBlock(index)}
                      onToggleCollapse={() => toggleCollapse(index)}
                      dragHandlers={dragHandlers(index)}
                      workspaceOptions={workspaceOptions}
                    />
                  ) : (
                    <GalleryBlockForm
                      draft={draft}
                      index={index}
                      onChange={(patch) => updateBlock(index, patch)}
                      onRemove={() => removeBlock(index)}
                      onToggleCollapse={() => toggleCollapse(index)}
                      dragHandlers={dragHandlers(index)}
                      workspaceOptions={workspaceOptions}
                    />
                  )}
                </div>
              ))
            )}

            {attachmentsEnabled && (attachments.length > 0 || blocks.length > 0) && (
              <div className="flex flex-col gap-3">
                <hr className="border-border" />
                <div className="flex items-center gap-2 text-sm font-medium">
                  <PaperclipIcon className="w-4 h-4 text-primary" />
                  {t("gallery.attachments-title")}
                </div>
                {attachments.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t("gallery.attachments-empty")}</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {attachments.map((attachment) => (
                      <div
                        key={attachment.name}
                        className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-background/65 px-3 py-2"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/50 text-muted-foreground">
                            <FileIcon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium leading-tight" title={attachment.filename}>
                              {attachment.filename}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {getFileTypeLabel(attachment.type)}
                              {attachment.size ? ` · ${formatFileSize(Number(attachment.size))}` : ""}
                            </div>
                          </div>
                        </div>
                        {onRemoveAttachment && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="shrink-0"
                            onClick={() => onRemoveAttachment(attachment.name)}
                            title={t("common.delete")}
                          >
                            <XIcon className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Outline: the document's block structure at a glance, and the fastest
              way to jump around a long view. Hidden on narrow screens, where the
              collapse toggles serve the same purpose. */}
          {blocks.length > 1 && (
            <aside className="hidden lg:flex w-56 shrink-0 sticky top-0 flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">{t("gallery.outline-title")}</span>
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => collapseAll(!blocks.every((b) => b.collapsed))}
                >
                  {t(blocks.every((b) => b.collapsed) ? "gallery.expand-all" : "gallery.collapse-all")}
                </button>
              </div>
              <ol className="flex flex-col gap-0.5">
                {blocks.map((draft, index) => (
                  <li key={index}>
                    <button
                      type="button"
                      onClick={() => scrollToBlock(index)}
                      className="w-full flex items-center gap-2 rounded px-2 py-1 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      {draft.type === "markdown" ? (
                        draft.docName !== undefined ? (
                          <BookTextIcon className="w-3.5 h-3.5 shrink-0" />
                        ) : (
                          <FileTextIcon className="w-3.5 h-3.5 shrink-0" />
                        )
                      ) : draft.type === "public_gallery" ? (
                        <GlobeIcon className="w-3.5 h-3.5 shrink-0" />
                      ) : draft.type === "public_feed" ? (
                        <ListIcon className="w-3.5 h-3.5 shrink-0" />
                      ) : draft.type === "calendar" ? (
                        <CalendarDaysIcon className="w-3.5 h-3.5 shrink-0" />
                      ) : (
                        <LayoutGridIcon className="w-3.5 h-3.5 shrink-0" />
                      )}
                      <span className="truncate">{blockLabel(draft, index)}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </aside>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-border px-4 py-2 flex items-center justify-between gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="icon" title={t("gallery.insert")}>
              <PlusIcon className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          {/* One vocabulary or the other. A library block on a site home page
              would be stripped on publish, and an outward-facing block in the
              knowledge base can only ever draw a placeholder — offering either
              one in the wrong document is offering something that cannot work. */}
          <DropdownMenuContent align="start">
            {variant === "library" ? (
              <>
                <DropdownMenuItem onClick={addGalleryBlock}>
                  <LayoutGridIcon className="w-4 h-4" />
                  {t("gallery.style-gallery")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={addCalendarLayoutBlock}>
                  <CalendarDaysIcon className="w-4 h-4" />
                  {t("gallery.style-calendar")}
                </DropdownMenuItem>
              </>
            ) : null}
            <DropdownMenuItem onClick={addMarkdownBlock}>
              <FileTextIcon className="w-4 h-4" />
              {t("gallery.style-markdown")}
            </DropdownMenuItem>
            {variant === "library" ? (
              <DropdownMenuItem onClick={addDocBlock}>
                <BookTextIcon className="w-4 h-4" />
                {t("gallery.style-doc")}
              </DropdownMenuItem>
            ) : (
              <>
                <DropdownMenuItem onClick={addPublicGalleryBlock}>
                  <GlobeIcon className="w-4 h-4" />
                  {t("gallery.style-public-gallery")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={addPublicFeedBlock}>
                  <ListIcon className="w-4 h-4" />
                  {t("gallery.style-public-feed")}
                </DropdownMenuItem>
              </>
            )}
            {attachmentsEnabled && (
              <DropdownMenuItem onClick={handleAddAttachmentsClick}>
                <PaperclipIcon className="w-4 h-4" />
                {t("gallery.style-attachments")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileInputChange} />
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={saveDisabled}>
            {t("common.save")}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default GalleryViewForm;
