import {
  CalendarIcon,
  CheckIcon,
  CircleDotIcon,
  ClockIcon,
  HashIcon,
  ListIcon,
  type LucideIcon,
  PencilIcon,
  SquareCheckIcon,
  SquareIcon,
  TypeIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { type MemoProperty, type PropertyType, selectOptionsFor } from "@/utils/frontmatter";
import { useTranslate } from "@/utils/i18n";

const TYPE_ICONS: Record<PropertyType, LucideIcon> = {
  text: TypeIcon,
  list: ListIcon,
  number: HashIcon,
  checkbox: SquareCheckIcon,
  date: CalendarIcon,
  datetime: ClockIcon,
  select: CircleDotIcon,
};

// Quiet colour per built-in option, so a status/priority chip reads at a glance. Anything not
// listed falls back to the neutral chip the list type uses.
const SELECT_OPTION_STYLES: Record<string, string> = {
  created: "bg-muted text-muted-foreground",
  "in-process": "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  done: "bg-green-500/15 text-green-700 dark:text-green-300",
  p0: "bg-red-500/15 text-red-700 dark:text-red-300",
  p1: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  p2: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  p3: "bg-muted text-muted-foreground",
};

// Radix Select has no value for "nothing selected", so clearing goes through a sentinel.
const CLEAR_OPTION = "__clear__";

const chipClass = "inline-flex items-center rounded px-1.5 py-0.5 text-xs";

// Render the value cell for one property, styled after Notion's page-property
// rows: lists become quiet chips, checkboxes show a filled/empty box, everything
// else renders as plain text (with an em-dash placeholder when empty).
function PropertyValue({ property }: { property: MemoProperty }) {
  const { type, value } = property;

  if (type === "list") {
    const items = Array.isArray(value) ? value : [];
    if (items.length === 0) {
      return <span className="text-muted-foreground">—</span>;
    }
    return (
      <div className="flex flex-wrap gap-1">
        {items.map((item, index) => (
          <span key={`${item}-${index}`} className={cn(chipClass, "bg-muted text-muted-foreground")}>
            {item}
          </span>
        ))}
      </div>
    );
  }

  if (type === "checkbox") {
    const CheckboxIcon = value === true ? SquareCheckIcon : SquareIcon;
    return <CheckboxIcon className={cn("w-4 h-4", value === true ? "text-primary" : "text-muted-foreground")} />;
  }

  if (value === null || value === "") {
    return <span className="text-muted-foreground">—</span>;
  }

  if (type === "select") {
    return <span className={cn(chipClass, SELECT_OPTION_STYLES[String(value)] ?? "bg-muted text-muted-foreground")}>{String(value)}</span>;
  }

  return <span className="wrap-break-word">{String(value)}</span>;
}

const NUMBER_LIKE_RE = /^-?\d+(\.\d+)?$/;

// Free text (and anything we couldn't classify, including an off-list value on a reserved
// select key) edits as a plain text box, committed on blur or Enter. A number keeps its type
// as long as it still reads as one — otherwise it simply becomes text.
function TextPropertyInput({ property, onCommit }: { property: MemoProperty; onCommit: (value: MemoProperty["value"]) => void }) {
  const initial = property.value === null ? "" : String(property.value);
  const [draft, setDraft] = useState(initial);
  useEffect(() => setDraft(initial), [initial]);

  const commit = () => {
    const next = draft.trim();
    if (next === initial) return;
    if (next === "") {
      onCommit(null);
      return;
    }
    onCommit(property.type === "number" && NUMBER_LIKE_RE.test(next) ? Number(next) : next);
  };

  return (
    <Input
      className="h-7 text-sm"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          setDraft(initial);
        }
      }}
    />
  );
}

// A tag box: existing items are removable chips, and typing a short label plus Enter (or a
// comma) appends one more.
function ListPropertyInput({ items, onCommit }: { items: string[]; onCommit: (value: string[]) => void }) {
  const t = useTranslate();
  const [draft, setDraft] = useState("");

  const add = () => {
    const item = draft.trim();
    setDraft("");
    if (item === "" || items.includes(item)) return;
    onCommit([...items, item]);
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      {items.map((item, index) => (
        <span key={`${item}-${index}`} className={cn(chipClass, "gap-1 bg-muted text-muted-foreground")}>
          {item}
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            aria-label={t("common.delete")}
            onClick={() => onCommit(items.filter((_, i) => i !== index))}
          >
            <XIcon className="w-3 h-3" />
          </button>
        </span>
      ))}
      <Input
        className="h-7 w-32 text-sm"
        placeholder={t("memo.properties.add-item")}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={add}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          } else if (e.key === "Backspace" && draft === "" && items.length > 0) {
            onCommit(items.slice(0, -1));
          }
        }}
      />
    </div>
  );
}

function PropertyEditor({ property, onCommit }: { property: MemoProperty; onCommit: (value: MemoProperty["value"]) => void }) {
  const t = useTranslate();
  const { type, value } = property;
  const options = selectOptionsFor(property.key);

  if (type === "select" && options) {
    const current = typeof value === "string" && value !== "" ? value : undefined;
    return (
      <Select value={current} onValueChange={(next) => onCommit(next === CLEAR_OPTION ? null : next)}>
        <SelectTrigger size="xs" className="min-w-28">
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
          <SelectItem value={CLEAR_OPTION}>{t("memo.properties.clear")}</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  if (type === "checkbox") {
    return <Switch checked={value === true} onCheckedChange={(checked) => onCommit(checked)} />;
  }

  if (type === "date" || type === "datetime") {
    const raw = typeof value === "string" ? value.replace(" ", "T") : "";
    return (
      <input
        type={type === "date" ? "date" : "datetime-local"}
        className="h-7 rounded-md border border-border bg-transparent px-2 text-sm outline-none"
        value={type === "date" ? raw.slice(0, 10) : raw.slice(0, 16)}
        onChange={(e) => onCommit(e.target.value === "" ? null : e.target.value)}
      />
    );
  }

  if (type === "list") {
    return <ListPropertyInput items={Array.isArray(value) ? value : []} onCommit={onCommit} />;
  }

  return <TextPropertyInput property={property} onCommit={onCommit} />;
}

interface PropertiesPanelProps {
  properties: MemoProperty[];
  /**
   * Enables in-place editing of the values. Called with the property key and its new value; the
   * caller writes it back into the document's frontmatter. Omitted (feed cards, read-only views)
   * the panel stays exactly as it was: display only.
   */
  onChange?: (key: string, value: MemoProperty["value"]) => void;
  /**
   * Whether the panel renders at all. Comes from the document's view configuration
   * (`docConfig.showProperties`), which is stored on the memo, not in its frontmatter — where
   * the panel is shown is app chrome, not a property of the content. Defaults to shown.
   */
  visible?: boolean;
}

/**
 * A memo's frontmatter properties, shown above the body. Read-only by default; when `onChange`
 * is supplied, a toggle at the end of the rows swaps the values for type-appropriate form
 * controls (dropdown, switch, date picker, tag box, text field) so the header can be edited
 * without opening the raw markdown editor.
 */
export const PropertiesPanel = ({ properties, onChange, visible }: PropertiesPanelProps) => {
  const t = useTranslate();
  const [editing, setEditing] = useState(false);
  if (properties.length === 0 || visible === false) {
    return null;
  }

  const isEditing = editing && Boolean(onChange);

  return (
    <div className="relative w-full mb-3 pb-2 border-b border-border flex flex-col gap-0.5" data-memo-properties>
      {properties.map((property) => {
        const Icon = TYPE_ICONS[property.type];
        return (
          <div key={property.key} className="flex flex-row items-start gap-2 text-sm py-0.5">
            <div className="flex flex-row items-center gap-1.5 shrink-0 w-32 max-w-[40%] text-muted-foreground">
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate" title={property.key}>
                {property.key}
              </span>
            </div>
            <div className="flex-1 min-w-0 text-foreground">
              {isEditing && onChange ? (
                <PropertyEditor property={property} onCommit={(value) => onChange(property.key, value)} />
              ) : (
                <PropertyValue property={property} />
              )}
            </div>
          </div>
        );
      })}
      {/* Icon only, floated over the top-right corner of the rows: the toggle is an affordance on
          the panel, not a property of its own, so it must not claim a row. */}
      {onChange && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-0 right-0 h-6 w-6 text-muted-foreground hover:text-foreground"
          onClick={() => setEditing((previous) => !previous)}
          title={t(editing ? "memo.properties.done" : "memo.properties.edit")}
        >
          <span className="sr-only">{t(editing ? "memo.properties.done" : "memo.properties.edit")}</span>
          {editing ? <CheckIcon className="w-3.5 h-3.5" /> : <PencilIcon className="w-3.5 h-3.5" />}
        </Button>
      )}
    </div>
  );
};
