package test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	apiv1 "github.com/usememos/memos/proto/gen/api/v1"
)

// The shelf colours each knowledge base by its freshest document, so the list has to say when that
// was: last_edit_time follows the documents, not the workspace's own settings.
func TestListWorkspacesCarriesLastEditTime(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	owner, workspace, err := ts.CreateRegularUserWithWorkspace(ctx, "last-edit-owner")
	require.NoError(t, err)
	ownerCtx := ts.CreateUserContext(ctx, owner.ID)
	workspaceName := "workspaces/" + workspace.UID

	findListed := func() *apiv1.Workspace {
		list, err := ts.Service.ListWorkspaces(ownerCtx, &apiv1.ListWorkspacesRequest{})
		require.NoError(t, err)
		for _, w := range list.Workspaces {
			if w.Name == workspaceName {
				return w
			}
		}
		t.Fatalf("workspace %s not listed", workspaceName)
		return nil
	}

	require.Nil(t, findListed().LastEditTime, "no documents, no edit time")

	memo, err := ts.Service.CreateMemo(ownerCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Workspace: workspaceName, Title: "a doc", Content: "body"},
	})
	require.NoError(t, err)
	listed := findListed()
	require.NotNil(t, listed.LastEditTime)
	require.Equal(t, memo.UpdateTime.AsTime().Unix(), listed.LastEditTime.AsTime().Unix())
}
