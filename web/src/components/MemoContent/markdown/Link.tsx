import { Link as RouterLink } from "react-router-dom";
import { isRootRelativeDocHref, useDocumentLinkContext } from "@/components/MemoContent/DocumentLinkContext";
import { isInSiteHref, usePublicSiteRender } from "@/components/MemoContent/PublicSiteRenderContext";
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
 * root-relative in-workspace path (per docs/dev/requirements/cross-reference-repair-on-move-rename.md,
 * "链接的规范形式") that resolves to a memo, the link navigates to that document instead of being
 * treated as external. The anchor's `href` points at the memo's standard URL (`/memos/{uid}`), so
 * hover/copy/cmd-click all behave sanely, while a plain click is intercepted for SPA navigation.
 *
 * A root-relative href that does NOT resolve is a broken link (P3 retired the old tree-wide title
 * fallback, so an unresolvable path is no longer silently swallowed) — rendered distinctly so the
 * reader can tell it apart from a normal or plain external link, rather than clicking through to a
 * dead end with no visual cue.
 *
 * Everything else (external URLs, `/memos/{uid}` compat links, anything without a document-link
 * context) opens in a new tab with security attributes, same as before.
 */
export const Link = ({ children, className, href, node: _node, ...props }: LinkProps) => {
  const docLinkContext = useDocumentLinkContext();
  const publicSite = usePublicSiteRender();

  // On a published site the snapshot's own links ("/<slug>") are in-site
  // navigation, not external links to open in a new tab. They are rebased onto
  // the site's base path, which is empty on a custom domain and "/s/{site}" on
  // the platform path.
  if (publicSite && isInSiteHref(href)) {
    return (
      <RouterLink to={`${publicSite.basePath}${href}`} className={cn(markdownStyles.link, className)} {...props}>
        {children}
      </RouterLink>
    );
  }

  if (docLinkContext && isRootRelativeDocHref(href)) {
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

    return (
      <a
        href={href}
        className={cn(markdownStyles.brokenLink, className)}
        title="链接的文档不存在，可能已被移动或删除"
        onClick={(e) => e.preventDefault()}
        {...props}
      >
        {children}
      </a>
    );
  }

  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cn(markdownStyles.link, className)} {...props}>
      {children}
    </a>
  );
};
