import {
  ChevronDownIcon,
  FileIcon,
  FileTextIcon,
  GripVerticalIcon,
  LayoutGridIcon,
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
import { cn } from "@/lib/utils";
import type { Attachment } from "@/types/proto/api/v1/attachment_service_pb";
import { formatFileSize, getFileTypeLabel } from "@/utils/format";
import { useTranslate } from "@/utils/i18n";
import {
  DEFAULT_BADGE_COLOR,
  DEFAULT_GALLERY_BLOCK,
  type GalleryBadgeKind,
  type GalleryBadgeRule,
  type GalleryCardField,
  type GalleryCoverRule,
  type GalleryGroup,
  type GalleryMatch,
  type GalleryRule,
  type GallerySort,
  MAX_GALLERY_BADGES,
  parseGalleryViewConfig,
  serializeGalleryViewConfig,
  type ViewBlock,
} from "./types";

interface Props {
  content: string;
  /** Attachments mounted on this view document, shown as a section in the editor. */
  attachments?: Attachment[];
  onSave: (content: string) => void;
  onCancel: () => void;
  /** Uploads and mounts files onto the view document. When absent, the attachment section is hidden. */
  onAddAttachments?: (files: File[]) => void | Promise<void>;
  onRemoveAttachment?: (name: string) => void | Promise<void>;
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
  sort: GallerySort;
  cover: GalleryCoverRule;
  primary: CardFieldState;
  secondary: CardFieldState;
  badges: GalleryBadgeRule[];
}

/** Editable draft of a free markdown block. */
interface MarkdownDraft {
  type: "markdown";
  content: string;
  collapsed?: boolean;
}

type BlockDraft = GalleryDraft | MarkdownDraft;

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
  if (block.type === "markdown") return { type: "markdown", content: block.content };
  return {
    type: "gallery",
    scopeMatch: block.scope.match,
    groups: block.scope.groups.length > 0 ? block.scope.groups.map(toGroupDraft) : [{ match: "all", rules: [{ ...DEFAULT_RULE_DRAFT }] }],
    sort: block.sort,
    cover: block.cover,
    primary: toCardFieldState(block.cardFields.primary),
    secondary: toCardFieldState(block.cardFields.secondary),
    badges: block.badges,
  };
}

// Groups/rules that are incomplete (empty tag / property key) are dropped;
// groups left with no rules are dropped entirely.
function effectiveGroups(draft: GalleryDraft): GalleryGroup[] {
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

function fromDraft(draft: BlockDraft): ViewBlock {
  if (draft.type === "markdown") return { type: "markdown", content: draft.content };
  return {
    type: "gallery",
    scope: { match: draft.scopeMatch, groups: effectiveGroups(draft) },
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
  return draft.type === "gallery" && effectiveGroups(draft).length === 0;
}

// One editable gallery block. Controlled via `draft` / `onChange`.
const GalleryBlockForm = ({
  draft,
  index,
  onChange,
  onRemove,
  onToggleCollapse,
  dragHandlers,
}: {
  draft: GalleryDraft;
  index: number;
  onChange: (patch: Partial<GalleryDraft>) => void;
  onRemove: () => void;
  onToggleCollapse: () => void;
  dragHandlers: React.HTMLAttributes<HTMLDivElement> & { draggable: boolean };
}) => {
  const t = useTranslate();

  const updateGroup = (gi: number, patch: Partial<GroupDraft>) => {
    onChange({
      groups: draft.groups.map((g, i) => (i === gi ? { ...g, ...patch } : g)),
    });
  };
  const updateRule = (gi: number, ri: number, patch: Partial<RuleDraft>) => {
    onChange({
      groups: draft.groups.map((g, i) =>
        i === gi
          ? {
              ...g,
              rules: g.rules.map((r, j) => (j === ri ? { ...r, ...patch } : r)),
            }
          : g,
      ),
    });
  };
  const removeRule = (gi: number, ri: number) => {
    onChange({
      groups: draft.groups.map((g, i) => (i === gi ? { ...g, rules: g.rules.filter((_, j) => j !== ri) } : g)),
    });
  };
  const addRule = (gi: number) => {
    onChange({
      groups: draft.groups.map((g, i) => (i === gi ? { ...g, rules: [...g.rules, { ...DEFAULT_RULE_DRAFT }] } : g)),
    });
  };
  const addGroup = () =>
    onChange({
      groups: [...draft.groups, { match: "all", rules: [{ ...DEFAULT_RULE_DRAFT }] }],
    });
  const removeGroup = (gi: number) => onChange({ groups: draft.groups.filter((_, i) => i !== gi) });

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

  const renderCardFieldRow = (label: string, state: CardFieldState, key: "primary" | "secondary", allowNone: boolean) => (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <Select value={state.kind} onValueChange={(v) => onChange({ [key]: { ...state, kind: v as CardFieldState["kind"] } })}>
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
            onChange={(e) => onChange({ [key]: { ...state, propKey: e.target.value } })}
          />
        )}
      </div>
    </div>
  );

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

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Label className="shrink-0">{t("gallery.scope-label")}</Label>
          <span className="text-sm text-muted-foreground">{t("gallery.match-label")}</span>
          <Select value={draft.scopeMatch} onValueChange={(v) => onChange({ scopeMatch: v as GalleryMatch })}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("gallery.match-all")}</SelectItem>
              <SelectItem value="any">{t("gallery.match-any")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {draft.groups.map((group, gi) => (
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
              {draft.groups.length > 1 && (
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

      {renderCardFieldRow(t("gallery.card-primary-label"), draft.primary, "primary", false)}
      {renderCardFieldRow(t("gallery.card-secondary-label"), draft.secondary, "secondary", true)}

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

// One editable markdown block: a plain markdown source box. Anything the
// document renderer supports (including grid/calendar/kanban/sheets fences)
// works here, so the view needs no block type of its own for them.
const MarkdownBlockForm = ({
  draft,
  index,
  onChange,
  onRemove,
  onToggleCollapse,
  dragHandlers,
}: {
  draft: MarkdownDraft;
  index: number;
  onChange: (patch: Partial<MarkdownDraft>) => void;
  onRemove: () => void;
  onToggleCollapse: () => void;
  dragHandlers: React.HTMLAttributes<HTMLDivElement> & { draggable: boolean };
}) => {
  const t = useTranslate();
  return (
    <div className="flex flex-col gap-3">
      <BlockHeader
        icon={FileTextIcon}
        title={t("gallery.markdown-block-title", { index: index + 1 })}
        collapsed={Boolean(draft.collapsed)}
        onToggleCollapse={onToggleCollapse}
        onRemove={onRemove}
        dragHandlers={dragHandlers}
      />
      {!draft.collapsed && (
        <Textarea
          rows={6}
          className="font-mono text-sm"
          placeholder={t("gallery.markdown-placeholder")}
          value={draft.content}
          onChange={(e) => onChange({ content: e.target.value })}
        />
      )}
    </div>
  );
};

// Editor for VIEW documents. A document may hold multiple gallery blocks; the
// bottom toolbar's "+" inserts another, and Save/Cancel are pinned bottom-right.
const GalleryViewForm = ({ content, attachments = [], onSave, onCancel, onAddAttachments, onRemoveAttachment }: Props) => {
  const t = useTranslate();
  const initial = parseGalleryViewConfig(content);
  const [blocks, setBlocks] = useState<BlockDraft[]>(() => (initial?.blocks ?? []).map(toDraft));
  const [frontmatter, setFrontmatter] = useState(() => initial?.frontmatter ?? "");
  // Uploads are handled by the parent immediately on selection (independent of Save,
  // which only persists the gallery config); this input drives the "attachments" section.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const blockRefs = useRef<(HTMLDivElement | null)[]>([]);
  const attachmentsEnabled = Boolean(onAddAttachments);

  const updateBlock = (index: number, patch: Partial<GalleryDraft> | Partial<MarkdownDraft>) => {
    setBlocks((prev) => prev.map((b, i) => (i === index ? ({ ...b, ...patch } as BlockDraft) : b)));
  };

  const addGalleryBlock = () => setBlocks((prev) => [...prev, toDraft(DEFAULT_GALLERY_BLOCK)]);
  const addMarkdownBlock = () => setBlocks((prev) => [...prev, { type: "markdown" as const, content: "" }]);
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
  const blockLabel = (draft: BlockDraft, index: number) =>
    draft.type === "markdown" ? t("gallery.markdown-block-title", { index: index + 1 }) : t("gallery.block-title", { index: index + 1 });

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
    const saved = blocks.map(fromDraft).filter((b) => b.type !== "markdown" || b.content.trim() !== "");
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
                      onChange={(patch) => updateBlock(index, patch)}
                      onRemove={() => removeBlock(index)}
                      onToggleCollapse={() => toggleCollapse(index)}
                      dragHandlers={dragHandlers(index)}
                    />
                  ) : (
                    <GalleryBlockForm
                      draft={draft}
                      index={index}
                      onChange={(patch) => updateBlock(index, patch)}
                      onRemove={() => removeBlock(index)}
                      onToggleCollapse={() => toggleCollapse(index)}
                      dragHandlers={dragHandlers(index)}
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
                        <FileTextIcon className="w-3.5 h-3.5 shrink-0" />
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
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={addGalleryBlock}>
              <LayoutGridIcon className="w-4 h-4" />
              {t("gallery.style-gallery")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={addMarkdownBlock}>
              <FileTextIcon className="w-4 h-4" />
              {t("gallery.style-markdown")}
            </DropdownMenuItem>
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
