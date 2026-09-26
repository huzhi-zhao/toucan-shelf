package test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	apiv1 "github.com/usememos/memos/proto/gen/api/v1"
)

// Per-folder sorting is an override on top of the knowledge base's own setting,
// and the tree is what carries it to the client. These tests pin the two halves
// that are easy to get wrong: what the tree reports (the folder's OWN override,
// never the resolved value, or the client cannot offer a way back to inherited)
// and which paths are allowed to grow a row at all.

// findFolder walks a tree for the folder at path, so a test can assert on a
// nested folder without hand-indexing through children.
func findFolder(nodes []*apiv1.WorkspaceTreeNode, path string) *apiv1.WorkspaceTreeNode {
	for _, n := range nodes {
		if n.Type != apiv1.WorkspaceTreeNode_FOLDER {
			continue
		}
		if n.Path == path {
			return n
		}
		if found := findFolder(n.Children, path); found != nil {
			return found
		}
	}
	return nil
}

func TestFolderSortOverrideRoundTrips(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	owner, workspace, err := ts.CreateRegularUserWithWorkspace(ctx, "folder-sort-owner")
	require.NoError(t, err)
	ownerCtx := ts.CreateUserContext(ctx, owner.ID)
	workspaceName := "workspaces/" + workspace.UID

	// "notes" is implicit: no folder row, it exists only because a document names
	// it. Pinning a sort on it is the case that has to materialize a row.
	_, err = ts.Service.CreateMemo(ownerCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{
			Workspace:  workspaceName,
			FolderPath: "notes",
			Title:      "a doc",
			Content:    "body",
		},
	})
	require.NoError(t, err)

	tree, err := ts.Service.GetWorkspaceTree(ownerCtx, &apiv1.GetWorkspaceTreeRequest{Name: workspaceName})
	require.NoError(t, err)
	notes := findFolder(tree.Nodes, "notes")
	require.NotNil(t, notes)
	require.Empty(t, notes.SortField, "a folder starts out inheriting")
	require.Empty(t, notes.SortOrder)

	folder, err := ts.Service.UpdateWorkspaceFolderSort(ownerCtx, &apiv1.UpdateWorkspaceFolderSortRequest{
		Parent:    workspaceName,
		Path:      "notes",
		SortField: "alphabetical",
		SortOrder: "asc",
	})
	require.NoError(t, err)
	require.Equal(t, "alphabetical", folder.SortField)
	require.Equal(t, "asc", folder.SortOrder)

	tree, err = ts.Service.GetWorkspaceTree(ownerCtx, &apiv1.GetWorkspaceTreeRequest{Name: workspaceName})
	require.NoError(t, err)
	notes = findFolder(tree.Nodes, "notes")
	require.NotNil(t, notes)
	require.Equal(t, "alphabetical", notes.SortField)
	require.Equal(t, "asc", notes.SortOrder)

	// Materializing the row must not duplicate the folder in the tree: the builder
	// unions folder rows with the paths documents imply, and "notes" is now both.
	count := 0
	for _, n := range tree.Nodes {
		if n.Type == apiv1.WorkspaceTreeNode_FOLDER && n.Path == "notes" {
			count++
		}
	}
	require.Equal(t, 1, count)

	// Empty strings are the way back to inherited, not a validation error.
	_, err = ts.Service.UpdateWorkspaceFolderSort(ownerCtx, &apiv1.UpdateWorkspaceFolderSortRequest{
		Parent: workspaceName,
		Path:   "notes",
	})
	require.NoError(t, err)
	tree, err = ts.Service.GetWorkspaceTree(ownerCtx, &apiv1.GetWorkspaceTreeRequest{Name: workspaceName})
	require.NoError(t, err)
	notes = findFolder(tree.Nodes, "notes")
	require.NotNil(t, notes)
	require.Empty(t, notes.SortField)
	require.Empty(t, notes.SortOrder)
}

// A folder deeper than the root keeps its own override, and a sibling that never
// set one stays empty: the override belongs to a folder, not to a level.
func TestFolderSortOverrideIsPerFolder(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	owner, workspace, err := ts.CreateRegularUserWithWorkspace(ctx, "folder-sort-nested")
	require.NoError(t, err)
	ownerCtx := ts.CreateUserContext(ctx, owner.ID)
	workspaceName := "workspaces/" + workspace.UID

	for _, path := range []string{"projects/alpha", "projects/beta"} {
		_, err = ts.Service.CreateMemo(ownerCtx, &apiv1.CreateMemoRequest{
			Memo: &apiv1.Memo{Workspace: workspaceName, FolderPath: path, Title: "doc in " + path, Content: "body"},
		})
		require.NoError(t, err)
	}

	_, err = ts.Service.UpdateWorkspaceFolderSort(ownerCtx, &apiv1.UpdateWorkspaceFolderSortRequest{
		Parent:    workspaceName,
		Path:      "projects/alpha",
		SortField: "updateTime",
		SortOrder: "desc",
	})
	require.NoError(t, err)

	tree, err := ts.Service.GetWorkspaceTree(ownerCtx, &apiv1.GetWorkspaceTreeRequest{Name: workspaceName})
	require.NoError(t, err)

	alpha := findFolder(tree.Nodes, "projects/alpha")
	require.NotNil(t, alpha)
	require.Equal(t, "updateTime", alpha.SortField)

	beta := findFolder(tree.Nodes, "projects/beta")
	require.NotNil(t, beta)
	require.Empty(t, beta.SortField, "a sibling that set nothing keeps inheriting")

	parent := findFolder(tree.Nodes, "projects")
	require.NotNil(t, parent)
	require.Empty(t, parent.SortField, "setting a child must not write to its parent")

	// "projects" holds no documents directly — only subfolders do. It is still a real
	// folder, so the existence check has to look at the whole subtree, not just the
	// documents sitting in the folder itself.
	_, err = ts.Service.UpdateWorkspaceFolderSort(ownerCtx, &apiv1.UpdateWorkspaceFolderSortRequest{
		Parent:    workspaceName,
		Path:      "projects",
		SortField: "alphabetical",
		SortOrder: "asc",
	})
	require.NoError(t, err)

	tree, err = ts.Service.GetWorkspaceTree(ownerCtx, &apiv1.GetWorkspaceTreeRequest{Name: workspaceName})
	require.NoError(t, err)
	parent = findFolder(tree.Nodes, "projects")
	require.NotNil(t, parent)
	require.Equal(t, "alphabetical", parent.SortField)
	// The child's own override still wins over what it would now inherit.
	alpha = findFolder(tree.Nodes, "projects/alpha")
	require.NotNil(t, alpha)
	require.Equal(t, "updateTime", alpha.SortField)
}

func TestFolderSortRejectsBadInput(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	owner, workspace, err := ts.CreateRegularUserWithWorkspace(ctx, "folder-sort-validation")
	require.NoError(t, err)
	ownerCtx := ts.CreateUserContext(ctx, owner.ID)
	workspaceName := "workspaces/" + workspace.UID

	_, err = ts.Service.CreateWorkspaceFolder(ownerCtx, &apiv1.CreateWorkspaceFolderRequest{
		Parent: workspaceName,
		Folder: &apiv1.WorkspaceFolder{Path: "real"},
	})
	require.NoError(t, err)

	// An unchecked path would conjure a folder into the tree, since the upsert
	// inserts a row.
	_, err = ts.Service.UpdateWorkspaceFolderSort(ownerCtx, &apiv1.UpdateWorkspaceFolderSortRequest{
		Parent:    workspaceName,
		Path:      "does/not/exist",
		SortField: "alphabetical",
	})
	require.Equal(t, codes.NotFound, status.Code(err))

	tree, err := ts.Service.GetWorkspaceTree(ownerCtx, &apiv1.GetWorkspaceTreeRequest{Name: workspaceName})
	require.NoError(t, err)
	require.Nil(t, findFolder(tree.Nodes, "does/not/exist"))

	for _, tc := range []struct {
		name  string
		field string
		order string
	}{
		{"unknown field", "byVibes", ""},
		{"unknown order", "", "sideways"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := ts.Service.UpdateWorkspaceFolderSort(ownerCtx, &apiv1.UpdateWorkspaceFolderSortRequest{
				Parent:    workspaceName,
				Path:      "real",
				SortField: tc.field,
				SortOrder: tc.order,
			})
			require.Equal(t, codes.InvalidArgument, status.Code(err))
		})
	}

	_, err = ts.Service.UpdateWorkspaceFolderSort(ownerCtx, &apiv1.UpdateWorkspaceFolderSortRequest{
		Parent:    workspaceName,
		Path:      "",
		SortField: "alphabetical",
	})
	require.Equal(t, codes.InvalidArgument, status.Code(err))
}
