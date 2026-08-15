package fileserver

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	apiv1service "github.com/usememos/memos/server/router/api/v1"
	"github.com/usememos/memos/store"
)

// Since knowledge-base level authorization became a precondition for reading or
// writing a document, a bare store.CreateUser is not enough to act in these tests:
// a member with no grant cannot create a single document. These helpers create the
// member together with the knowledge base they work in.

// createMemberWithWorkspace creates a regular member plus a knowledge base they hold
// EDITOR in, and returns both.
func createMemberWithWorkspace(ctx context.Context, t *testing.T, svc *apiv1service.APIV1Service, username string) (*store.User, *store.Workspace) {
	t.Helper()
	user, err := svc.Store.CreateUser(ctx, &store.User{
		Username: username,
		Role:     store.RoleUser,
		Email:    username + "@example.com",
	})
	require.NoError(t, err)
	return user, createWorkspaceFor(ctx, t, svc, user, username+"'s workspace", store.WorkspaceGrantRoleEditor)
}

// createMember creates a regular member with their own knowledge base.
func createMember(ctx context.Context, t *testing.T, svc *apiv1service.APIV1Service, username string) *store.User {
	t.Helper()
	user, _ := createMemberWithWorkspace(ctx, t, svc, username)
	return user
}

// createWorkspaceFor creates a knowledge base and grants the user the given role in it.
func createWorkspaceFor(ctx context.Context, t *testing.T, svc *apiv1service.APIV1Service, user *store.User, title string, role store.WorkspaceGrantRole) *store.Workspace {
	t.Helper()
	uid, err := apiv1service.ValidateAndGenerateUID("")
	require.NoError(t, err)
	slug, err := svc.Store.GenerateStorageSlug(ctx, uid, title)
	require.NoError(t, err)
	workspace, err := svc.Store.CreateWorkspace(ctx, &store.Workspace{
		UID:         uid,
		CreatorID:   user.ID,
		Title:       title,
		StorageSlug: slug,
	})
	require.NoError(t, err)
	grantWorkspace(ctx, t, svc, workspace, user, role)
	return workspace
}

// grantWorkspace gives the user the given role in an existing knowledge base.
func grantWorkspace(ctx context.Context, t *testing.T, svc *apiv1service.APIV1Service, workspace *store.Workspace, user *store.User, role store.WorkspaceGrantRole) {
	t.Helper()
	_, err := svc.Store.CreateWorkspaceGrant(ctx, &store.WorkspaceGrant{
		WorkspaceID: workspace.ID,
		SubjectType: store.WorkspaceGrantSubjectUser,
		SubjectID:   user.ID,
		Role:        role,
		GrantedBy:   user.ID,
	})
	require.NoError(t, err)
}
