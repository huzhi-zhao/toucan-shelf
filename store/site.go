package store

import "context"

// Site status values. A site is only reachable by anonymous readers while it is
// SiteStatusOnline; this is independent of the instance's AllowAnonymous
// setting, which governs the main application instead.
const (
	SiteStatusDraft   = "DRAFT"
	SiteStatusOnline  = "ONLINE"
	SiteStatusOffline = "OFFLINE"
)

// Site canonical entry values: which of the two entry points (platform path or
// custom domain) search engines should treat as the real one.
const (
	SiteCanonicalPlatform = "PLATFORM"
	SiteCanonicalDomain   = "DOMAIN"
)

// Site is a blog space: a publishing target with its own name, domain, theme and
// home page. Sites belong to a team rather than to a workspace — which documents
// a site carries is decided article by article.
type Site struct {
	ID          int32
	UID         string
	TeamID      int32
	CreatorID   int32
	Name        string
	Description string
	// Domain is the custom domain bound to this site, empty when none is bound.
	Domain         string
	DomainVerified bool
	Canonical      string
	Status         string
	// DashboardMemoID points at the `.view` document rendered at the site root.
	// Nil until the author picks one.
	DashboardMemoID *int32
	Theme           string
	// Menu is the site's top menu as a JSON array of {label, path}. It is site
	// configuration rather than part of the home `.view` document because it has
	// to render on every outward-facing page, and those pages never read that
	// document.
	Menu       string
	SearchMode string
	CreatedTs       int64
	UpdatedTs       int64
}

// FindSite specifies filter criteria for querying sites.
type FindSite struct {
	ID     *int32
	UID    *string
	TeamID *int32
	Domain *string
	Status *string
	// DashboardMemoID finds the sites pointing at a given document, which is how
	// "this document is a site home page, refuse to delete it" is answered.
	DashboardMemoID *int32
}

// UpdateSite contains the fields that can be updated on a site.
type UpdateSite struct {
	ID              int32
	Name            *string
	Description     *string
	Domain          *string
	DomainVerified  *bool
	Canonical       *string
	Status          *string
	DashboardMemoID *int32
	Theme           *string
	Menu            *string
	SearchMode      *string
}

// DeleteSite specifies which site to delete.
type DeleteSite struct {
	ID int32
}

// CreateSite creates a new site.
func (s *Store) CreateSite(ctx context.Context, create *Site) (*Site, error) {
	return s.driver.CreateSite(ctx, create)
}

// ListSites retrieves sites matching the filter criteria.
func (s *Store) ListSites(ctx context.Context, find *FindSite) ([]*Site, error) {
	return s.driver.ListSites(ctx, find)
}

// GetSite retrieves a single site matching the filter criteria, or nil if none match.
func (s *Store) GetSite(ctx context.Context, find *FindSite) (*Site, error) {
	list, err := s.ListSites(ctx, find)
	if err != nil {
		return nil, err
	}
	if len(list) == 0 {
		return nil, nil
	}
	return list[0], nil
}

// UpdateSite updates an existing site.
func (s *Store) UpdateSite(ctx context.Context, update *UpdateSite) (*Site, error) {
	return s.driver.UpdateSite(ctx, update)
}

// DeleteSite permanently removes a site along with its publications.
func (s *Store) DeleteSite(ctx context.Context, delete *DeleteSite) error {
	return s.driver.DeleteSite(ctx, delete)
}
