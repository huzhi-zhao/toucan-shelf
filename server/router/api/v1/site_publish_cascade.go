package v1

import (
	"context"
	"log/slog"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/usememos/memos/store"
)

// guardMemoIsNotSiteDashboard refuses to archive or delete a document that a site
// points at as its home page. Losing it would leave the site without a front
// door, and the site holds only a pointer — there is nothing for it to fall back
// to. This mirrors the existing "refuse while something still references you"
// rule for ordinary cross-document links.
func (s *APIV1Service) guardMemoIsNotSiteDashboard(ctx context.Context, memoID int32) error {
	sites, err := s.Store.ListSites(ctx, &store.FindSite{DashboardMemoID: &memoID})
	if err != nil {
		return status.Errorf(codes.Internal, "failed to check site dashboards: %v", err)
	}
	if len(sites) == 0 {
		return nil
	}
	names := make([]string, 0, len(sites))
	for _, site := range sites {
		names = append(names, site.Name)
	}
	return status.Errorf(codes.FailedPrecondition,
		"this document is the home page of %d site(s): %v. Point those sites at another document first.",
		len(names), names)
}

// takeDownPublicationsForMemoBestEffort unpublishes every live page backed by a
// document that just went into the recycle bin. Archiving equals a takedown
// (requirement §9): the public read path only looks at publication state, so
// without this an archived document stays readable on the site — the author
// believes they pulled it and the page is still up.
//
// Best-effort with a warning log rather than failing the archive: the archive
// itself already succeeded, and refusing to report it would leave the caller
// thinking nothing happened at all. A failure here is visible in the publish
// panel, which reads publication state directly.
func (s *APIV1Service) takeDownPublicationsForMemoBestEffort(ctx context.Context, memoID int32) {
	published := store.SitePublicationStatePublished
	publications, err := s.Store.ListSitePublications(ctx, &store.FindSitePublication{
		MemoID:         &memoID,
		State:          &published,
		ExcludeContent: true,
	})
	if err != nil {
		slog.Warn("failed to list publications for archived memo", slog.Any("err", err), slog.Int("memoID", int(memoID)))
		return
	}
	unpublished := store.SitePublicationStateUnpublished
	for _, pub := range publications {
		if _, err := s.Store.UpdateSitePublication(ctx, &store.UpdateSitePublication{ID: pub.ID, State: &unpublished}); err != nil {
			slog.Warn("failed to take down publication for archived memo",
				slog.Any("err", err), slog.Int("publicationID", int(pub.ID)))
		}
	}
}
