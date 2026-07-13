import { isRelativeDocHref, useDocumentLinkContext } from "@/components/MemoContent/DocumentLinkContext";
import { markdownStyles } from "@/lib/markdownStyles";
import { cn } from "@/lib/utils";
import type { ReactMarkdownProps } from "./types";

interface LinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement>, ReactMarkdownProps {
  children: React.ReactNode;
}

/**
 * Link component for markdown links.
 *
 * When a document-link context is available (Notebook preview, memo detail page) and the href is a
 * relative in-workspace path that resolves to a memo, the link navigates to that document instead of
 * being treated as external. The anchor's `href` points at the memo's standard URL (`/memos/{uid}`),
 * so hover/copy/cmd-click all behave sanely, while a plain click is intercepted for SPA navigation.
 * Everything else opens in a new tab with security attributes.
 */
export const Link = ({ children, className, href, node: _node, ...props }: LinkProps) => {
  const docLinkContext = useDocumentLinkContext();

  if (docLinkContext && isRelativeDocHref(href)) {
    const target = docLinkContext.resolve(href);
    if (target) {
      return (
        <a
          href={`/${target}`}
          className={cn(markdownStyles.link, className)}
          onClick={(e) => {
            // Let the browser handle modifier/middle clicks (open in new tab) via the real href.
            if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            docLinkContext.navigate(target, href);
          }}
          {...props}
        >
          {children}
        </a>
      );
    }
  }

  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cn(markdownStyles.link, className)} {...props}>
      {children}
    </a>
  );
};
