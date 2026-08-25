import { SearchIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { COPY } from "./copy";
import type { BlogSiteChrome } from "./types";
import "./blog.css";

interface Props {
  chrome: BlogSiteChrome;
  /** Prefix every in-site path is built on. "" when the site owns the URL root. */
  basePath: string;
  /**
   * The site's theme as `--blog-*` custom properties. The site decides how it
   * looks; a reader's own preferences and whatever the app stored in their
   * localStorage do not reach this element.
   */
  theme?: CSSProperties;
  children: ReactNode;
}

const href = (basePath: string, to: string) => (to ? `${basePath}/${to}` : basePath || "/");

/**
 * The site chrome: header, menu, footer.
 *
 * This is site-level, not document-level — it has to render on the article page
 * and the search page too, neither of which renders the home `.view`. That is
 * why the menu and the theme live in the site's configuration rather than in the
 * dashboard document.
 */
const BlogShell = ({ chrome, basePath, theme, children }: Props) => {
  return (
    <div className="blog-skin flex min-h-screen flex-col" style={theme}>
      <header className="sticky top-0 z-20 border-b border-[color:var(--blog-hairline)] bg-[color:var(--blog-bg)]">
        <div className="blog-shell flex h-[4.5rem] items-center gap-6">
          <Link to={basePath || "/"} className="blog-display shrink-0 text-xl">
            {chrome.name}
          </Link>
          <nav className="-mx-1 flex min-w-0 grow items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {chrome.menu.map((item) => (
              <NavLink
                key={item.to}
                to={href(basePath, item.to)}
                end={item.to === ""}
                className={({ isActive }) =>
                  `shrink-0 rounded-full px-3 py-2 text-[0.9375rem] transition-colors hover:bg-[color:var(--blog-surface)] ${
                    isActive ? "text-[color:var(--blog-ink)]" : "text-[color:var(--blog-ink-muted)]"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          {chrome.showSearch && (
            <Link
              to={href(basePath, "search")}
              aria-label={COPY.searchAction}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[color:var(--blog-surface)]"
            >
              <SearchIcon className="h-5 w-5" strokeWidth={1.75} />
            </Link>
          )}
        </div>
      </header>

      <main className="grow">{children}</main>

      <footer className="mt-24 border-t border-[color:var(--blog-hairline)]">
        <div className="blog-shell flex flex-col gap-2 py-10 sm:flex-row sm:items-baseline sm:justify-between">
          <span className="blog-display text-base">{chrome.name}</span>
          {chrome.description && <span className="blog-muted text-sm">{chrome.description}</span>}
        </div>
      </footer>
    </div>
  );
};

export default BlogShell;
