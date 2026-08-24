// The anonymous read path. These queries only ever reach PublicSiteService, which
// only ever queries the publication tables — unpublished content is not filtered
// out there, it is not in the query range at all. Nothing on a public page may
// call a memo/workspace API: that is the difference between "we remembered the
// condition" and "there is nothing to leak".

import { useQuery } from "@tanstack/react-query";
import { publicSiteServiceClient } from "@/connect";

export const publicSiteKeys = {
  all: ["public-site"] as const,
  profile: (site: string) => [...publicSiteKeys.all, "profile", site] as const,
  page: (site: string, slug: string) => [...publicSiteKeys.all, "page", site, slug] as const,
  pages: (site: string, tags: string[]) => [...publicSiteKeys.all, "pages", site, tags.join(",")] as const,
  doc: (site: string, docId: string) => [...publicSiteKeys.all, "doc", site, docId] as const,
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

export function usePublicDocSlug(site: string, docId: string) {
  return useQuery({
    queryKey: publicSiteKeys.doc(site, docId),
    queryFn: async () => (await publicSiteServiceClient.resolvePublicDoc({ site, docId })).slug,
    enabled: Boolean(docId),
    retry: false,
  });
}
