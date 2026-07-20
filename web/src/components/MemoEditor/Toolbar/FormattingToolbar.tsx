import {
  AlertCircleIcon,
  CalendarDaysIcon,
  CheckIcon,
  CircleCheckIcon,
  CircleHelpIcon,
  FlameIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  InfoIcon,
  LayoutGridIcon,
  ListIcon,
  type LucideIcon,
  MessageSquareQuoteIcon,
  MessagesSquareIcon,
  Minimize2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  QuoteIcon,
  SquareKanbanIcon,
  TablePropertiesIcon,
  TriangleAlertIcon,
  TypeIcon,
  ZapIcon,
} from "lucide-react";
import { type ComponentPropsWithoutRef, forwardRef, type MouseEventHandler, type RefObject, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Translations } from "@/utils/i18n";
import { useTranslate } from "@/utils/i18n";
import {
  EDITOR_COMMANDS,
  type EditorCommand,
  type EditorCommandId,
  isCommandActive,
  type ToolbarHeadingLevel,
} from "../formatting/commands";
import { isCompactWidth, useEditorActiveState, useElementWidth } from "../hooks";
import type { EditorController } from "../types";

interface FormattingToolbarProps {
  controllerRef: RefObject<EditorController | null>;
  /** Called by the exit button; when omitted (normal-mode toolbar) the button is hidden. */
  onExit?: () => void;
  /** Extra classes for the host to frame the toolbar row. */
  className?: string;
}

// Representative callout types offered by the toolbar dropdown — one per
// visual family (alertFamilies.ts), not all 28 Obsidian aliases, so the menu
// stays short. Picking one inserts `> [!TYPE] ` as its own block at the cursor.
// Grouped (with a separator between groups) to mirror the visual tiers:
// 1. status cards (info/check/success/warning/danger)
// 2. accent pills (todo/tip)
// 3. note (also the fallback look for any unrecognized type)
// 4. status cards with a custom icon (question/example)
// 5. bespoke designs (quote/important)
interface CalloutMenuItem {
  type: string;
  labelKey: Translations;
  icon: LucideIcon;
  /** Multi-line seed inserted instead of the bare `> [!TYPE] ` marker (chat needs two turns to read as a thread). */
  snippet?: string;
}

const CALLOUT_MENU_GROUPS: CalloutMenuItem[][] = [
  [
    { type: "info", labelKey: "editor.callout.info", icon: InfoIcon },
    { type: "check", labelKey: "editor.callout.check", icon: CircleCheckIcon },
    { type: "success", labelKey: "editor.callout.success", icon: CheckIcon },
    { type: "warning", labelKey: "editor.callout.warning", icon: TriangleAlertIcon },
    { type: "danger", labelKey: "editor.callout.danger", icon: ZapIcon },
  ],
  [
    { type: "todo", labelKey: "editor.callout.todo", icon: CircleCheckIcon },
    { type: "tip", labelKey: "editor.callout.tip", icon: FlameIcon },
  ],
  [{ type: "note", labelKey: "editor.callout.note", icon: PencilIcon }],
  [
    { type: "question", labelKey: "editor.callout.question", icon: CircleHelpIcon },
    { type: "example", labelKey: "editor.callout.example", icon: ListIcon },
  ],
  [
    { type: "quote", labelKey: "editor.callout.quote", icon: QuoteIcon },
    { type: "important", labelKey: "editor.callout.important", icon: AlertCircleIcon },
    {
      type: "chat",
      labelKey: "editor.callout.chat",
      icon: MessagesSquareIcon,
      snippet: ["> [!CHAT:R(Lindsay, 08:52)] Hi! How's it going?", "> [!CHAT:S] All good — shipping it today."].join("\n"),
    },
  ],
];

// View blocks offered by the toolbar's "view" dropdown. Picking one inserts a
// ready-to-edit fenced example at the cursor, rendered live by CodeBlock.tsx.
interface ViewMenuItem {
  labelKey: Translations;
  icon: LucideIcon;
  snippet: string;
}

const VIEW_MENU_ITEMS: ViewMenuItem[] = [
  {
    labelKey: "editor.view.grid",
    icon: LayoutGridIcon,
    snippet: [
      "```grid",
      "- title: Cute Cat toy",
      "  subtitle: New release",
      "  Price: 300$",
      "  Rating: ★★★★☆ 4.0",
      "  Note: 2026-07-17",
      "- title: Molang plush",
      "  subtitle: Best seller",
      "  Price: 120$",
      "  Note: 2026-07-10",
      "```",
    ].join("\n"),
  },
  {
    labelKey: "editor.view.kanban",
    icon: SquareKanbanIcon,
    snippet: [
      "```kanban",
      "statusOrder:",
      "  - Todo",
      "  - Doing",
      "  - Done",
      "items:",
      "  - title: First task",
      "    status: Todo",
      "    priority: high",
      "  - title: Task in progress",
      "    status: Doing",
      "  - title: Finished task",
      "    status: Done",
      "    done: true",
      "```",
    ].join("\n"),
  },
  {
    labelKey: "editor.view.calendar",
    icon: CalendarDaysIcon,
    snippet: ["```calendar", "- 2026-07-17", "- [ ] Sample event", "- [x] Completed task", "- 2026-07-20", "- Another note", "```"].join(
      "\n",
    ),
  },
];

const MARK_COMMANDS = EDITOR_COMMANDS.filter((command) => command.group === "mark");
const BLOCK_COMMANDS = EDITOR_COMMANDS.filter((command) => command.group === "block");
// Paragraph + headings render as a single icon dropdown (a closed set); the
// trigger glyph reflects the current block level.
const HEADING_COMMANDS = EDITOR_COMMANDS.filter((command) => command.group === "heading");
const HEADING_LEVEL_ICONS: Record<ToolbarHeadingLevel, LucideIcon> = { 1: Heading1Icon, 2: Heading2Icon, 3: Heading3Icon };

interface ToolbarButton {
  Icon?: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
}

// Button styling: quiet ghost controls that sit directly on the editor surface
// (no filled track or border — that container read as a heavy slab). The active
// verb is the only filled element, so the toolbar recedes and the current state
// carries the weight. Kept as raw buttons (not the Button kit) because the idle
// hover + active treatment don't map to a single kit variant, and per policy a
// custom look is raw HTML rather than className overrides on the kit.
const SEGMENT_BASE =
  "inline-flex items-center justify-center h-7 min-w-7 px-1.5 rounded-md text-sm transition-colors outline-none touch-manipulation focus-visible:ring-2 focus-visible:ring-ring";
const SEGMENT_IDLE = "text-muted-foreground hover:text-foreground hover:bg-foreground/5";
const SEGMENT_ACTIVE = "bg-accent text-accent-foreground";

// Command buttons must not take focus on mousedown — that blurs the editor and
// drops the selection the command targets. The click still fires and applies the
// format to the live selection.
const preventFocusSteal: MouseEventHandler<HTMLButtonElement> = (event) => event.preventDefault();

/**
 * Formatting toolbar: a lean inline row of the heading picker plus mark/block
 * controls, every one derived from the shared command catalog
 * (formatting/commands.ts), so adding a verb there surfaces it here automatically.
 * Groups are separated by thin vertical dividers. Responsive: below
 * COMPACT_TOOLBAR_WIDTH the block controls fold into a "more" menu while marks
 * stay inline. In focus mode an exit button is pushed to the far edge.
 */
export function FormattingToolbar({ controllerRef, onExit, className }: FormattingToolbarProps) {
  const t = useTranslate();
  const rootRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(rootRef);
  const compact = isCompactWidth(width);
  const active = useEditorActiveState(controllerRef);

  const run = (id: EditorCommandId) => controllerRef.current?.formatting?.run(id);

  // Menus grab focus while open and hand it back to their trigger on close; send
  // it to the editor instead so the user can keep typing after a pick.
  const returnFocusToEditor = (event: Event) => {
    event.preventDefault();
    controllerRef.current?.focus();
  };

  // Map a catalog command to a toolbar button.
  const toButton = (command: EditorCommand): ToolbarButton => ({
    Icon: command.icon,
    label: t(command.labelKey),
    active: isCommandActive(active, command.id),
    onClick: () => run(command.id),
  });

  // Type glyph for paragraph, else the matching Hn glyph. Deeper levels (H4–H6)
  // aren't toolbar-addressable and report as null, i.e. the Type glyph.
  const HeadingGlyph = active.headingLevel === null ? TypeIcon : HEADING_LEVEL_ICONS[active.headingLevel];
  const markButtons = MARK_COMMANDS.map(toButton);
  const blockButtons = BLOCK_COMMANDS.map(toButton);

  return (
    <div
      ref={rootRef}
      className={cn("w-full flex flex-row items-center gap-0.5", className)}
      role="toolbar"
      aria-label={t("editor.format.heading")}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SegmentButton Icon={HeadingGlyph} label={t("editor.format.heading")} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" onCloseAutoFocus={returnFocusToEditor}>
          {HEADING_COMMANDS.map((command) => (
            <DropdownMenuItem key={command.id} onClick={() => run(command.id)}>
              {t(command.labelKey)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Divider />

      {markButtons.map((button) => (
        <SegmentButton key={button.label} {...button} onMouseDown={preventFocusSteal} />
      ))}

      <Divider />

      {compact ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SegmentButton Icon={MoreHorizontalIcon} label={t("editor.format.more")} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" onCloseAutoFocus={returnFocusToEditor}>
            {blockButtons.map((button) => (
              <DropdownMenuItem key={button.label} onClick={button.onClick}>
                {button.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        blockButtons.map((button) => <SegmentButton key={button.label} {...button} onMouseDown={preventFocusSteal} />)
      )}

      <Divider />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SegmentButton Icon={MessageSquareQuoteIcon} label={t("editor.callout.trigger")} onMouseDown={preventFocusSteal} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" onCloseAutoFocus={returnFocusToEditor}>
          {CALLOUT_MENU_GROUPS.map((group, groupIndex) => (
            <div key={group[0].type}>
              {groupIndex > 0 && <DropdownMenuSeparator />}
              {group.map((item) => (
                <DropdownMenuItem
                  key={item.type}
                  onClick={() =>
                    controllerRef.current?.insertMarkdown(item.snippet ? `\n${item.snippet}\n` : `> [!${item.type.toUpperCase()}] `)
                  }
                >
                  <item.icon className="w-4 h-4" />
                  {t(item.labelKey)}
                </DropdownMenuItem>
              ))}
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SegmentButton Icon={TablePropertiesIcon} label={t("editor.view.trigger")} onMouseDown={preventFocusSteal} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" onCloseAutoFocus={returnFocusToEditor}>
          {VIEW_MENU_ITEMS.map((item) => (
            <DropdownMenuItem key={item.labelKey} onClick={() => controllerRef.current?.insertMarkdown(`\n${item.snippet}\n`)}>
              <item.icon className="w-4 h-4" />
              {t(item.labelKey)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {onExit && (
        <>
          <div className="flex-1" />
          <Button variant="ghost" size="icon" aria-label={t("editor.exit-focus-mode")} title={t("editor.exit-focus-mode")} onClick={onExit}>
            <Minimize2Icon className="w-4 h-4" />
          </Button>
        </>
      )}
    </div>
  );
}

// Thin vertical rule between command groups (heading · marks · blocks).
function Divider() {
  return <span aria-hidden="true" className="w-px h-5 bg-border mx-1.5 shrink-0" />;
}

interface SegmentButtonProps extends ComponentPropsWithoutRef<"button"> {
  Icon?: LucideIcon;
  label: string;
  /** Toggle state; when set the segment gets aria-pressed and the active fill. */
  active?: boolean;
}

// The one segment element, shared by command toggles and dropdown triggers.
// Forwards ref + rest props so it also works as a Radix `asChild` trigger
// (which injects its own onClick/aria attributes).
const SegmentButton = forwardRef<HTMLButtonElement, SegmentButtonProps>(({ Icon, label, active, className, ...rest }, ref) => (
  <button
    ref={ref}
    type="button"
    aria-label={label}
    aria-pressed={active}
    title={label}
    className={cn(SEGMENT_BASE, active ? SEGMENT_ACTIVE : SEGMENT_IDLE, className)}
    {...rest}
  >
    {Icon && <Icon className="w-4 h-4" />}
  </button>
));
SegmentButton.displayName = "SegmentButton";
