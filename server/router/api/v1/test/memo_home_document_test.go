package test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	apiv1 "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/store"
)

// TestListMemosHidesOtherUsersHomeDocument pins the shape that broke the Home page:
// the team owner reads every knowledge base, so an unfiltered listing handed them
// every user's Home configuration document, and the page — which takes the first
// `.home` document it finds — rendered a stranger's empty configuration instead of
// their own.
func TestListMemosHidesOtherUsersHomeDocument(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	owner, err := ts.CreateHostUser(ctx, "home-team-owner")
	require.NoError(t, err)
	ownerWorkspace, err := ts.CreateWorkspaceForUser(ctx, owner, "owner's workspace", store.WorkspaceGrantRoleEditor)
	require.NoError(t, err)
	ownerCtx := ts.CreateUserContext(ctx, owner.ID)

	member, memberWorkspace, err := ts.CreateRegularUserWithWorkspace(ctx, "home-member")
	require.NoError(t, err)
	memberCtx := ts.CreateUserContext(ctx, member.ID)

	createHome := func(callerCtx context.Context, workspaceUID, content string) *apiv1.Memo {
		t.Helper()
		memo, err := ts.Service.CreateMemo(callerCtx, &apiv1.CreateMemoRequest{
			Memo: &apiv1.Memo{
				Workspace:  "workspaces/" + workspaceUID,
				FolderPath: ".home",
				Title:      "Home",
				Content:    content,
				DocType:    apiv1.Memo_VIEW,
				Visibility: apiv1.Visibility_PRIVATE,
			},
		})
		require.NoError(t, err)
		return memo
	}

	ownerHome := createHome(ownerCtx, ownerWorkspace.UID, "owner's home configuration")
	memberHome := createHome(memberCtx, memberWorkspace.UID, "member's home configuration")

	homeDocuments := func(callerCtx context.Context) []string {
		t.Helper()
		listed, err := ts.Service.ListMemos(callerCtx, &apiv1.ListMemosRequest{PageSize: 100})
		require.NoError(t, err)
		names := []string{}
		for _, memo := range listed.Memos {
			if memo.FolderPath == ".home" {
				names = append(names, memo.Name)
			}
		}
		return names
	}

	require.Equal(t, []string{ownerHome.Name}, homeDocuments(ownerCtx), "team owner must see only their own Home document")
	require.Equal(t, []string{memberHome.Name}, homeDocuments(memberCtx), "a member must see only their own Home document")
}
