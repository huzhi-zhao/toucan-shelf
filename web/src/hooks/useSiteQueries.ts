// The authoring side of publishing: sites and the snapshots published to them.
// Everything here talks to SiteService, which requires a session and — for now —
// the ADMIN role. The anonymous read path lives in usePublicSiteQueries.ts and
// shares nothing with this file on purpose (需求 §1: 发布与分享是两条链路).

import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { FieldMaskSchema } from "@bufbuild/protobuf/wkt";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { siteServiceClient } from "@/connect";
import { PublicationSchema, SiteSchema } from "@/types/proto/api/v1/site_service_pb";

/** Field-wise init shape of a Site — what the forms build before it is sent. */
export type SiteInit = MessageInitShape<typeof SiteSchema>;

export const siteKeys = {
  all: ["sites"] as const,
  list: () => [...siteKeys.all, "list"] as const,
  publications: (siteName: string) => [...siteKeys.all, "publications", siteName] as const,
  memoPublications: (memoName: string) => [...siteKeys.all, "memo-publications", memoName] as const,
};

export function useSites(enabled = true) {
  return useQuery({
    queryKey: siteKeys.list(),
    queryFn: async () => (await siteServiceClient.listSites({})).sites,
    enabled,
  });
}

export function useSitePublications(siteName: string, enabled = true) {
  return useQuery({
    queryKey: siteKeys.publications(siteName),
    queryFn: async () => (await siteServiceClient.listPublications({ parent: siteName })).publications,
    enabled: enabled && Boolean(siteName),
  });
}

/**
 * Every site a document is published to. This is what tells the editor that the
 * live document has moved ahead of what readers see — readers keep seeing the
 * frozen snapshot until someone republishes, so without this the author has no
 * way to notice their edit never went out.
 */
export function useMemoPublications(memoName: string, enabled = true) {
  return useQuery({
    queryKey: siteKeys.memoPublications(memoName),
    queryFn: async () => siteServiceClient.listMemoPublications({ parent: memoName }),
    enabled: enabled && Boolean(memoName),
  });
}

export function useCreateSite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (site: SiteInit) => siteServiceClient.createSite({ site: create(SiteSchema, site) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: siteKeys.all }),
  });
}

export function useUpdateSite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ site, paths }: { site: SiteInit; paths: string[] }) =>
      siteServiceClient.updateSite({ site: create(SiteSchema, site), updateMask: create(FieldMaskSchema, { paths }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: siteKeys.all }),
  });
}

export function useDeleteSite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => siteServiceClient.deleteSite({ name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: siteKeys.all }),
  });
}

/**
 * Runs the publish pipeline's checks without writing anything. The panel calls
 * this before offering the button, so the author sees the blockers and the
 * "readers cannot fetch these files" list *before* committing rather than as a
 * failed request afterwards.
 */
export function usePreviewPublish() {
  return useMutation({
    mutationFn: ({ site, memo }: { site: string; memo: string }) => siteServiceClient.previewPublish({ parent: site, memo }),
  });
}

export function usePublishMemo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ site, memo }: { site: string; memo: string }) => siteServiceClient.publishMemo({ parent: site, memo }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: siteKeys.all }),
  });
}

export function useUpdatePublicationSlug() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, slug }: { name: string; slug: string }) =>
      siteServiceClient.updatePublication({
        publication: create(PublicationSchema, { name, slug }),
        updateMask: create(FieldMaskSchema, { paths: ["slug"] }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: siteKeys.all }),
  });
}

export function useUnpublishMemo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => siteServiceClient.unpublishMemo({ name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: siteKeys.all }),
  });
}
