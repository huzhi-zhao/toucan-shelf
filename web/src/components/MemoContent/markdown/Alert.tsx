import { alertStyles } from "@/lib/markdownStyles";
import { cn } from "@/lib/utils";
import { NestedMarkdownRenderContext } from "../MarkdownRenderContext";
import { resolveAlertFamily, SPECIAL_CARD_FAMILIES } from "./alertFamilies";
import { renderSpecialCallout } from "./SpecialCallouts";
import type { ReactMarkdownProps } from "./types";

interface AlertProps extends React.BlockquoteHTMLAttributes<HTMLQuoteElement>, ReactMarkdownProps {
  children: React.ReactNode;
  /** Raw alias from the `[!TYPE]` marker (e.g. "hint", "done"), lowercased by remark-alert. */
  alertType: string;
  alertIcon?: string;
}

/**
 * Callout dispatcher for blockquotes whose first line is a `[!TYPE]` /
 * `[!TYPE(icon)]` marker (see remark-alert). `alertType` is resolved to a
 * canonical family (alertFamilies.ts) — an unrecognized type falls back to
 * "note", so every marker renders as a real callout, never plain text.
 * Families with a bespoke design (note/quote/important/summary/tip/info/
 * attention/example/warning) get their SpecialCallouts card; the rest render
 * as a simple colored row (alertStyles).
 */
export const Alert = ({ children, className, alertType, alertIcon, node: _node, ...props }: AlertProps) => {
  const family = resolveAlertFamily(alertType);

  if (SPECIAL_CARD_FAMILIES.has(family)) {
    return renderSpecialCallout({ family, rawType: alertType, customIcon: alertIcon, className, children });
  }

  const style = alertStyles[family];
  const Icon = style?.icon;

  return (
    <blockquote
      className={cn("my-0 mb-2 flex gap-2 rounded-md border pl-3 pr-3 py-2 not-italic", style?.classes, className)}
      {...props}
    >
      <span aria-hidden className="shrink-0 leading-6">
        {alertIcon || (Icon && <Icon className="w-4 h-4" />)}
      </span>
      <div className="min-w-0 flex-1">
        <NestedMarkdownRenderContext>{children}</NestedMarkdownRenderContext>
      </div>
    </blockquote>
  );
};
