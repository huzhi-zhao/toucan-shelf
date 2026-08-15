package store

import "context"

// WorkspaceGrantSubjectType names what kind of subject a grant is issued to. Only
// USER exists today; the field is a string so a future TEAM subject can share this
// table rather than getting one of its own.
type WorkspaceGrantSubjectType string

const (
	WorkspaceGrantSubjectUser WorkspaceGrantSubjectType = "USER"
)

// WorkspaceGrantRole is the access level a grant confers inside one workspace.
// There is deliberately no OWNER: the team owner is the single ADMIN account, whose
// access is implicit and never stored.
type WorkspaceGrantRole string

const (
	// WorkspaceGrantRoleViewer can read every document in the workspace but cannot
	// write.
	WorkspaceGrantRoleViewer WorkspaceGrantRole = "VIEWER"
	// WorkspaceGrantRoleEditor can additionally create, edit and delete documents.
	// Workspace-level operations (rename, delete, settings, folders, grants) stay
	// admin-only regardless of this role.
	WorkspaceGrantRoleEditor WorkspaceGrantRole = "EDITOR"
)

// WorkspaceAccess is what a given user may do inside one knowledge base: the
// resolved answer, combining the implicit access of the team owner with whatever
// grant the user holds. It lives in the store rather than in the API layer because
// both the API services and the attachment ACL have to reach the same verdict, and
// two implementations of it would drift.
type WorkspaceAccess int

const (
	// WorkspaceAccessNone means the workspace is invisible to this user: it must not
	// appear in listings, search results, or be reachable by id.
	WorkspaceAccessNone WorkspaceAccess = iota
	// WorkspaceAccessViewer may read every document in the workspace. Documents belong
	// to the knowledge base rather than to their author, so a viewer's read is not
	// narrowed by a document's visibility — visibility only widens access outward, to
	// people holding no grant at all.
	WorkspaceAccessViewer
	// WorkspaceAccessEditor may additionally create, edit and delete documents, and
	// organize them: folders are contents, not workspace-level configuration.
	WorkspaceAccessEditor
	// WorkspaceAccessOwner may additionally perform workspace-level operations on the
	// knowledge base itself: rename, delete, settings (cover, sort, display order,
	// hidden), and managing grants. Only the team owner (the single ADMIN account)
	// ever holds it.
	WorkspaceAccessOwner
)

// CanRead reports whether the access level permits reading documents.
func (a WorkspaceAccess) CanRead() bool { return a >= WorkspaceAccessViewer }

// CanWrite reports whether the access level permits creating/editing/deleting documents.
func (a WorkspaceAccess) CanWrite() bool { return a >= WorkspaceAccessEditor }

// CanAdminister reports whether the access level permits workspace-level operations.
func (a WorkspaceAccess) CanAdminister() bool { return a >= WorkspaceAccessOwner }

// IsTeamOwner reports whether the user is the instance's single ADMIN account, which
// implicitly owns every knowledge base.
func IsTeamOwner(user *User) bool {
	return user != nil && user.Role == RoleAdmin
}

// ResolveWorkspaceAccess answers "what may this user do in this workspace". It is the
// single funnel every workspace-scoped permission check goes through: resolve access
// first, then let document-level rules (visibility) narrow it further. Never re-derive
// access from workspace.CreatorID at a call site.
func (s *Store) ResolveWorkspaceAccess(ctx context.Context, user *User, workspaceID int32) (WorkspaceAccess, error) {
	if user == nil {
		return WorkspaceAccessNone, nil
	}
	// The team-owner short-circuit is deliberately its own step rather than folded
	// into the lookup below: a future multi-team model has to insert an "is this
	// workspace part of this admin's team" check exactly here, and the call sites
	// should not have to change when it does.
	if IsTeamOwner(user) {
		return WorkspaceAccessOwner, nil
	}

	subjectType := WorkspaceGrantSubjectUser
	grant, err := s.GetWorkspaceGrant(ctx, &FindWorkspaceGrant{
		WorkspaceID: &workspaceID,
		SubjectType: &subjectType,
		SubjectID:   &user.ID,
	})
	if err != nil {
		return WorkspaceAccessNone, err
	}
	if grant == nil {
		return WorkspaceAccessNone, nil
	}
	switch grant.Role {
	case WorkspaceGrantRoleEditor:
		return WorkspaceAccessEditor, nil
	case WorkspaceGrantRoleViewer:
		return WorkspaceAccessViewer, nil
	default:
		return WorkspaceAccessNone, nil
	}
}

// WorkspaceGrant grants one subject access to one workspace.
type WorkspaceGrant struct {
	ID          int32
	WorkspaceID int32
	SubjectType WorkspaceGrantSubjectType
	SubjectID   int32
	Role        WorkspaceGrantRole
	GrantedBy   int32
	CreatedTs   int64
}

// FindWorkspaceGrant filters grants in list/get queries.
type FindWorkspaceGrant struct {
	ID          *int32
	WorkspaceID *int32
	SubjectType *WorkspaceGrantSubjectType
	SubjectID   *int32
}

// UpdateWorkspaceGrant changes the role of an existing grant.
type UpdateWorkspaceGrant struct {
	ID   int32
	Role WorkspaceGrantRole
}

// DeleteWorkspaceGrant identifies the grants to remove. Every set field narrows the
// delete; deleting by subject alone is how a removed member loses all access at once.
type DeleteWorkspaceGrant struct {
	ID          *int32
	WorkspaceID *int32
	SubjectType *WorkspaceGrantSubjectType
	SubjectID   *int32
}

// CreateWorkspaceGrant creates a new workspace grant.
func (s *Store) CreateWorkspaceGrant(ctx context.Context, create *WorkspaceGrant) (*WorkspaceGrant, error) {
	return s.driver.CreateWorkspaceGrant(ctx, create)
}

// ListWorkspaceGrants returns all grants matching the filter.
func (s *Store) ListWorkspaceGrants(ctx context.Context, find *FindWorkspaceGrant) ([]*WorkspaceGrant, error) {
	return s.driver.ListWorkspaceGrants(ctx, find)
}

// GetWorkspaceGrant returns the first grant matching the filter, or nil if none.
func (s *Store) GetWorkspaceGrant(ctx context.Context, find *FindWorkspaceGrant) (*WorkspaceGrant, error) {
	list, err := s.ListWorkspaceGrants(ctx, find)
	if err != nil {
		return nil, err
	}
	if len(list) == 0 {
		return nil, nil
	}
	return list[0], nil
}

// UpdateWorkspaceGrant changes an existing grant's role.
func (s *Store) UpdateWorkspaceGrant(ctx context.Context, update *UpdateWorkspaceGrant) (*WorkspaceGrant, error) {
	return s.driver.UpdateWorkspaceGrant(ctx, update)
}

// DeleteWorkspaceGrant removes the grants matching the filter.
func (s *Store) DeleteWorkspaceGrant(ctx context.Context, delete *DeleteWorkspaceGrant) error {
	return s.driver.DeleteWorkspaceGrant(ctx, delete)
}
