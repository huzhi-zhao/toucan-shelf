/**
 * Every word the blog skin puts on screen.
 *
 * A published site's interface is English only — it does not follow the app's
 * i18n (that switches on a signed-in user's preference, and a reader has no
 * account) and it does not follow the reader's browser. A site's wording is the
 * site's, and an English site should not sprout Chinese buttons because of who
 * is visiting.
 *
 * Collected in one file rather than spread across the components so that if a
 * second language is ever worth its cost, what changes is this file.
 */

export const COPY = {
  searchAction: "Search this site",

  /** The home feed's heading until P2b lets the author compose the page. */
  feedTitle: "Latest",
  feedFilterLabel: "Filter by topic",
  feedAllTopics: "All",
  feedEmpty: "No posts under this topic yet.",

  galleryCta: "Read article",
  galleryEmpty: "Nothing published here yet.",

  archiveTitle: "Archive",
  archiveLoadMore: "Load more",
  archiveUndated: "Undated",
  /** Shown at the foot of a home-page feed: the feed is a slice, this is not. */
  archiveSeeAll: "See every post",

  catalogNavLabel: "Contents",
  catalogAllPosts: "All posts",
  catalogEmpty: "No posts in this section yet.",

  articleBack: "Back",
  lastUpdated: "Last updated",

  searchTitle: "Search",
  searchPlaceholder: "Search this site",
  searchPrompt: "Type to search. Only this site's published pages are searched.",
  searchNoResults: (query: string) => `No results for “${query}”.`,
  searchCount: (count: number) => `${count} ${count === 1 ? "result" : "results"}`,

  loading: "Loading…",

  notFoundTitle: "Page not found",
  notFoundBack: "Back to home",
} as const;

/** Dates are formatted for an English-language site. */
export const formatBlogDate = (date?: Date) =>
  date ? date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "";
