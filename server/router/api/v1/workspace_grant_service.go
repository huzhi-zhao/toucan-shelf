package v1

import (
	"context"
	"fmt"
	"slices"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/store"
)

// wildcardWorkspaceID is the collection-id wildcard accepted as the parent of a grant
// listing: "workspaces/-" means "across every knowledge base", which is how the member
// settings page asks for one member's assignments.
const wildcardWorkspaceID = "-"

func (s *APIV1Service) ListWorkspaceGrants(ctx context.Context, request *v1pb.ListWorkspaceGrantsRequest) (*v1pb.ListWorkspaceGrantsResponse, error) {
	if _, err := s.requireTeamOwner(ctx); err != nil {
		return nil, err
	}
	find := &store.FindWorkspaceGrant{}
	subjectType := store.WorkspaceGrantSubjectUser
	find.SubjectType = &subjectType

	parentUID, err := ExtractWorkspaceUIDFromName(request.Parent)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid parent: %v", err)
	}
	if parentUID != wildcardWorkspaceID {
		workspace, err := s.Store.GetWorkspace(ctx, &store.FindWorkspace{UID: &parentUID})
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to get workspace: %v", err)
		}
		if workspace == nil {
			return nil, status.Errorf(codes.NotFound, "workspace not found")
		}
		find.WorkspaceID = &workspace.ID
	}
	if request.User != "" {
		user, err := ResolveUserByName(ctx, s.Store, request.User)
		if err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "invalid user: %v", err)
		}
		if user == nil {
			return nil, status.Errorf(codes.NotFound, "user not found")
		}
		find.SubjectID = &user.ID
	}

	grants, err := s.Store.ListWorkspaceGrants(ctx, find)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list workspace grants: %v", err)
	}
	workspaceUIDs, err := s.workspaceUIDsByID(ctx, grants)
	if err != nil {
		return nil, err
	}
	usernames, err := s.grantUsernamesByID(ctx, grants)
	if err != nil {
		return nil, err
	}
	response := &v1pb.ListWorkspaceGrantsResponse{Grants: make([]*v1pb.WorkspaceGrant, 0, len(grants))}
	for _, grant := range grants {
		response.Grants = append(response.Grants, convertWorkspaceGrantFromStore(grant, workspaceUIDs[grant.WorkspaceID], usernames))
	}
	return response, nil
}

func (s *APIV1Service) CreateWorkspaceGrant(ctx context.Context, request *v1pb.CreateWorkspaceGrantRequest) (*v1pb.WorkspaceGrant, error) {
	owner, err := s.requireTeamOwner(ctx)
	if err != nil {
		return nil, err
	}
	if request.Grant == nil {
		return nil, status.Errorf(codes.InvalidArgument, "grant is required")
	}
	workspace, err := s.getWorkspaceByName(ctx, request.Parent)
	if err != nil {
		return nil, err
	}
	subject, err := s.resolveGrantSubject(ctx, request.Grant.User)
	if err != nil {
		return nil, err
	}
	role, err := convertWorkspaceGrantRoleToStore(request.Grant.Role)
	if err != nil {
		return nil, err
	}

	subjectType := store.WorkspaceGrantSubjectUser
	existing, err := s.Store.GetWorkspaceGrant(ctx, &store.FindWorkspaceGrant{
		WorkspaceID: &workspace.ID,
		SubjectType: &subjectType,
		SubjectID:   &subject.ID,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to check existing grant: %v", err)
	}
	if existing != nil {
		return nil, status.Errorf(codes.AlreadyExists, "member already has access to this knowledge base")
	}

	grant, err := s.Store.CreateWorkspaceGrant(ctx, &store.WorkspaceGrant{
		WorkspaceID: workspace.ID,
		SubjectType: subjectType,
		SubjectID:   subject.ID,
		Role:        role,
		GrantedBy:   owner.ID,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to create workspace grant: %v", err)
	}
	return convertWorkspaceGrantFromStore(grant, workspace.UID, map[int32]string{
		subject.ID: subject.Username,
		owner.ID:   owner.Username,
	}), nil
}

func (s *APIV1Service) UpdateWorkspaceGrant(ctx context.Context, request *v1pb.UpdateWorkspaceGrantRequest) (*v1pb.WorkspaceGrant, error) {
	if _, err := s.requireTeamOwner(ctx); err != nil {
		return nil, err
	}
	if request.Grant == nil {
		return nil, status.Errorf(codes.InvalidArgument, "grant is required")
	}
	if request.UpdateMask == nil || len(request.UpdateMask.Paths) == 0 {
		return nil, status.Errorf(codes.InvalidArgument, "update_mask is required")
	}
	// Role is the only mutable field: who the grant is for and which workspace it
	// applies to are its identity, and moving either would be a different grant.
	for _, path := range request.UpdateMask.Paths {
		if path != "role" {
			return nil, status.Errorf(codes.InvalidArgument, "unsupported update path %q", path)
		}
	}
	workspace, grant, err := s.getWorkspaceGrantByName(ctx, request.Grant.Name)
	if err != nil {
		return nil, err
	}
	role, err := convertWorkspaceGrantRoleToStore(request.Grant.Role)
	if err != nil {
		return nil, err
	}
	updated, err := s.Store.UpdateWorkspaceGrant(ctx, &store.UpdateWorkspaceGrant{
		ID:   grant.ID,
		Role: role,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to update workspace grant: %v", err)
	}
	usernames, err := s.grantUsernamesByID(ctx, []*store.WorkspaceGrant{updated})
	if err != nil {
		return nil, err
	}
	return convertWorkspaceGrantFromStore(updated, workspace.UID, usernames), nil
}

func (s *APIV1Service) DeleteWorkspaceGrant(ctx context.Context, request *v1pb.DeleteWorkspaceGrantRequest) (*emptypb.Empty, error) {
	if _, err := s.requireTeamOwner(ctx); err != nil {
		return nil, err
	}
	_, grant, err := s.getWorkspaceGrantByName(ctx, request.Name)
	if err != nil {
		return nil, err
	}
	if err := s.Store.DeleteWorkspaceGrant(ctx, &store.DeleteWorkspaceGrant{ID: &grant.ID}); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to delete workspace grant: %v", err)
	}
	return &emptypb.Empty{}, nil
}

// requireTeamOwner rejects everyone but the instance's single ADMIN account. Managing
// grants is a workspace-level operation, and those are admin-only regardless of any
// grant the caller may hold (requirement §2).
func (s *APIV1Service) requireTeamOwner(ctx context.Context) (*store.User, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}
	if !isTeamOwner(user) {
		return nil, status.Errorf(codes.PermissionDenied, "permission denied")
	}
	return user, nil
}

func (s *APIV1Service) getWorkspaceByName(ctx context.Context, name string) (*store.Workspace, error) {
	uid, err := ExtractWorkspaceUIDFromName(name)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid workspace name: %v", err)
	}
	workspace, err := s.Store.GetWorkspace(ctx, &store.FindWorkspace{UID: &uid})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get workspace: %v", err)
	}
	if workspace == nil {
		return nil, status.Errorf(codes.NotFound, "workspace not found")
	}
	return workspace, nil
}

func (s *APIV1Service) getWorkspaceGrantByName(ctx context.Context, name string) (*store.Workspace, *store.WorkspaceGrant, error) {
	workspaceUID, grantID, err := ExtractWorkspaceGrantIDFromName(name)
	if err != nil {
		return nil, nil, status.Errorf(codes.InvalidArgument, "invalid grant name: %v", err)
	}
	workspace, err := s.getWorkspaceByName(ctx, WorkspaceNamePrefix+workspaceUID)
	if err != nil {
		return nil, nil, err
	}
	grant, err := s.Store.GetWorkspaceGrant(ctx, &store.FindWorkspaceGrant{ID: &grantID})
	if err != nil {
		return nil, nil, status.Errorf(codes.Internal, "failed to get workspace grant: %v", err)
	}
	if grant == nil || grant.WorkspaceID != workspace.ID {
		return nil, nil, status.Errorf(codes.NotFound, "grant not found")
	}
	return workspace, grant, nil
}

// resolveGrantSubject validates that the grant's target is an existing member. The
// ADMIN account is rejected: its access is implicit, and letting it into the table
// would create a second, revocable source of truth for the owner's own access.
func (s *APIV1Service) resolveGrantSubject(ctx context.Context, name string) (*store.User, error) {
	user, err := ResolveUserByName(ctx, s.Store, name)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid user name: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.NotFound, "user not found")
	}
	if isTeamOwner(user) {
		return nil, status.Errorf(codes.InvalidArgument, "the admin already has access to every knowledge base")
	}
	return user, nil
}

// workspaceUIDsByID resolves the workspace UIDs the given grants point at, in one
// query rather than one per grant.
func (s *APIV1Service) workspaceUIDsByID(ctx context.Context, grants []*store.WorkspaceGrant) (map[int32]string, error) {
	ids := make([]int32, 0, len(grants))
	for _, grant := range grants {
		if !slices.Contains(ids, grant.WorkspaceID) {
			ids = append(ids, grant.WorkspaceID)
		}
	}
	uids := make(map[int32]string, len(ids))
	if len(ids) == 0 {
		return uids, nil
	}
	workspaces, err := s.Store.ListWorkspaces(ctx, &store.FindWorkspace{IDList: ids})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list workspaces: %v", err)
	}
	for _, workspace := range workspaces {
		uids[workspace.ID] = workspace.UID
	}
	return uids, nil
}

// grantUsernamesByID resolves the usernames behind the subject and granter ids of the
// given grants. User resource names are username-based everywhere in this API, so a
// grant cannot be rendered from its ids alone.
func (s *APIV1Service) grantUsernamesByID(ctx context.Context, grants []*store.WorkspaceGrant) (map[int32]string, error) {
	usernames := make(map[int32]string, len(grants))
	for _, grant := range grants {
		for _, id := range []int32{grant.SubjectID, grant.GrantedBy} {
			if _, ok := usernames[id]; ok {
				continue
			}
			user, err := s.Store.GetUser(ctx, &store.FindUser{ID: &id})
			if err != nil {
				return nil, status.Errorf(codes.Internal, "failed to get user: %v", err)
			}
			if user != nil {
				usernames[id] = user.Username
			}
		}
	}
	return usernames, nil
}

func convertWorkspaceGrantFromStore(grant *store.WorkspaceGrant, workspaceUID string, usernames map[int32]string) *v1pb.WorkspaceGrant {
	if grant == nil {
		return nil
	}
	workspaceName := WorkspaceNamePrefix + workspaceUID
	return &v1pb.WorkspaceGrant{
		Name:       fmt.Sprintf("%s/%s%d", workspaceName, WorkspaceGrantNamePrefix, grant.ID),
		User:       BuildUserName(usernames[grant.SubjectID]),
		Role:       convertWorkspaceGrantRoleFromStore(grant.Role),
		Workspace:  workspaceName,
		Granter:    BuildUserName(usernames[grant.GrantedBy]),
		CreateTime: timestamppb.New(time.Unix(grant.CreatedTs, 0)),
	}
}

func convertWorkspaceGrantRoleFromStore(role store.WorkspaceGrantRole) v1pb.WorkspaceGrant_Role {
	switch role {
	case store.WorkspaceGrantRoleViewer:
		return v1pb.WorkspaceGrant_VIEWER
	case store.WorkspaceGrantRoleEditor:
		return v1pb.WorkspaceGrant_EDITOR
	default:
		return v1pb.WorkspaceGrant_ROLE_UNSPECIFIED
	}
}

func convertWorkspaceGrantRoleToStore(role v1pb.WorkspaceGrant_Role) (store.WorkspaceGrantRole, error) {
	switch role {
	case v1pb.WorkspaceGrant_VIEWER:
		return store.WorkspaceGrantRoleViewer, nil
	case v1pb.WorkspaceGrant_EDITOR:
		return store.WorkspaceGrantRoleEditor, nil
	default:
		return "", status.Errorf(codes.InvalidArgument, "role must be VIEWER or EDITOR")
	}
}
