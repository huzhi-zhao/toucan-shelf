package v1

import (
	"context"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/store"
)

func (s *APIV1Service) ListPublications(ctx context.Context, request *v1pb.ListPublicationsRequest) (*v1pb.ListPublicationsResponse, error) {
	if _, err := s.requireSiteAdmin(ctx); err != nil {
		return nil, err
	}
	site, err := s.getSiteByName(ctx, request.Parent)
	if err != nil {
		return nil, err
	}

	find := &store.FindSitePublication{SiteID: &site.ID, ExcludeContent: true}
	if request.State != v1pb.PublicationState_PUBLICATION_STATE_UNSPECIFIED {
		stateValue := convertPublicationStateToStore(request.State)
		find.State = &stateValue
	}
	publications, err := s.Store.ListSitePublications(ctx, find)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list publications: %v", err)
	}

	response := &v1pb.ListPublicationsResponse{Publications: make([]*v1pb.Publication, 0, len(publications))}
	for _, pub := range publications {
		memo, err := s.Store.GetMemo(ctx, &store.FindMemo{ID: &pub.MemoID, ExcludeContent: true})
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to get source document: %v", err)
		}
		publisher, err := s.Store.GetUser(ctx, &store.FindUser{ID: &pub.PublisherID})
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to get publisher: %v", err)
		}
		response.Publications = append(response.Publications, convertPublicationFromStore(site, pub, memo, publisher))
	}
	return response, nil
}

// ListMemoPublications answers "where is this document live, and has it moved on
// since?" — the question the editor asks to show the update-publication prompt.
// Without it the snapshot model reads to an author as "I saved my edit and
// nothing happened".
func (s *APIV1Service) ListMemoPublications(ctx context.Context, request *v1pb.ListMemoPublicationsRequest) (*v1pb.ListMemoPublicationsResponse, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get user")
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}
	memo, err := s.getMemoByName(ctx, request.Parent)
	if err != nil {
		return nil, err
	}
	if err := s.checkMemoReadAccess(ctx, memo); err != nil {
		return nil, err
	}

	publications, err := s.Store.ListSitePublications(ctx, &store.FindSitePublication{
		MemoID:         &memo.ID,
		ExcludeContent: true,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list publications: %v", err)
	}

	response := &v1pb.ListMemoPublicationsResponse{}
	for _, pub := range publications {
		site, err := s.Store.GetSite(ctx, &store.FindSite{ID: &pub.SiteID})
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to get site: %v", err)
		}
		if site == nil {
			continue
		}
		publisher, err := s.Store.GetUser(ctx, &store.FindUser{ID: &pub.PublisherID})
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to get publisher: %v", err)
		}
		convertedSite, err := s.convertSiteFromStore(ctx, site)
		if err != nil {
			return nil, err
		}
		response.Publications = append(response.Publications, convertPublicationFromStore(site, pub, memo, publisher))
		response.Sites = append(response.Sites, convertedSite)
	}
	return response, nil
}

func (s *APIV1Service) UpdatePublication(ctx context.Context, request *v1pb.UpdatePublicationRequest) (*v1pb.Publication, error) {
	if _, err := s.requireSiteAdmin(ctx); err != nil {
		return nil, err
	}
	if request.Publication == nil {
		return nil, status.Errorf(codes.InvalidArgument, "publication is required")
	}
	if request.UpdateMask == nil || len(request.UpdateMask.Paths) == 0 {
		return nil, status.Errorf(codes.InvalidArgument, "update mask is required")
	}
	site, pub, err := s.getPublicationByName(ctx, request.Publication.Name)
	if err != nil {
		return nil, err
	}

	update := &store.UpdateSitePublication{ID: pub.ID}
	for _, path := range request.UpdateMask.Paths {
		switch path {
		case "slug":
			// A hand-typed slug is rejected on collision rather than quietly
			// disambiguated: the author asked for a specific URL and should hear
			// that they cannot have it.
			if err := s.ensureSlugAvailable(ctx, site.ID, request.Publication.Slug, pub.ID); err != nil {
				return nil, err
			}
			update.Slug = &request.Publication.Slug
		default:
			return nil, status.Errorf(codes.InvalidArgument, "unsupported update path %q", path)
		}
	}

	updated, err := s.Store.UpdateSitePublication(ctx, update)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to update publication: %v", err)
	}
	memo, err := s.Store.GetMemo(ctx, &store.FindMemo{ID: &pub.MemoID, ExcludeContent: true})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get source document: %v", err)
	}
	return convertPublicationFromStore(site, updated, memo, nil), nil
}

func (s *APIV1Service) UnpublishMemo(ctx context.Context, request *v1pb.UnpublishMemoRequest) (*v1pb.UnpublishMemoResponse, error) {
	if _, err := s.requireSiteAdmin(ctx); err != nil {
		return nil, err
	}
	site, pub, err := s.getPublicationByName(ctx, request.Name)
	if err != nil {
		return nil, err
	}
	return s.unpublishPublication(ctx, site, pub)
}

// unpublishPublication takes a page down. Archiving the source document routes
// here too: the requirement is that a document in the recycle bin is off the site
// for the same reasons an explicit takedown is.
//
// Attachment access is untouched, because publishing never granted any. A file
// that is public is public because its owner said so, and a page coming down is
// not a reason to overturn that on their behalf — the same reasoning that keeps
// publishing from opening files up in the first place.
func (s *APIV1Service) unpublishPublication(ctx context.Context, site *store.Site, pub *store.SitePublication) (*v1pb.UnpublishMemoResponse, error) {
	unpublished := store.SitePublicationStateUnpublished
	if _, err := s.Store.UpdateSitePublication(ctx, &store.UpdateSitePublication{ID: pub.ID, State: &unpublished}); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to unpublish: %v", err)
	}

	// Snapshots do not follow a takedown, so pages that linked here keep a dead
	// link until someone republishes them. Report them rather than let the author
	// find out from a reader.
	inbound, err := s.Store.ListSitePublicationLinks(ctx, &store.FindSitePublicationLink{
		TargetMemoID:  &pub.MemoID,
		SiteID:        &site.ID,
		PublishedOnly: true,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list inbound links: %v", err)
	}

	response := &UnpublishResult{}
	for _, link := range inbound {
		affected, err := s.Store.GetSitePublication(ctx, &store.FindSitePublication{ID: &link.PublicationID, ExcludeContent: true})
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to get affected publication: %v", err)
		}
		if affected == nil || affected.ID == pub.ID {
			continue
		}
		response.Affected = append(response.Affected, convertPublicationFromStore(site, affected, nil, nil))
	}

	return &v1pb.UnpublishMemoResponse{AffectedPublications: response.Affected}, nil
}

// UnpublishResult carries what a takedown produced before it is converted to the
// wire type; archiving a document reuses it without going through the RPC.
type UnpublishResult struct {
	Affected []*v1pb.Publication
}

// getPublicationByName resolves sites/{site}/publications/{publication}.
func (s *APIV1Service) getPublicationByName(ctx context.Context, name string) (*store.Site, *store.SitePublication, error) {
	siteUID, pubUID, err := ExtractPublicationUIDFromName(name)
	if err != nil {
		return nil, nil, status.Errorf(codes.InvalidArgument, "invalid publication name: %v", err)
	}
	site, err := s.Store.GetSite(ctx, &store.FindSite{UID: &siteUID})
	if err != nil {
		return nil, nil, status.Errorf(codes.Internal, "failed to get site: %v", err)
	}
	if site == nil {
		return nil, nil, status.Errorf(codes.NotFound, "site not found")
	}
	pub, err := s.Store.GetSitePublication(ctx, &store.FindSitePublication{UID: &pubUID, SiteID: &site.ID, ExcludeContent: true})
	if err != nil {
		return nil, nil, status.Errorf(codes.Internal, "failed to get publication: %v", err)
	}
	if pub == nil {
		return nil, nil, status.Errorf(codes.NotFound, "publication not found")
	}
	return site, pub, nil
}
