package test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	apiv1 "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/store"
)

// The grant RPCs are the admin's only way to hand a knowledge base to a member, so
// they carry the whole assignment model: admin-only, one grant per member per base,
// and a role that can be switched or revoked afterwards.

func TestWorkspaceGrantLifecycle(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	admin, err := ts.CreateHostUser(ctx, "grant-admin")
	require.NoError(t, err)
	adminCtx := ts.CreateUserContext(ctx, admin.ID)

	member, err := ts.CreateUnassignedUser(ctx, "grant-member")
	require.NoError(t, err)
	memberCtx := ts.CreateUserContext(ctx, member.ID)

	workspace, err := ts.Service.CreateWorkspace(adminCtx, &apiv1.CreateWorkspaceRequest{
		Workspace: &apiv1.Workspace{Title: "Team Handbook"},
	})
	require.NoError(t, err)

	memberName := "users/" + member.Username

	grant, err := ts.Service.CreateWorkspaceGrant(adminCtx, &apiv1.CreateWorkspaceGrantRequest{
		Parent: workspace.Name,
		Grant: &apiv1.WorkspaceGrant{
			User: memberName,
			Role: apiv1.WorkspaceGrant_VIEWER,
		},
	})
	require.NoError(t, err)
	require.Equal(t, memberName, grant.User)
	require.Equal(t, apiv1.WorkspaceGrant_VIEWER, grant.Role)
	require.Equal(t, workspace.Name, grant.Workspace)

	// The member now sees the knowledge base, and only that one.
	memberList, err := ts.Service.ListWorkspaces(memberCtx, &apiv1.ListWorkspacesRequest{})
	require.NoError(t, err)
	require.Len(t, memberList.Workspaces, 1)
	require.Equal(t, workspace.Name, memberList.Workspaces[0].Name)

	// VIEWER cannot write yet.
	_, err = ts.Service.CreateMemo(memberCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Content: "as viewer", Workspace: workspace.Name},
	})
	require.Equal(t, codes.PermissionDenied, status.Code(err))

	// Promoting to EDITOR is an update of the same grant, not a second one.
	updated, err := ts.Service.UpdateWorkspaceGrant(adminCtx, &apiv1.UpdateWorkspaceGrantRequest{
		Grant:      &apiv1.WorkspaceGrant{Name: grant.Name, Role: apiv1.WorkspaceGrant_EDITOR},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"role"}},
	})
	require.NoError(t, err)
	require.Equal(t, apiv1.WorkspaceGrant_EDITOR, updated.Role)

	_, err = ts.Service.CreateMemo(memberCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Content: "as editor", Workspace: workspace.Name},
	})
	require.NoError(t, err)

	// A second grant for the same member in the same base is refused: the role is
	// changed through Update, so that "assigned twice with conflicting roles" cannot
	// happen at all.
	_, err = ts.Service.CreateWorkspaceGrant(adminCtx, &apiv1.CreateWorkspaceGrantRequest{
		Parent: workspace.Name,
		Grant:  &apiv1.WorkspaceGrant{User: memberName, Role: apiv1.WorkspaceGrant_VIEWER},
	})
	require.Equal(t, codes.AlreadyExists, status.Code(err))

	listed, err := ts.Service.ListWorkspaceGrants(adminCtx, &apiv1.ListWorkspaceGrantsRequest{Parent: workspace.Name})
	require.NoError(t, err)
	require.Len(t, listed.Grants, 1)

	// The member settings page asks the other way round: one member, every base.
	byMember, err := ts.Service.ListWorkspaceGrants(adminCtx, &apiv1.ListWorkspaceGrantsRequest{
		Parent: "workspaces/-",
		User:   memberName,
	})
	require.NoError(t, err)
	require.Len(t, byMember.Grants, 1)
	require.Equal(t, workspace.Name, byMember.Grants[0].Workspace)

	// Revoking puts the member back to seeing nothing.
	_, err = ts.Service.DeleteWorkspaceGrant(adminCtx, &apiv1.DeleteWorkspaceGrantRequest{Name: grant.Name})
	require.NoError(t, err)

	memberList, err = ts.Service.ListWorkspaces(memberCtx, &apiv1.ListWorkspacesRequest{})
	require.NoError(t, err)
	require.Empty(t, memberList.Workspaces)
}

func TestWorkspaceGrantRPCsAreAdminOnly(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	admin, err := ts.CreateHostUser(ctx, "grant-owner")
	require.NoError(t, err)
	adminCtx := ts.CreateUserContext(ctx, admin.ID)

	// An EDITOR in the base is still not allowed to hand it to anyone else: grant
	// management is a workspace-level operation, and those stay with the admin.
	editor, workspace, err := ts.CreateRegularUserWithWorkspace(ctx, "grant-editor")
	require.NoError(t, err)
	editorCtx := ts.CreateUserContext(ctx, editor.ID)

	other, err := ts.CreateUnassignedUser(ctx, "grant-other")
	require.NoError(t, err)
	otherName := "users/" + other.Username
	workspaceName := "workspaces/" + workspace.UID

	_, err = ts.Service.ListWorkspaceGrants(editorCtx, &apiv1.ListWorkspaceGrantsRequest{Parent: workspaceName})
	require.Equal(t, codes.PermissionDenied, status.Code(err))

	_, err = ts.Service.CreateWorkspaceGrant(editorCtx, &apiv1.CreateWorkspaceGrantRequest{
		Parent: workspaceName,
		Grant:  &apiv1.WorkspaceGrant{User: otherName, Role: apiv1.WorkspaceGrant_EDITOR},
	})
	require.Equal(t, codes.PermissionDenied, status.Code(err))

	grant, err := ts.Service.CreateWorkspaceGrant(adminCtx, &apiv1.CreateWorkspaceGrantRequest{
		Parent: workspaceName,
		Grant:  &apiv1.WorkspaceGrant{User: otherName, Role: apiv1.WorkspaceGrant_EDITOR},
	})
	require.NoError(t, err)

	_, err = ts.Service.UpdateWorkspaceGrant(editorCtx, &apiv1.UpdateWorkspaceGrantRequest{
		Grant:      &apiv1.WorkspaceGrant{Name: grant.Name, Role: apiv1.WorkspaceGrant_VIEWER},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"role"}},
	})
	require.Equal(t, codes.PermissionDenied, status.Code(err))

	_, err = ts.Service.DeleteWorkspaceGrant(editorCtx, &apiv1.DeleteWorkspaceGrantRequest{Name: grant.Name})
	require.Equal(t, codes.PermissionDenied, status.Code(err))
}

func TestWorkspaceGrantRejectsAdminSubject(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	admin, err := ts.CreateHostUser(ctx, "grant-self-admin")
	require.NoError(t, err)
	adminCtx := ts.CreateUserContext(ctx, admin.ID)

	workspace, err := ts.Service.CreateWorkspace(adminCtx, &apiv1.CreateWorkspaceRequest{
		Workspace: &apiv1.Workspace{Title: "Owner Base"},
	})
	require.NoError(t, err)

	// The admin's access is implicit; storing it as a grant would make it revocable.
	_, err = ts.Service.CreateWorkspaceGrant(adminCtx, &apiv1.CreateWorkspaceGrantRequest{
		Parent: workspace.Name,
		Grant: &apiv1.WorkspaceGrant{
			User: "users/" + admin.Username,
			Role: apiv1.WorkspaceGrant_EDITOR,
		},
	})
	require.Equal(t, codes.InvalidArgument, status.Code(err))

	// An unspecified role is refused rather than silently defaulting.
	member, err := ts.CreateUnassignedUser(ctx, "grant-role-unset")
	require.NoError(t, err)
	_, err = ts.Service.CreateWorkspaceGrant(adminCtx, &apiv1.CreateWorkspaceGrantRequest{
		Parent: workspace.Name,
		Grant:  &apiv1.WorkspaceGrant{User: "users/" + member.Username},
	})
	require.Equal(t, codes.InvalidArgument, status.Code(err))
}

// TestDeleteMemberRevokesGrants pins requirement §4's delete branch at the API level:
// the account and its assignments go, the documents stay under the admin's name.
func TestDeleteMemberRevokesGrants(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	admin, err := ts.CreateHostUser(ctx, "delete-admin")
	require.NoError(t, err)
	adminCtx := ts.CreateUserContext(ctx, admin.ID)

	member, err := ts.CreateUnassignedUser(ctx, "delete-member")
	require.NoError(t, err)
	memberCtx := ts.CreateUserContext(ctx, member.ID)

	workspace, err := ts.Service.CreateWorkspace(adminCtx, &apiv1.CreateWorkspaceRequest{
		Workspace: &apiv1.Workspace{Title: "Shared Base"},
	})
	require.NoError(t, err)
	_, err = ts.Service.CreateWorkspaceGrant(adminCtx, &apiv1.CreateWorkspaceGrantRequest{
		Parent: workspace.Name,
		Grant: &apiv1.WorkspaceGrant{
			User: "users/" + member.Username,
			Role: apiv1.WorkspaceGrant_EDITOR,
		},
	})
	require.NoError(t, err)

	memo, err := ts.Service.CreateMemo(memberCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Content: "member's contribution", Workspace: workspace.Name},
	})
	require.NoError(t, err)

	_, err = ts.Service.DeleteUser(adminCtx, &apiv1.DeleteUserRequest{
		Name: "users/" + member.Username,
	})
	require.NoError(t, err)

	grants, err := ts.Service.ListWorkspaceGrants(adminCtx, &apiv1.ListWorkspaceGrantsRequest{Parent: workspace.Name})
	require.NoError(t, err)
	require.Empty(t, grants.Grants)

	kept, err := ts.Service.GetMemo(adminCtx, &apiv1.GetMemoRequest{Name: memo.Name})
	require.NoError(t, err)
	require.Equal(t, "users/"+admin.Username, kept.Creator)

	deleted, err := ts.Store.GetUser(ctx, &store.FindUser{ID: &member.ID})
	require.NoError(t, err)
	require.Nil(t, deleted)
}
