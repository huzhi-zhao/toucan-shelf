package test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	apiv1 "github.com/usememos/memos/proto/gen/api/v1"
	v1 "github.com/usememos/memos/server/router/api/v1"
)

// An existing ordinary document filed under another one becomes its
// sub-document in place: same uid, so history, comments and the identity
// memogit stamped into the local file all carry over.
func TestSubDocumentAttachInPlace(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	userCtx, workspace, parent := subDocTestFixture(ctx, t, ts)
	parentUID := memoUIDFromName(t, parent.Name)

	doc, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{
			Workspace:  workspace.Name,
			FolderPath: "Campaigns",
			Title:      "Sources",
			Content:    "the source list",
			Visibility: apiv1.Visibility_PRIVATE,
		},
	})
	require.NoError(t, err)
	referencer, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Workspace: workspace.Name, Title: "Index", Content: "See [Sources](/Campaigns/Sources)."},
	})
	require.NoError(t, err)

	attached, err := ts.Service.UpdateMemo(userCtx, &apiv1.UpdateMemoRequest{
		Memo:       &apiv1.Memo{Name: doc.Name, FolderPath: v1.SubDocFolderPath(parentUID)},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"folder_path"}},
	})
	require.NoError(t, err)
	require.Equal(t, doc.Name, attached.Name, "attaching keeps the document's identity")
	require.Equal(t, parent.Name, attached.GetParent())
	require.Equal(t, v1.SubDocFolderPath(parentUID), attached.FolderPath)
	require.Equal(t, apiv1.Visibility_PROTECTED, attached.Visibility, "a sub-document is exactly as visible as its parent")
	require.Equal(t, "the source list", attached.Content)

	children, err := ts.Service.ListMemoComments(userCtx, &apiv1.ListMemoCommentsRequest{Name: parent.Name})
	require.NoError(t, err)
	require.Len(t, children.Memos, 1)
	require.Equal(t, doc.Name, children.Memos[0].Name)

	listed, err := ts.Service.ListMemos(userCtx, &apiv1.ListMemosRequest{})
	require.NoError(t, err)
	for _, memo := range listed.Memos {
		require.NotEqual(t, doc.Name, memo.Name, "an attached sub-document leaves the document list")
	}

	// Links into it are repaired to the sub-document form, not left dead.
	got, err := ts.Service.GetMemo(userCtx, &apiv1.GetMemoRequest{Name: referencer.Name})
	require.NoError(t, err)
	require.Equal(t, "See [Sources](/_sub/"+parentUID+"/Sources).", got.Content)
}

func TestSubDocumentAttachRejected(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	userCtx, workspace, parent := subDocTestFixture(ctx, t, ts)
	parentUID := memoUIDFromName(t, parent.Name)

	move := func(name, folderPath string) error {
		_, err := ts.Service.UpdateMemo(userCtx, &apiv1.UpdateMemoRequest{
			Memo:       &apiv1.Memo{Name: name, FolderPath: folderPath},
			UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"folder_path"}},
		})
		return err
	}

	t.Run("onto itself", func(t *testing.T) {
		err := move(parent.Name, v1.SubDocFolderPath(parentUID))
		require.Equal(t, codes.InvalidArgument, status.Code(err))
	})

	t.Run("a document that has sub-documents of its own", func(t *testing.T) {
		other, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
			Memo: &apiv1.Memo{Workspace: workspace.Name, Title: "Other Parent", Content: "x"},
		})
		require.NoError(t, err)
		_, err = ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
			Memo: &apiv1.Memo{FolderPath: v1.SubDocFolderPath(memoUIDFromName(t, other.Name)), Title: "Its Appendix", Content: "x"},
		})
		require.NoError(t, err)
		err = move(other.Name, v1.SubDocFolderPath(parentUID))
		require.Equal(t, codes.InvalidArgument, status.Code(err))
	})

	t.Run("a parent in another knowledge base", func(t *testing.T) {
		elsewhere, err := ts.Service.CreateWorkspace(userCtx, &apiv1.CreateWorkspaceRequest{
			Workspace: &apiv1.Workspace{Title: "Elsewhere"},
		})
		require.NoError(t, err)
		stranger, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
			Memo: &apiv1.Memo{Workspace: elsewhere.Name, Title: "Stranger", Content: "x"},
		})
		require.NoError(t, err)
		err = move(stranger.Name, v1.SubDocFolderPath(parentUID))
		require.Equal(t, codes.InvalidArgument, status.Code(err))
	})

	t.Run("a title the parent already has a sub-document by", func(t *testing.T) {
		_, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
			Memo: &apiv1.Memo{FolderPath: v1.SubDocFolderPath(parentUID), Title: "Notes", Content: "x"},
		})
		require.NoError(t, err)
		same, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
			Memo: &apiv1.Memo{Workspace: workspace.Name, Title: "Notes", Content: "y"},
		})
		require.NoError(t, err)
		err = move(same.Name, v1.SubDocFolderPath(parentUID))
		require.Equal(t, codes.AlreadyExists, status.Code(err))
		// And it is left where it was, not half-attached.
		got, err := ts.Service.GetMemo(userCtx, &apiv1.GetMemoRequest{Name: same.Name})
		require.NoError(t, err)
		require.Empty(t, got.FolderPath)
		require.Empty(t, got.GetParent())
	})
}

// "X.subdocs" is the name memogit gives the folder holding X's sub-documents.
// A real folder by that name would be mirrored as sub-documents it is not, so
// no ordinary document or folder may use one.
func TestSubDocDirNameReserved(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	userCtx, workspace, _ := subDocTestFixture(ctx, t, ts)

	for _, folderPath := range []string{"Plan.subdocs", "Campaigns/Plan.subdocs", "Campaigns/Plan.SUBDOCS/deeper"} {
		t.Run("create document in "+folderPath, func(t *testing.T) {
			_, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
				Memo: &apiv1.Memo{Workspace: workspace.Name, FolderPath: folderPath, Title: "Stray", Content: "x"},
			})
			require.Equal(t, codes.InvalidArgument, status.Code(err))
		})
	}

	doc, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Workspace: workspace.Name, FolderPath: "Campaigns", Title: "Sources", Content: "x"},
	})
	require.NoError(t, err)

	t.Run("move document into one", func(t *testing.T) {
		_, err := ts.Service.UpdateMemo(userCtx, &apiv1.UpdateMemoRequest{
			Memo:       &apiv1.Memo{Name: doc.Name, FolderPath: "Campaigns/Plan.subdocs"},
			UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"folder_path"}},
		})
		require.Equal(t, codes.InvalidArgument, status.Code(err))
	})

	t.Run("create folder", func(t *testing.T) {
		_, err := ts.Service.CreateWorkspaceFolder(userCtx, &apiv1.CreateWorkspaceFolderRequest{
			Parent: workspace.Name,
			Folder: &apiv1.WorkspaceFolder{Path: "Campaigns/Plan.subdocs"},
		})
		require.Equal(t, codes.InvalidArgument, status.Code(err))
	})

	t.Run("rename folder to one", func(t *testing.T) {
		_, err := ts.Service.RenameWorkspaceFolder(userCtx, &apiv1.RenameWorkspaceFolderRequest{
			Parent: workspace.Name, OldPath: "Campaigns", NewPath: "Plan.subdocs",
		})
		require.Equal(t, codes.InvalidArgument, status.Code(err))
	})

	t.Run("a name that merely contains it is fine", func(t *testing.T) {
		_, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
			Memo: &apiv1.Memo{Workspace: workspace.Name, FolderPath: "my.subdocs.notes", Title: "Fine", Content: "x"},
		})
		require.NoError(t, err)
	})
}
