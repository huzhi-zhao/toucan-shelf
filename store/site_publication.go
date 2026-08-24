package store

import "context"

// Publication state values. State is an enum rather than a bool so that a
// review step (SitePublicationStatePending) can be added later without a
// schema change.
const (
	SitePublicationStatePublished   = "PUBLISHED"
	SitePublicationStateUnpublished = "UNPUBLISHED"
	SitePublicationStatePending     = "PENDING"
)

// SitePublication is one read-only snapshot: the publish pipeline's output for
// one document on one site. Outward-facing pages are served from these rows and
// never from the memo table.
type SitePublication struct {
	ID     int32
	UID    string
	SiteID int32
	MemoID int32
	// Slug is generated on first publish and then frozen — regenerating it on a
	// title change would break every external link.
	Slug    string
	Title   string
	Summary string
	Content string
	Meta    string
	// SourceUpdatedTs is the source document's UpdatedTs at snapshot time. The
	// editor compares it against the live document to show "the published
	// version is behind".
	SourceUpdatedTs int64
	State           string
	PublisherID     int32
	PublishedTs     int64
	UpdatedTs       int64
}

// FindSitePublication specifies filter criteria for querying publications.
type FindSitePublication struct {
	ID     *int32
	UID    *string
	SiteID *int32
	MemoID *int32
	Slug   *string
	State  *string
	// MemoIDList restricts results to these documents. An empty (non-nil) list
	// matches nothing.
	MemoIDList []int32
	// ExcludeContent skips the snapshot body, which is the large column.
	ExcludeContent bool
	Limit          *int
	Offset         *int
}

// UpdateSitePublication contains the fields that can be updated on a publication.
type UpdateSitePublication struct {
	ID              int32
	Slug            *string
	Title           *string
	Summary         *string
	Content         *string
	Meta            *string
	SourceUpdatedTs *int64
	State           *string
	PublisherID     *int32
	PublishedTs     *int64
}

// DeleteSitePublication specifies which publication to delete.
type DeleteSitePublication struct {
	ID int32
}

// SitePublicationAttachment records that a snapshot references an attachment.
// Publishing never changes an attachment's access, so this is a reference index
// rather than a grant ledger: it answers which live pages would break if a file
// went private again.
type SitePublicationAttachment struct {
	PublicationID int32
	AttachmentID  int32
}

// FindSitePublicationAttachment filters attachment references.
type FindSitePublicationAttachment struct {
	PublicationID *int32
	AttachmentID  *int32
	// PublishedOnly restricts the result to references held by publications that
	// are still PUBLISHED — the pages a reader can actually reach.
	PublishedOnly bool
}

// SitePublicationLink is an in-site document link frozen into a snapshot. It is
// separate from MemoLink on purpose: that table indexes the live body, which
// diverges from the snapshot as soon as the author edits again.
type SitePublicationLink struct {
	PublicationID int32
	TargetMemoID  int32
	RawHref       string
}

// FindSitePublicationLink filters snapshot links.
type FindSitePublicationLink struct {
	PublicationID *int32
	TargetMemoID  *int32
	SiteID        *int32
	// PublishedOnly restricts the result to links held by publications that are
	// still PUBLISHED — the ones that would turn into dead links.
	PublishedOnly bool
}

// CreateSitePublication creates a new publication snapshot.
func (s *Store) CreateSitePublication(ctx context.Context, create *SitePublication) (*SitePublication, error) {
	return s.driver.CreateSitePublication(ctx, create)
}

// ListSitePublications retrieves publications matching the filter criteria.
func (s *Store) ListSitePublications(ctx context.Context, find *FindSitePublication) ([]*SitePublication, error) {
	return s.driver.ListSitePublications(ctx, find)
}

// GetSitePublication retrieves a single publication, or nil if none match.
func (s *Store) GetSitePublication(ctx context.Context, find *FindSitePublication) (*SitePublication, error) {
	list, err := s.ListSitePublications(ctx, find)
	if err != nil {
		return nil, err
	}
	if len(list) == 0 {
		return nil, nil
	}
	return list[0], nil
}

// UpdateSitePublication updates an existing publication snapshot.
func (s *Store) UpdateSitePublication(ctx context.Context, update *UpdateSitePublication) (*SitePublication, error) {
	return s.driver.UpdateSitePublication(ctx, update)
}

// DeleteSitePublication permanently removes a publication and its side tables.
func (s *Store) DeleteSitePublication(ctx context.Context, delete *DeleteSitePublication) error {
	return s.driver.DeleteSitePublication(ctx, delete)
}

// ReplaceSitePublicationAttachments overwrites the full attachment reference set
// for a publication, mirroring the snapshot it was derived from.
func (s *Store) ReplaceSitePublicationAttachments(ctx context.Context, publicationID int32, refs []*SitePublicationAttachment) error {
	return s.driver.ReplaceSitePublicationAttachments(ctx, publicationID, refs)
}

// ListSitePublicationAttachments queries snapshot attachment references.
func (s *Store) ListSitePublicationAttachments(ctx context.Context, find *FindSitePublicationAttachment) ([]*SitePublicationAttachment, error) {
	return s.driver.ListSitePublicationAttachments(ctx, find)
}

// ReplaceSitePublicationLinks overwrites the full outbound link set frozen into
// a publication.
func (s *Store) ReplaceSitePublicationLinks(ctx context.Context, publicationID int32, links []*SitePublicationLink) error {
	return s.driver.ReplaceSitePublicationLinks(ctx, publicationID, links)
}

// ListSitePublicationLinks queries snapshot links. Use TargetMemoID to find the
// published pages that would break if a document were taken down.
func (s *Store) ListSitePublicationLinks(ctx context.Context, find *FindSitePublicationLink) ([]*SitePublicationLink, error) {
	return s.driver.ListSitePublicationLinks(ctx, find)
}
