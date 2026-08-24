package v1

import (
	"context"
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/store"
)

// OriginalHostHeader carries the Host a request arrived on. Go keeps Host off the
// header map, so an edge middleware stamps it here for the RPC layer to read.
const OriginalHostHeader = "X-Original-Host"

// resolveSiteForReader finds the site a public request belongs to and refuses
// anything that is not online.
//
// Two things about this function are load-bearing. First, the site's own status
// is the whole decision: whether the main application serves anonymous visitors
// is a different question, and tying the two together would mean a private
// instance could not publish at all, or had to open its whole app up to publish
// one article. Second, the Host is resolved before the explicit site name, so a
// reader on a custom domain can never be steered to another site's content by a
// query parameter.
func (s *APIV1Service) resolveSiteForReader(ctx context.Context, siteName string) (*store.Site, error) {
	if host := hostFromContext(ctx); host != "" {
		domain := normalizeHost(host)
		site, err := s.Store.GetSite(ctx, &store.FindSite{Domain: &domain})
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to resolve site: %v", err)
		}
		if site != nil {
			return requireOnlineSite(site)
		}
	}
	if siteName == "" {
		return nil, status.Errorf(codes.NotFound, "site not found")
	}
	uid, err := ExtractSiteUIDFromName(siteName)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid site name: %v", err)
	}
	site, err := s.Store.GetSite(ctx, &store.FindSite{UID: &uid})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to resolve site: %v", err)
	}
	if site == nil {
		return nil, status.Errorf(codes.NotFound, "site not found")
	}
	return requireOnlineSite(site)
}

// requireOnlineSite makes an offline or draft site indistinguishable from one
// that does not exist.
func requireOnlineSite(site *store.Site) (*store.Site, error) {
	if site.Status != store.SiteStatusOnline {
		return nil, status.Errorf(codes.NotFound, "site not found")
	}
	return site, nil
}

func hostFromContext(ctx context.Context) string {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return ""
	}
	for _, key := range []string{strings.ToLower(OriginalHostHeader), "x-forwarded-host"} {
		if values := md.Get(key); len(values) > 0 && values[0] != "" {
			return values[0]
		}
	}
	return ""
}

// normalizeHost strips the port and lower-cases a Host value so it matches the
// stored domain.
func normalizeHost(host string) string {
	host = strings.ToLower(strings.TrimSpace(host))
	if idx := strings.LastIndex(host, ":"); idx > 0 && !strings.Contains(host[idx:], "]") {
		host = host[:idx]
	}
	return strings.TrimSuffix(host, ".")
}

func (s *APIV1Service) GetPublicSiteProfile(ctx context.Context, request *v1pb.GetPublicSiteProfileRequest) (*v1pb.PublicSiteProfile, error) {
	site, err := s.resolveSiteForReader(ctx, request.Site)
	if err != nil {
		return nil, err
	}
	profile := &v1pb.PublicSiteProfile{
		DisplayName: site.Name,
		Description: site.Description,
		Theme:       site.Theme,
	}
	if site.DashboardMemoID != nil && *site.DashboardMemoID != 0 {
		published := store.SitePublicationStatePublished
		pub, err := s.Store.GetSitePublication(ctx, &store.FindSitePublication{
			SiteID:         &site.ID,
			MemoID:         site.DashboardMemoID,
			State:          &published,
			ExcludeContent: true,
		})
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to resolve dashboard: %v", err)
		}
		if pub != nil {
			profile.DashboardSlug = pub.Slug
		}
	}
	return profile, nil
}

func (s *APIV1Service) GetPublicPage(ctx context.Context, request *v1pb.GetPublicPageRequest) (*v1pb.PublicPage, error) {
	site, err := s.resolveSiteForReader(ctx, request.Site)
	if err != nil {
		return nil, err
	}
	if request.Slug == "" {
		return nil, status.Errorf(codes.InvalidArgument, "slug is required")
	}
	published := store.SitePublicationStatePublished
	pub, err := s.Store.GetSitePublication(ctx, &store.FindSitePublication{
		SiteID: &site.ID,
		Slug:   &request.Slug,
		State:  &published,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get page: %v", err)
	}
	if pub == nil {
		return nil, status.Errorf(codes.NotFound, "page not found")
	}
	return s.convertPublicPage(ctx, pub, true)
}

func (s *APIV1Service) ResolvePublicDoc(ctx context.Context, request *v1pb.ResolvePublicDocRequest) (*v1pb.ResolvePublicDocResponse, error) {
	site, err := s.resolveSiteForReader(ctx, request.Site)
	if err != nil {
		return nil, err
	}
	if request.DocId == "" {
		return nil, status.Errorf(codes.InvalidArgument, "doc id is required")
	}
	memo, err := s.Store.GetMemo(ctx, &store.FindMemo{UID: &request.DocId, ExcludeContent: true})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to resolve document: %v", err)
	}
	if memo == nil {
		return nil, status.Errorf(codes.NotFound, "page not found")
	}
	// The short link is scoped to the site being visited. A document published to
	// a different site — or not published at all — must not be discoverable by
	// probing doc ids under this domain.
	published := store.SitePublicationStatePublished
	pub, err := s.Store.GetSitePublication(ctx, &store.FindSitePublication{
		SiteID:         &site.ID,
		MemoID:         &memo.ID,
		State:          &published,
		ExcludeContent: true,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to resolve page: %v", err)
	}
	if pub == nil {
		return nil, status.Errorf(codes.NotFound, "page not found")
	}
	return &v1pb.ResolvePublicDocResponse{Slug: pub.Slug}, nil
}

func (s *APIV1Service) ListPublicPages(ctx context.Context, request *v1pb.ListPublicPagesRequest) (*v1pb.ListPublicPagesResponse, error) {
	site, err := s.resolveSiteForReader(ctx, request.Site)
	if err != nil {
		return nil, err
	}
	limit := normalizePageSize(request.PageSize)
	offset := 0
	if request.PageToken != "" {
		token := &v1pb.PageToken{}
		if err := unmarshalPageToken(request.PageToken, token); err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "invalid page token: %v", err)
		}
		limit, offset = int(token.Limit), int(token.Offset)
	}

	published := store.SitePublicationStatePublished
	fetch := limit + 1
	publications, err := s.Store.ListSitePublications(ctx, &store.FindSitePublication{
		SiteID:         &site.ID,
		State:          &published,
		ExcludeContent: true,
		Limit:          &fetch,
		Offset:         &offset,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list pages: %v", err)
	}

	response := &v1pb.ListPublicPagesResponse{}
	for i, pub := range publications {
		if i >= limit {
			nextToken, err := getPageToken(limit, offset+limit)
			if err != nil {
				return nil, status.Errorf(codes.Internal, "failed to build page token: %v", err)
			}
			response.NextPageToken = nextToken
			break
		}
		page, err := s.convertPublicPage(ctx, pub, false)
		if err != nil {
			return nil, err
		}
		if len(request.Tags) > 0 && !hasAllTags(page.Tags, request.Tags) {
			continue
		}
		response.Pages = append(response.Pages, page)
	}
	return response, nil
}

func hasAllTags(pageTags, wanted []string) bool {
	have := make(map[string]struct{}, len(pageTags))
	for _, tag := range pageTags {
		have[tag] = struct{}{}
	}
	for _, tag := range wanted {
		if _, ok := have[tag]; !ok {
			return false
		}
	}
	return true
}

// convertPublicPage builds the reader-facing view of a snapshot. Fields land here
// by whitelist: comments, history, internal frontmatter, memogit markers and the
// author's account are absent because nothing added them, not because a filter
// removed them.
func (s *APIV1Service) convertPublicPage(ctx context.Context, pub *store.SitePublication, includeContent bool) (*v1pb.PublicPage, error) {
	meta := parsePublicationMeta(pub.Meta)
	page := &v1pb.PublicPage{
		Slug:       pub.Slug,
		Title:      pub.Title,
		Summary:    pub.Summary,
		Tags:       meta.Tags,
		UpdateTime: timestamppb.New(time.Unix(pub.UpdatedTs, 0)),
	}
	if includeContent {
		page.Content = pub.Content
	}
	memo, err := s.Store.GetMemo(ctx, &store.FindMemo{ID: &pub.MemoID, ExcludeContent: true})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get source document: %v", err)
	}
	if memo != nil {
		page.DocId = memo.UID
	}
	return page, nil
}
