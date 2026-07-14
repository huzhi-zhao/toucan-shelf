import { alertStyles } from "@/lib/markdownStyles";
import { cn } from "@/lib/utils";
import { NestedMarkdownRenderContext } from "../MarkdownRenderContext";
import { alertDisplayLabel, resolveAlertFamily, SPECIAL_CARD_FAMILIES } from "./alertFamilies";
import { renderSpecialCallout } from "./SpecialCallouts";
import type { ReactMarkdownProps } from "./types";

interface AlertProps extends React.BlockquoteHTMLAttributes<HTMLQuoteElement>, ReactMarkdownProps {
  children: React.ReactNode;
  /** Raw alias from the `[!TYPE]` marker (e.g. "hint", "done"), lowercased by remark-alert. */
  alertType: string;
  alertIcon?: string;
  /** Custom title typed after the `[!TYPE]` marker on the same line, if any (see remark-alert). */
  alertTitle?: string;
}

/**
 * Callout dispatcher for blockquotes whose first line is a `[!TYPE]` /
 * `[!TYPE(icon)]` marker (see remark-alert). `alertType` is resolved to a
 * canonical family (alertFamilies.ts) — an unrecognized type falls back to
 * "note", so every marker renders as a real callout, never plain text.
 * Families with a bespoke design (note/quote/important/summary/tip/todo/
 * attention) get their SpecialCallouts card; the rest render as a tinted card
 * with a bold icon+label header (alertStyles) — same card shape as the
 * special tier, just without a bespoke layout. A family's default icon may be
 * a lucide component or a literal emoji (e.g. "example"'s 🌰).
 */
export const Alert = ({ children, className, alertType, alertIcon, alertTitle, node: _node, ...props }: AlertProps) => {
  const family = resolveAlertFamily(alertType);

  if (SPECIAL_CARD_FAMILIES.has(family)) {
    return renderSpecialCallout({ family, rawType: alertType, customIcon: alertIcon, title: alertTitle, className, children });
  }

  const style = alertStyles[family];
  const iconGlyph = typeof style?.icon === "string" ? style.icon : undefined;
  const Icon = style && typeof style.icon !== "string" ? style.icon : undefined;

  return (
    <blockquote className={cn("my-0 mb-2 rounded-xl border-l-4 px-4 py-3 not-italic", style?.classes, className)} {...props}>
      <div className="flex items-center gap-1.5 font-bold">
        <span aria-hidden className="shrink-0 leading-none">
          {alertIcon || iconGlyph || (Icon && <Icon className="w-4 h-4" />)}
        </span>
        {alertTitle || alertDisplayLabel(alertType)}
      </div>
      <div className="min-w-0 mt-1">
        <NestedMarkdownRenderContext>{children}</NestedMarkdownRenderContext>
      </div>
    </blockquote>
  );
};
