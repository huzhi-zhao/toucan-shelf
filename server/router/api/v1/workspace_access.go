package v1

import (
	"context"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/usememos/memos/store"
)

// WorkspaceRole names, for this package's call sites, the access level a user holds
// in one knowledge base. The resolution itself lives in the store (see
// store.ResolveWorkspaceAccess) because the attachment ACL has to reach the same
// verdict from outside this package.
type WorkspaceRole = store.WorkspaceAccess

const (
	WorkspaceRoleNone   = store.WorkspaceAccessNone
	WorkspaceRoleViewer = store.WorkspaceAccessViewer
	WorkspaceRoleEditor = store.WorkspaceAccessEditor
	WorkspaceRoleOwner  = store.WorkspaceAccessOwner
)

// resolveWorkspaceAccess answers "what may this user do in this workspace".
func (s *APIV1Service) resolveWorkspaceAccess(ctx context.Context, user *store.User, workspaceID int32) (WorkspaceRole, error) {
	return s.Store.ResolveWorkspaceAccess(ctx, user, workspaceID)
}

// isTeamOwner reports whether the user is the instance's single ADMIN account,
// which implicitly owns every knowledge base.
func isTeamOwner(user *store.User) bool {
	return store.IsTeamOwner(user)
}

// accessibleWorkspaceIDs returns the ids of every workspace the user may read.
// The boolean reports "all of them" — true for the team owner, whose access is
// implicit and therefore not enumerable from the grant table. Callers filtering a
// query use it to skip adding any workspace restriction at all.
//
// This exists so cross-workspace listings (search, Explore) resolve access once
// instead of calling resolveWorkspaceAccess per candidate row.
func (s *APIV1Service) accessibleWorkspaceIDs(ctx context.Context, user *store.User) (all bool, ids []int32, err error) {
	if user == nil {
		return false, nil, nil
	}
	if isTeamOwner(user) {
		return true, nil, nil
	}
	subjectType := store.WorkspaceGrantSubjectUser
	grants, err := s.Store.ListWorkspaceGrants(ctx, &store.FindWorkspaceGrant{
		SubjectType: &subjectType,
		SubjectID:   &user.ID,
	})
	if err != nil {
		return false, nil, err
	}
	ids = make([]int32, 0, len(grants))
	for _, grant := range grants {
		ids = append(ids, grant.WorkspaceID)
	}
	return false, ids, nil
}

// applyCrossWorkspaceReadScope narrows a listing that spans workspaces to what the
// caller may read.
//
// The rule is the same one checkMemoReadAccess applies to a single document, in SQL
// form: everything inside a granted knowledge base, plus PUBLIC documents anywhere.
// There is deliberately no per-document visibility filter for a signed-in caller —
// under the team model a document belongs to its knowledge base, so PRIVATE narrows
// nothing for someone who was granted that knowledge base.
//
// Listings already scoped to one workspace must not call this: they check access to
// that workspace directly and would otherwise pay for the grant lookup twice.
func (s *APIV1Service) applyCrossWorkspaceReadScope(ctx context.Context, user *store.User, find *store.FindMemo) error {
	if user == nil {
		find.VisibilityList = []store.Visibility{store.Public}
		return nil
	}
	all, ids, err := s.accessibleWorkspaceIDs(ctx, user)
	if err != nil {
		return err
	}
	if !all {
		find.VisibleWorkspaceIDs = ids
	}
	return nil
}

// getWorkspaceWithAccess resolves a workspace by resource name and checks that the
// current user holds at least minRole in it.
//
// A user without any access gets NotFound rather than PermissionDenied: "this
// knowledge base exists but is not yours" is itself information a member should
// not have. Insufficient (but non-zero) access is PermissionDenied, since the
// caller already knows the workspace exists.
func (s *APIV1Service) getWorkspaceWithAccess(ctx context.Context, name string, minRole WorkspaceRole) (*store.Workspace, *store.User, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}
	uid, err := ExtractWorkspaceUIDFromName(name)
	if err != nil {
		return nil, nil, status.Errorf(codes.InvalidArgument, "invalid workspace name: %v", err)
	}
	workspace, err := s.Store.GetWorkspace(ctx, &store.FindWorkspace{UID: &uid})
	if err != nil {
		return nil, nil, status.Errorf(codes.Internal, "failed to get workspace: %v", err)
	}
	if workspace == nil {
		return nil, nil, status.Errorf(codes.NotFound, "workspace not found")
	}
	role, err := s.resolveWorkspaceAccess(ctx, user, workspace.ID)
	if err != nil {
		return nil, nil, status.Errorf(codes.Internal, "failed to resolve workspace access: %v", err)
	}
	if role == WorkspaceRoleNone {
		return nil, nil, status.Errorf(codes.NotFound, "workspace not found")
	}
	if role < minRole {
		return nil, nil, status.Errorf(codes.PermissionDenied, "permission denied")
	}
	return workspace, user, nil
}
