package v1

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/lithammer/shortuuid/v4"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/usememos/memos/internal/publish"
	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/store"
)

// SiteNamePrefix is the resource-name prefix of a site.
const SiteNamePrefix = "sites/"

// PublicationNamePrefix is the resource-name prefix of a publication within a site.
const PublicationNamePrefix = "publications/"

// defaultTeamID is the team every site currently belongs to. The instance has a
// single admin, so it has a single team; the column exists so that opening
// publishing up later is a permission change rather than a data migration.
const defaultTeamID int32 = 1

// publicationMeta is the JSON stored in site_publication.meta. It is a whitelist
// of what may leave the knowledge base: fields are added here deliberately, so a
// new internal frontmatter key cannot leak by default.
type publicationMeta struct {
	Tags []string `json:"tags,omitempty"`
	// CanonicalSite points at the site that holds the canonical copy when the
	// same document is published to several sites.
	CanonicalSite string `json:"canonicalSite,omitempty"`
}

// ExtractSiteUIDFromName returns the site UID from a resource name.
func ExtractSiteUIDFromName(name string) (string, error) {
	tokens, err := GetNameParentTokens(name, SiteNamePrefix)
	if err != nil {
		return "", err
	}
	return tokens[0], nil
}

// ExtractPublicationUIDFromName returns the site UID and publication UID from a
// resource name of the form sites/{site}/publications/{publication}.
func ExtractPublicationUIDFromName(name string) (string, string, error) {
	tokens, err := GetNameParentTokens(name, SiteNamePrefix, PublicationNamePrefix)
	if err != nil {
		return "", "", err
	}
	return tokens[0], tokens[1], nil
}

// requireSiteAdmin resolves the caller and refuses anyone who is not an admin.
// Publishing is a team-level action: a member with write access to a knowledge
// base can edit its documents, but pushing content to the whole internet does
// not come bundled with that.
func (s *APIV1Service) requireSiteAdmin(ctx context.Context) (*store.User, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get user")
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}
	if !isSuperUser(user) {
		return nil, status.Errorf(codes.PermissionDenied, "only an admin can manage sites and publish documents")
	}
	return user, nil
}

// getSiteByName loads a site by resource name.
func (s *APIV1Service) getSiteByName(ctx context.Context, name string) (*store.Site, error) {
	uid, err := ExtractSiteUIDFromName(name)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid site name: %v", err)
	}
	site, err := s.Store.GetSite(ctx, &store.FindSite{UID: &uid})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get site: %v", err)
	}
	if site == nil {
		return nil, status.Errorf(codes.NotFound, "site not found")
	}
	return site, nil
}

func (s *APIV1Service) ListSites(ctx context.Context, _ *v1pb.ListSitesRequest) (*v1pb.ListSitesResponse, error) {
	if _, err := s.requireSiteAdmin(ctx); err != nil {
		return nil, err
	}
	teamID := defaultTeamID
	sites, err := s.Store.ListSites(ctx, &store.FindSite{TeamID: &teamID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list sites: %v", err)
	}
	response := &v1pb.ListSitesResponse{Sites: make([]*v1pb.Site, 0, len(sites))}
	for _, site := range sites {
		converted, err := s.convertSiteFromStore(ctx, site)
		if err != nil {
			return nil, err
		}
		response.Sites = append(response.Sites, converted)
	}
	return response, nil
}

func (s *APIV1Service) GetSite(ctx context.Context, request *v1pb.GetSiteRequest) (*v1pb.Site, error) {
	if _, err := s.requireSiteAdmin(ctx); err != nil {
		return nil, err
	}
	site, err := s.getSiteByName(ctx, request.Name)
	if err != nil {
		return nil, err
	}
	return s.convertSiteFromStore(ctx, site)
}

func (s *APIV1Service) CreateSite(ctx context.Context, request *v1pb.CreateSiteRequest) (*v1pb.Site, error) {
	user, err := s.requireSiteAdmin(ctx)
	if err != nil {
		return nil, err
	}
	if request.Site == nil || strings.TrimSpace(request.Site.DisplayName) == "" {
		return nil, status.Errorf(codes.InvalidArgument, "site display name is required")
	}

	create := &store.Site{
		UID:         shortuuid.New(),
		TeamID:      defaultTeamID,
		CreatorID:   user.ID,
		Name:        strings.TrimSpace(request.Site.DisplayName),
		Description: request.Site.Description,
		Canonical:   store.SiteCanonicalPlatform,
		// A new site starts as a draft. Standing one up takes several steps —
		// naming it, pointing a domain at it, laying out the home page — and none
		// of that should be reachable from outside while it is half-built.
		Status:     store.SiteStatusDraft,
		Theme:      "{}",
		SearchMode: "HYBRID",
	}
	if request.Site.Theme != "" {
		if err := validateSiteTheme(request.Site.Theme); err != nil {
			return nil, err
		}
		create.Theme = request.Site.Theme
	}

	site, err := s.Store.CreateSite(ctx, create)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to create site: %v", err)
	}
	return s.convertSiteFromStore(ctx, site)
}

func (s *APIV1Service) UpdateSite(ctx context.Context, request *v1pb.UpdateSiteRequest) (*v1pb.Site, error) {
	if _, err := s.requireSiteAdmin(ctx); err != nil {
		return nil, err
	}
	if request.Site == nil {
		return nil, status.Errorf(codes.InvalidArgument, "site is required")
	}
	if request.UpdateMask == nil || len(request.UpdateMask.Paths) == 0 {
		return nil, status.Errorf(codes.InvalidArgument, "update mask is required")
	}
	site, err := s.getSiteByName(ctx, request.Site.Name)
	if err != nil {
		return nil, err
	}

	update := &store.UpdateSite{ID: site.ID}
	for _, path := range request.UpdateMask.Paths {
		switch path {
		case "display_name":
			name := strings.TrimSpace(request.Site.DisplayName)
			if name == "" {
				return nil, status.Errorf(codes.InvalidArgument, "site display name is required")
			}
			update.Name = &name
		case "description":
			update.Description = &request.Site.Description
		case "domain":
			domain := strings.ToLower(strings.TrimSpace(request.Site.Domain))
			update.Domain = &domain
			// Binding a different domain drops the previous verification: the new
			// one has not been proven to belong to this site's owner.
			verified := false
			update.DomainVerified = &verified
		case "canonical":
			canonical := convertSiteCanonicalToStore(request.Site.Canonical)
			update.Canonical = &canonical
		case "status":
			statusValue := convertSiteStatusToStore(request.Site.Status)
			update.Status = &statusValue
		case "dashboard":
			memoID, err := s.resolveDashboardMemoID(ctx, request.Site.Dashboard)
			if err != nil {
				return nil, err
			}
			update.DashboardMemoID = memoID
		case "theme":
			if err := validateSiteTheme(request.Site.Theme); err != nil {
				return nil, err
			}
			update.Theme = &request.Site.Theme
		case "search_mode":
			update.SearchMode = &request.Site.SearchMode
		default:
			return nil, status.Errorf(codes.InvalidArgument, "unsupported update path %q", path)
		}
	}

	updated, err := s.Store.UpdateSite(ctx, update)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to update site: %v", err)
	}
	return s.convertSiteFromStore(ctx, updated)
}

func (s *APIV1Service) DeleteSite(ctx context.Context, request *v1pb.DeleteSiteRequest) (*emptypb.Empty, error) {
	if _, err := s.requireSiteAdmin(ctx); err != nil {
		return nil, err
	}
	site, err := s.getSiteByName(ctx, request.Name)
	if err != nil {
		return nil, err
	}
	if err := s.Store.DeleteSite(ctx, &store.DeleteSite{ID: site.ID}); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to delete site: %v", err)
	}
	return &emptypb.Empty{}, nil
}

// resolveDashboardMemoID turns a memo resource name into the id stored on the
// site. An empty name clears the pointer.
func (s *APIV1Service) resolveDashboardMemoID(ctx context.Context, name string) (*int32, error) {
	if name == "" {
		var zero int32
		return &zero, nil
	}
	memoUID, err := ExtractMemoUIDFromName(name)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid dashboard memo name: %v", err)
	}
	memo, err := s.Store.GetMemo(ctx, &store.FindMemo{UID: &memoUID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get dashboard memo: %v", err)
	}
	if memo == nil {
		return nil, status.Errorf(codes.NotFound, "dashboard memo not found")
	}
	return &memo.ID, nil
}

// validateSiteTheme keeps a theme to configuration only. A theme that could
// carry arbitrary HTML or scripts would be stored XSS on a page served to
// anonymous readers, so the value must be a plain JSON object of scalars.
func validateSiteTheme(theme string) error {
	if strings.TrimSpace(theme) == "" {
		return nil
	}
	var parsed map[string]any
	if err := json.Unmarshal([]byte(theme), &parsed); err != nil {
		return status.Errorf(codes.InvalidArgument, "theme must be a JSON object")
	}
	for key, value := range parsed {
		switch value.(type) {
		case string, float64, bool, nil:
		default:
			return status.Errorf(codes.InvalidArgument, "theme key %q must be a string, number or boolean", key)
		}
	}
	return nil
}

func (s *APIV1Service) convertSiteFromStore(ctx context.Context, site *store.Site) (*v1pb.Site, error) {
	converted := &v1pb.Site{
		Name:           SiteNamePrefix + site.UID,
		DisplayName:    site.Name,
		Description:    site.Description,
		Domain:         site.Domain,
		DomainVerified: site.DomainVerified,
		Canonical:      convertSiteCanonicalFromStore(site.Canonical),
		Status:         convertSiteStatusFromStore(site.Status),
		Theme:          site.Theme,
		SearchMode:     site.SearchMode,
		CreateTime:     timestamppb.New(time.Unix(site.CreatedTs, 0)),
		UpdateTime:     timestamppb.New(time.Unix(site.UpdatedTs, 0)),
	}
	if site.DashboardMemoID != nil && *site.DashboardMemoID != 0 {
		memo, err := s.Store.GetMemo(ctx, &store.FindMemo{ID: site.DashboardMemoID, ExcludeContent: true})
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to get dashboard memo: %v", err)
		}
		if memo != nil {
			converted.Dashboard = MemoNamePrefix + memo.UID
		}
	}
	return converted, nil
}

func convertSiteStatusFromStore(value string) v1pb.SiteStatus {
	switch value {
	case store.SiteStatusOnline:
		return v1pb.SiteStatus_ONLINE
	case store.SiteStatusOffline:
		return v1pb.SiteStatus_OFFLINE
	default:
		return v1pb.SiteStatus_DRAFT
	}
}

func convertSiteStatusToStore(value v1pb.SiteStatus) string {
	switch value {
	case v1pb.SiteStatus_ONLINE:
		return store.SiteStatusOnline
	case v1pb.SiteStatus_OFFLINE:
		return store.SiteStatusOffline
	default:
		return store.SiteStatusDraft
	}
}

func convertSiteCanonicalFromStore(value string) v1pb.SiteCanonical {
	if value == store.SiteCanonicalDomain {
		return v1pb.SiteCanonical_DOMAIN
	}
	return v1pb.SiteCanonical_PLATFORM
}

func convertSiteCanonicalToStore(value v1pb.SiteCanonical) string {
	if value == v1pb.SiteCanonical_DOMAIN {
		return store.SiteCanonicalDomain
	}
	return store.SiteCanonicalPlatform
}

func convertPublicationStateFromStore(value string) v1pb.PublicationState {
	switch value {
	case store.SitePublicationStatePublished:
		return v1pb.PublicationState_PUBLISHED
	case store.SitePublicationStateUnpublished:
		return v1pb.PublicationState_UNPUBLISHED
	case store.SitePublicationStatePending:
		return v1pb.PublicationState_PENDING
	default:
		return v1pb.PublicationState_PUBLICATION_STATE_UNSPECIFIED
	}
}

func convertPublicationStateToStore(value v1pb.PublicationState) string {
	switch value {
	case v1pb.PublicationState_UNPUBLISHED:
		return store.SitePublicationStateUnpublished
	case v1pb.PublicationState_PENDING:
		return store.SitePublicationStatePending
	default:
		return store.SitePublicationStatePublished
	}
}

// parsePublicationMeta reads the stored meta JSON, tolerating an empty or
// malformed value: a snapshot that cannot report its tags is still readable.
func parsePublicationMeta(raw string) publicationMeta {
	meta := publicationMeta{}
	if raw == "" {
		return meta
	}
	_ = json.Unmarshal([]byte(raw), &meta)
	return meta
}

// convertPublicationFromStore converts a snapshot for the authoring API. The
// source memo is needed to decide whether the live document has moved ahead of
// the snapshot; pass nil when that is already known to be irrelevant.
func convertPublicationFromStore(site *store.Site, pub *store.SitePublication, memo *store.Memo, publisher *store.User) *v1pb.Publication {
	meta := parsePublicationMeta(pub.Meta)
	converted := &v1pb.Publication{
		Name:        SiteNamePrefix + site.UID + "/" + PublicationNamePrefix + pub.UID,
		Slug:        pub.Slug,
		Title:       pub.Title,
		Summary:     pub.Summary,
		Content:     pub.Content,
		Tags:        meta.Tags,
		State:       convertPublicationStateFromStore(pub.State),
		PublishTime: timestamppb.New(time.Unix(pub.PublishedTs, 0)),
		UpdateTime:  timestamppb.New(time.Unix(pub.UpdatedTs, 0)),
	}
	if memo != nil {
		converted.Memo = MemoNamePrefix + memo.UID
		converted.Outdated = memo.UpdatedTs > pub.SourceUpdatedTs
	}
	if publisher != nil {
		converted.Publisher = UserNamePrefix + publisher.Username
	}
	return converted
}

// slugTakenOnSite reports whether a slug is already used on a site. Publications
// that were taken down keep their slug so a restored page comes back at the same
// URL, so they count as taken too.
func (s *APIV1Service) slugTakenOnSite(ctx context.Context, siteID int32, slug string) (bool, error) {
	existing, err := s.Store.GetSitePublication(ctx, &store.FindSitePublication{
		SiteID:         &siteID,
		Slug:           &slug,
		ExcludeContent: true,
	})
	if err != nil {
		return false, err
	}
	return existing != nil, nil
}

// ensureSlugAvailable validates a slug an author typed by hand. Unlike
// generation, a manual slug is rejected rather than silently disambiguated.
func (s *APIV1Service) ensureSlugAvailable(ctx context.Context, siteID int32, slug string, selfID int32) error {
	if err := publish.ValidateSlug(slug); err != nil {
		return status.Errorf(codes.InvalidArgument, "%v", err)
	}
	existing, err := s.Store.GetSitePublication(ctx, &store.FindSitePublication{
		SiteID:         &siteID,
		Slug:           &slug,
		ExcludeContent: true,
	})
	if err != nil {
		return status.Errorf(codes.Internal, "failed to check slug: %v", err)
	}
	if existing != nil && existing.ID != selfID {
		return status.Errorf(codes.AlreadyExists, "another page on this site already uses the slug %q", slug)
	}
	return nil
}
