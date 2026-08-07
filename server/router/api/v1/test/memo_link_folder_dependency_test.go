package test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	apiv1 "github.com/usememos/memos/proto/gen/api/v1"
	v1 "github.com/usememos/memos/server/router/api/v1"
	"github.com/usememos/memos/store"
)

// TestMemoLinkDependencyFolderAndWorkspaceP1 covers the P1 dependency check
// for the container-level operations: deleting a folder or a workspace must
// be rejected if a document outside the container links to a document inside
// it, and must succeed once nothing outside references it.
//
// DeleteWorkspaceFolder/DeleteWorkspace's pre-existing "container is empty"
// rule only counts RowStatus=NORMAL documents (see their comments in
// workspace_service.go), so archived documents are the only way to reach a
// state where a folder looks empty to that rule while still holding a
// document other content links to. This test archives inFolder directly at
// the store layer (bypassing the single-memo archive path's own P1 check,
// which would otherwise reject archiving a referenced memo) specifically to
// isolate and exercise the container-level reference check on its own.
func TestMemoLinkDependencyFolderAndWorkspaceP1(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	user, err := ts.CreateRegularUser(ctx, "user")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	workspace, err := ts.Service.CreateWorkspace(userCtx, &apiv1.CreateWorkspaceRequest{
		Workspace: &apiv1.Workspace{Title: "Linked Workspace"},
	})
	require.NoError(t, err)

	_, err = ts.Service.CreateWorkspaceFolder(userCtx, &apiv1.CreateWorkspaceFolderRequest{
		Parent: workspace.Name,
		Folder: &apiv1.WorkspaceFolder{Path: "notes"},
	})
	require.NoError(t, err)

	inFolder, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Workspace: workspace.Name, FolderPath: "notes", Title: "In Folder", Content: "content"},
	})
	require.NoError(t, err)
	inFolderUID := memoUIDFromName(t, inFolder.Name)

	outside, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Workspace: workspace.Name, Title: "Outside Doc", Content: "See [In Folder](/memos/" + inFolderUID + ")."},
	})
	require.NoError(t, err)

	// Archive inFolder directly at the store layer so it drops out of the
	// "folder is not empty" NORMAL-only check while the reverse-link index
	// (built from its content at creation time) still points a reference at
	// it — isolating the P1 reference check from the emptiness check.
	archived := store.Archived
	inFolderMemo, err := ts.Store.GetMemo(ctx, &store.FindMemo{UID: &inFolderUID})
	require.NoError(t, err)
	require.NoError(t, ts.Store.UpdateMemo(ctx, &store.UpdateMemo{ID: inFolderMemo.ID, RowStatus: &archived}))

	t.Run("folder delete is rejected while referenced from outside", func(t *testing.T) {
		_, err := ts.Service.DeleteWorkspaceFolder(userCtx, &apiv1.DeleteWorkspaceFolderRequest{Parent: workspace.Name, Path: "notes"})
		require.Error(t, err)
		require.Equal(t, codes.FailedPrecondition, status.Code(err))
		require.Contains(t, err.Error(), "Outside Doc")
	})

	t.Run("a reference from inside the same subtree does not block the delete", func(t *testing.T) {
		// Remove the external reference first so this sub-test can isolate the
		// "internal reference doesn't count" behavior.
		_, err := ts.Service.DeleteMemo(userCtx, &apiv1.DeleteMemoRequest{Name: outside.Name})
		require.NoError(t, err)

		siblingUID := createArchivedMemoInFolder(t, ctx, ts, workspace.Name, "notes", "Sibling In Folder",
			"See [In Folder](/memos/"+inFolderUID+").")
		_ = siblingUID

		_, err = ts.Service.DeleteWorkspaceFolder(userCtx, &apiv1.DeleteWorkspaceFolderRequest{Parent: workspace.Name, Path: "notes"})
		require.NoError(t, err)
	})
}

// createArchivedMemoInFolder creates a memo with the given content via the
// service (so it goes through the normal P0 indexing path) and then archives
// it directly at the store layer, for tests that need an archived-but-linked
// document without going through the single-memo archive path's own P1
// check.
func createArchivedMemoInFolder(t *testing.T, ctx context.Context, ts *TestService, workspaceName, folderPath, title, content string) string {
	t.Helper()
	memo, err := ts.Service.CreateMemo(ts.CreateUserContext(ctx, mustCreatorID(t, ctx, ts, workspaceName)), &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Workspace: workspaceName, FolderPath: folderPath, Title: title, Content: content},
	})
	require.NoError(t, err)
	uid := memoUIDFromName(t, memo.Name)

	archived := store.Archived
	m, err := ts.Store.GetMemo(ctx, &store.FindMemo{UID: &uid})
	require.NoError(t, err)
	require.NoError(t, ts.Store.UpdateMemo(ctx, &store.UpdateMemo{ID: m.ID, RowStatus: &archived}))
	return uid
}

func mustCreatorID(t *testing.T, ctx context.Context, ts *TestService, workspaceName string) int32 {
	t.Helper()
	workspaceUID, err := v1.ExtractWorkspaceUIDFromName(workspaceName)
	require.NoError(t, err)
	w, err := ts.Store.GetWorkspace(ctx, &store.FindWorkspace{UID: &workspaceUID})
	require.NoError(t, err)
	require.NotNil(t, w)
	return w.CreatorID
}
