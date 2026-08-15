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

// Knowledge-base level authorization is the gate in front of every document
// operation: a member reaches a document only through a knowledge base they were
// assigned, and the document's own visibility only narrows things further. These
// tests pin that gate on the paths a member can actually reach it from.
//
// The gate is also the whole decision: a document belongs to its knowledge base, not
// to whoever typed it, so a grant carries read (and for EDITOR, write) over every
// document in that knowledge base, PRIVATE ones included. Visibility only widens
// access outward to people holding no grant at all.

// TestGrantedMemberSeesPrivateDocuments pins the rule against the shape that first
// exposed it: every document in a knowledge base predates sharing and so carries the
// PRIVATE default, which used to leave a freshly assigned member staring at a tree of
// empty folders.
func TestGrantedMemberSeesPrivateDocuments(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	owner, workspace, err := ts.CreateRegularUserWithWorkspace(ctx, "private-kb-owner")
	require.NoError(t, err)
	ownerCtx := ts.CreateUserContext(ctx, owner.ID)

	member, err := ts.CreateUnassignedUser(ctx, "private-kb-member")
	require.NoError(t, err)
	require.NoError(t, ts.GrantWorkspace(ctx, workspace.ID, member, store.WorkspaceGrantRoleEditor))
	memberCtx := ts.CreateUserContext(ctx, member.ID)

	outsider, err := ts.CreateUnassignedUser(ctx, "private-kb-outsider")
	require.NoError(t, err)
	outsiderCtx := ts.CreateUserContext(ctx, outsider.ID)

	memo, err := ts.Service.CreateMemo(ownerCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{
			Workspace:  "workspaces/" + workspace.UID,
			FolderPath: "notes",
			Title:      "private doc",
			Content:    "written before the knowledge base was shared",
			Visibility: apiv1.Visibility_PRIVATE,
		},
	})
	require.NoError(t, err)

	got, err := ts.Service.GetMemo(memberCtx, &apiv1.GetMemoRequest{Name: memo.Name})
	require.NoError(t, err)
	require.Equal(t, memo.Name, got.Name)

	// The sidebar tree is where the empty-shelf symptom showed up.
	tree, err := ts.Service.GetWorkspaceTree(memberCtx, &apiv1.GetWorkspaceTreeRequest{
		Name: "workspaces/" + workspace.UID,
	})
	require.NoError(t, err)
	require.True(t, treeContainsDocument(tree.Nodes, memo.Name), "member should see the PRIVATE document in the tree")

	listed, err := ts.Service.ListMemos(memberCtx, &apiv1.ListMemosRequest{
		Workspace: "workspaces/" + workspace.UID,
	})
	require.NoError(t, err)
	require.Len(t, listed.Memos, 1)
	require.Equal(t, memo.Name, listed.Memos[0].Name)

	// An EDITOR grant carries write over documents they did not author.
	_, err = ts.Service.UpdateMemo(memberCtx, &apiv1.UpdateMemoRequest{
		Memo:       &apiv1.Memo{Name: memo.Name, Content: "edited by the member"},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content"}},
	})
	require.NoError(t, err)

	// None of this reaches anyone without a grant.
	_, err = ts.Service.GetMemo(outsiderCtx, &apiv1.GetMemoRequest{Name: memo.Name})
	require.Equal(t, codes.NotFound, status.Code(err))

	unscoped, err := ts.Service.ListMemos(outsiderCtx, &apiv1.ListMemosRequest{})
	require.NoError(t, err)
	require.Empty(t, unscoped.Memos)
}

// treeContainsDocument reports whether the tree holds a DOCUMENT node with this name.
func treeContainsDocument(nodes []*apiv1.WorkspaceTreeNode, memoName string) bool {
	for _, n := range nodes {
		if n.Type == apiv1.WorkspaceTreeNode_DOCUMENT && n.Memo == memoName {
			return true
		}
		if treeContainsDocument(n.Children, memoName) {
			return true
		}
	}
	return false
}

// TestMemberWithoutGrantIsShutOut covers the default state of a freshly invited
// member: assigned to nothing, they can neither list, read, nor write anything.
func TestMemberWithoutGrantIsShutOut(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	owner, workspace, err := ts.CreateRegularUserWithWorkspace(ctx, "kb-owner")
	require.NoError(t, err)
	ownerCtx := ts.CreateUserContext(ctx, owner.ID)

	outsider, err := ts.CreateUnassignedUser(ctx, "kb-outsider")
	require.NoError(t, err)
	outsiderCtx := ts.CreateUserContext(ctx, outsider.ID)

	memo, err := ts.Service.CreateMemo(ownerCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Content: "protected doc", Visibility: apiv1.Visibility_PROTECTED},
	})
	require.NoError(t, err)

	workspaceName := "workspaces/" + workspace.UID

	// The knowledge base itself is invisible.
	list, err := ts.Service.ListWorkspaces(outsiderCtx, &apiv1.ListWorkspacesRequest{})
	require.NoError(t, err)
	require.Empty(t, list.Workspaces)

	_, err = ts.Service.GetWorkspace(outsiderCtx, &apiv1.GetWorkspaceRequest{Name: workspaceName})
	require.Equal(t, codes.NotFound, status.Code(err))

	_, err = ts.Service.GetWorkspaceTree(outsiderCtx, &apiv1.GetWorkspaceTreeRequest{Name: workspaceName})
	require.Equal(t, codes.NotFound, status.Code(err))

	// So is its content — a PROTECTED document used to be readable by any signed-in
	// account, which is exactly the hole this gate closes. A document in a library
	// the caller cannot reach answers NotFound rather than PermissionDenied: that it
	// exists at all is itself something they are not entitled to learn.
	_, err = ts.Service.GetMemo(outsiderCtx, &apiv1.GetMemoRequest{Name: memo.Name})
	require.Equal(t, codes.NotFound, status.Code(err))

	memos, err := ts.Service.ListMemos(outsiderCtx, &apiv1.ListMemosRequest{PageSize: 10})
	require.NoError(t, err)
	require.Empty(t, memos.Memos)

	// And writing is refused for the same reason it cannot be read.
	_, err = ts.Service.UpdateMemo(outsiderCtx, &apiv1.UpdateMemoRequest{
		Memo:       &apiv1.Memo{Name: memo.Name, Content: "hijacked"},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content"}},
	})
	require.Equal(t, codes.NotFound, status.Code(err))

	_, err = ts.Service.DeleteMemo(outsiderCtx, &apiv1.DeleteMemoRequest{Name: memo.Name})
	require.Equal(t, codes.NotFound, status.Code(err))

	// Creating a document of their own fails too: there is nowhere to put it.

	_, err = ts.Service.CreateMemo(outsiderCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Content: "nowhere to put this"},
	})
	require.Equal(t, codes.PermissionDenied, status.Code(err))
}

// TestViewerCanReadButNotWrite pins the read-only half of the two grant roles.
func TestViewerCanReadButNotWrite(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	owner, workspace, err := ts.CreateRegularUserWithWorkspace(ctx, "viewer-kb-owner")
	require.NoError(t, err)
	ownerCtx := ts.CreateUserContext(ctx, owner.ID)

	viewer, err := ts.CreateUnassignedUser(ctx, "kb-viewer")
	require.NoError(t, err)
	require.NoError(t, ts.GrantWorkspace(ctx, workspace.ID, viewer, store.WorkspaceGrantRoleViewer))
	viewerCtx := ts.CreateUserContext(ctx, viewer.ID)

	memo, err := ts.Service.CreateMemo(ownerCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{
			Workspace:  "workspaces/" + workspace.UID,
			Content:    "protected doc",
			Visibility: apiv1.Visibility_PROTECTED,
		},
	})
	require.NoError(t, err)

	got, err := ts.Service.GetMemo(viewerCtx, &apiv1.GetMemoRequest{Name: memo.Name})
	require.NoError(t, err)
	require.Equal(t, memo.Name, got.Name)

	_, err = ts.Service.UpdateMemo(viewerCtx, &apiv1.UpdateMemoRequest{
		Memo:       &apiv1.Memo{Name: memo.Name, Content: "edited by viewer"},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content"}},
	})
	require.Equal(t, codes.PermissionDenied, status.Code(err))

	_, err = ts.Service.DeleteMemo(viewerCtx, &apiv1.DeleteMemoRequest{Name: memo.Name})
	require.Equal(t, codes.PermissionDenied, status.Code(err))

	// Folder management follows document write access, so it stops at VIEWER too.
	_, err = ts.Service.CreateWorkspaceFolder(viewerCtx, &apiv1.CreateWorkspaceFolderRequest{
		Parent: "workspaces/" + workspace.UID,
		Folder: &apiv1.WorkspaceFolder{Path: "notes"},
	})
	require.Equal(t, codes.PermissionDenied, status.Code(err))
}

// TestEditorWritesDocumentsButNotTheLibrary pins the line requirement §2 draws:
// a grant is document-level read/write, never library administration.
func TestEditorWritesDocumentsButNotTheLibrary(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	editor, workspace, err := ts.CreateRegularUserWithWorkspace(ctx, "kb-editor")
	require.NoError(t, err)
	editorCtx := ts.CreateUserContext(ctx, editor.ID)
	workspaceName := "workspaces/" + workspace.UID

	memo, err := ts.Service.CreateMemo(editorCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Workspace: workspaceName, Content: "editor's doc"},
	})
	require.NoError(t, err)

	updated, err := ts.Service.UpdateMemo(editorCtx, &apiv1.UpdateMemoRequest{
		Memo:       &apiv1.Memo{Name: memo.Name, Content: "edited"},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content"}},
	})
	require.NoError(t, err)
	require.Equal(t, "edited", updated.Content)

	// Folders are contents, not library configuration: an editor organizes them
	// the same way they organize the documents inside.
	_, err = ts.Service.CreateWorkspaceFolder(editorCtx, &apiv1.CreateWorkspaceFolderRequest{
		Parent: workspaceName,
		Folder: &apiv1.WorkspaceFolder{Path: "notes"},
	})
	require.NoError(t, err)

	_, err = ts.Service.RenameWorkspaceFolder(editorCtx, &apiv1.RenameWorkspaceFolderRequest{
		Parent:  workspaceName,
		OldPath: "notes",
		NewPath: "notebook",
	})
	require.NoError(t, err)

	_, err = ts.Service.DeleteWorkspaceFolder(editorCtx, &apiv1.DeleteWorkspaceFolderRequest{
		Parent: workspaceName,
		Path:   "notebook",
	})
	require.NoError(t, err)

	// Library-level operations stay with the admin, even in a library the member
	// holds EDITOR in and created themselves.
	_, err = ts.Service.CreateWorkspace(editorCtx, &apiv1.CreateWorkspaceRequest{
		Workspace: &apiv1.Workspace{Title: "Members Cannot Create This"},
	})
	require.Equal(t, codes.PermissionDenied, status.Code(err))

	_, err = ts.Service.UpdateWorkspace(editorCtx, &apiv1.UpdateWorkspaceRequest{
		Workspace:  &apiv1.Workspace{Name: workspaceName, Title: "Renamed"},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"title"}},
	})
	require.Equal(t, codes.PermissionDenied, status.Code(err))

	_, err = ts.Service.DeleteWorkspace(editorCtx, &apiv1.DeleteWorkspaceRequest{Name: workspaceName})
	require.Equal(t, codes.PermissionDenied, status.Code(err))
}

// TestProtectedDocumentDoesNotCrossLibraries is requirement §6 stated as a test:
// being assigned library A must not make library B's PROTECTED documents readable,
// while PUBLIC documents stay readable because anonymous readers already see them.
func TestProtectedDocumentDoesNotCrossLibraries(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	alice, _, err := ts.CreateRegularUserWithWorkspace(ctx, "kb-alice")
	require.NoError(t, err)
	aliceCtx := ts.CreateUserContext(ctx, alice.ID)

	bob, bobWorkspace, err := ts.CreateRegularUserWithWorkspace(ctx, "kb-bob")
	require.NoError(t, err)
	bobCtx := ts.CreateUserContext(ctx, bob.ID)
	bobWorkspaceName := "workspaces/" + bobWorkspace.UID

	bobProtected, err := ts.Service.CreateMemo(bobCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{
			Workspace:  bobWorkspaceName,
			Content:    "bob's protected doc",
			Visibility: apiv1.Visibility_PROTECTED,
		},
	})
	require.NoError(t, err)

	bobPublic, err := ts.Service.CreateMemo(bobCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{
			Workspace:  bobWorkspaceName,
			Content:    "bob's public doc",
			Visibility: apiv1.Visibility_PUBLIC,
		},
	})
	require.NoError(t, err)

	_, err = ts.Service.GetMemo(aliceCtx, &apiv1.GetMemoRequest{Name: bobProtected.Name})
	require.Equal(t, codes.NotFound, status.Code(err))

	got, err := ts.Service.GetMemo(aliceCtx, &apiv1.GetMemoRequest{Name: bobPublic.Name})
	require.NoError(t, err)
	require.Equal(t, bobPublic.Name, got.Name)

	// The cross-library listing tells the same story: only the PUBLIC one shows up.
	memos, err := ts.Service.ListMemos(aliceCtx, &apiv1.ListMemosRequest{PageSize: 10})
	require.NoError(t, err)
	names := make([]string, 0, len(memos.Memos))
	for _, m := range memos.Memos {
		names = append(names, m.Name)
	}
	require.Contains(t, names, bobPublic.Name)
	require.NotContains(t, names, bobProtected.Name)
}

// TestAdminReachesEveryLibrary is the other side of the gate: the team owner needs
// no grant, because ADMIN carries implicit access to everything (requirement §1).
func TestAdminReachesEveryLibrary(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	admin, err := ts.CreateHostUser(ctx, "team-owner")
	require.NoError(t, err)
	adminCtx := ts.CreateUserContext(ctx, admin.ID)

	member, workspace, err := ts.CreateRegularUserWithWorkspace(ctx, "kb-member")
	require.NoError(t, err)
	memberCtx := ts.CreateUserContext(ctx, member.ID)

	private, err := ts.Service.CreateMemo(memberCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{
			Workspace:  "workspaces/" + workspace.UID,
			Content:    "member's private doc",
			Visibility: apiv1.Visibility_PRIVATE,
		},
	})
	require.NoError(t, err)

	got, err := ts.Service.GetMemo(adminCtx, &apiv1.GetMemoRequest{Name: private.Name})
	require.NoError(t, err)
	require.Equal(t, private.Name, got.Name)

	list, err := ts.Service.ListWorkspaces(adminCtx, &apiv1.ListWorkspacesRequest{})
	require.NoError(t, err)
	require.Len(t, list.Workspaces, 1)
}
