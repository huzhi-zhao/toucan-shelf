import { CalendarIcon, ClockIcon, HashIcon, ListIcon, type LucideIcon, SquareCheckIcon, SquareIcon, TypeIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MemoProperty, PropertyType } from "@/utils/frontmatter";

const TYPE_ICONS: Record<PropertyType, LucideIcon> = {
  text: TypeIcon,
  list: ListIcon,
  number: HashIcon,
  checkbox: SquareCheckIcon,
  date: CalendarIcon,
  datetime: ClockIcon,
};

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
          <span key={`${item}-${index}`} className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            {item}
          </span>
        ))}
      </div>
    );
  }

  if (type === "checkbox") {
    const CheckIcon = value === true ? SquareCheckIcon : SquareIcon;
    return <CheckIcon className={cn("w-4 h-4", value === true ? "text-primary" : "text-muted-foreground")} />;
  }

  if (value === null || value === "") {
    return <span className="text-muted-foreground">—</span>;
  }

  return <span className="wrap-break-word">{String(value)}</span>;
}

interface PropertiesPanelProps {
  properties: MemoProperty[];
}

/**
 * Read-only rendering of a memo's frontmatter properties, shown above the body.
 * Editing happens only in the raw markdown editor — this panel never mutates.
 */
export const PropertiesPanel = ({ properties }: PropertiesPanelProps) => {
  const isHidden = properties.some((property) => property.key === "hidden" && property.type === "checkbox" && property.value === true);
  if (properties.length === 0 || isHidden) {
    return null;
  }

  return (
    <div className="w-full mb-3 pb-2 border-b border-border flex flex-col gap-0.5" data-memo-properties>
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
              <PropertyValue property={property} />
            </div>
          </div>
        );
      })}
    </div>
  );
};
