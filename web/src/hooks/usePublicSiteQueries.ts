// The anonymous read path. These queries only ever reach PublicSiteService, which
// only ever queries the publication tables — unpublished content is not filtered
// out there, it is not in the query range at all. Nothing on a public page may
// call a memo/workspace API: that is the difference between "we remembered the
// condition" and "there is nothing to leak".

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { publicSiteServiceClient } from "@/connect";

export const publicSiteKeys = {
  all: ["public-site"] as const,
  profile: (site: string) => [...publicSiteKeys.all, "profile", site] as const,
  page: (site: string, slug: string) => [...publicSiteKeys.all, "page", site, slug] as const,
  pages: (site: string, tags: string[]) => [...publicSiteKeys.all, "pages", site, tags.join(",")] as const,
  search: (site: string, query: string) => [...publicSiteKeys.all, "search", site, query] as const,
  doc: (site: string, docId: string) => [...publicSiteKeys.all, "doc", site, docId] as const,
  archive: (site: string) => [...publicSiteKeys.all, "archive", site] as const,
};

export function usePublicSiteProfile(site: string) {
  return useQuery({
    queryKey: publicSiteKeys.profile(site),
    queryFn: () => publicSiteServiceClient.getPublicSiteProfile({ site }),
    retry: false,
  });
}

export function usePublicPage(site: string, slug: string) {
  return useQuery({
    queryKey: publicSiteKeys.page(site, slug),
    queryFn: () => publicSiteServiceClient.getPublicPage({ site, slug }),
    enabled: Boolean(slug),
    retry: false,
  });
}

export function usePublicPages(site: string, tags: string[] = []) {
  return useQuery({
    queryKey: publicSiteKeys.pages(site, tags),
    queryFn: async () => (await publicSiteServiceClient.listPublicPages({ site, tags })).pages,
    retry: false,
  });
}

// Search runs on the server against the publication snapshots. It is not a
// filter over the loaded feed: the feed is one page of entries and carries no
// bodies, so filtering it would silently search only the newest few titles.
export function usePublicPageSearch(site: string, query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: publicSiteKeys.search(site, trimmed),
    queryFn: async () => (await publicSiteServiceClient.searchPublicPages({ site, query: trimmed })).pages,
    enabled: trimmed.length > 0,
    retry: false,
  });
}

export function usePublicDocSlug(site: string, docId: string) {
  return useQuery({
    queryKey: publicSiteKeys.doc(site, docId),
    queryFn: async () => (await publicSiteServiceClient.resolvePublicDoc({ site, docId })).slug,
    enabled: Boolean(docId),
    retry: false,
  });
}

/** How many entries the archive asks for at a time. */
export const ARCHIVE_PAGE_SIZE = 50;

/**
 * Every page this site has published, a screenful at a time.
 *
 * The listing endpoint pages with an opaque cursor, so this walks it rather than
 * asking for one large page: a site with several hundred entries would otherwise
 * be silently cut off at the server's default page size, which is exactly the
 * failure the archive exists to prevent.
 *
 * Deliberately unfiltered. The listing applies its tag filter after the page
 * limit, so a tag-filtered request can hand back an empty page that still has a
 * cursor; the archive therefore loads pages as published and narrows by tag in
 * the browser, over the entries it actually holds.
 */
export function usePublicPagesArchive(site: string) {
  return useInfiniteQuery({
    queryKey: publicSiteKeys.archive(site),
    queryFn: ({ pageParam }) => publicSiteServiceClient.listPublicPages({ site, pageSize: ARCHIVE_PAGE_SIZE, pageToken: pageParam }),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextPageToken || undefined,
    retry: false,
  });
}
