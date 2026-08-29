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

// TestMemoLinkMoveRepairP4 covers P4: moving a document within its own
// workspace (folder_path change) must repair every referencer's href to the
// new canonical root-relative path, exercise the edge cases called out in
// the design doc's "风险与历史教训" section, and be idempotent.
func TestMemoLinkMoveRepairP4(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	// Creating a knowledge base and its folders is admin-only, and these tests are
	// about link repair rather than authorization, so they act as the team owner.
	user, err := ts.CreateHostUser(ctx, "user")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	target, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Title: "API Guide", Content: "target content"},
	})
	require.NoError(t, err)
	targetUID := memoUIDFromName(t, target.Name)

	// Referenced from multiple places.
	linkerA, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Title: "Linker A", Content: "See [API Guide](/API%20Guide) for details."},
	})
	require.NoError(t, err)
	linkerB, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Title: "Linker B", Content: "Also see [API Guide](/API%20Guide)."},
	})
	require.NoError(t, err)

	// Hand-customized anchor text: href must still be repaired, text must not.
	customLinker, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Title: "Custom Linker", Content: "Read [the guide](/API%20Guide) first."},
	})
	require.NoError(t, err)

	// Target uid text appearing inside a code block must never be rewritten.
	codeBlockLinker, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{
			Title:   "Code Block Linker",
			Content: "See [API Guide](/API%20Guide).\n\n```\n/API Guide\n```\n",
		},
	})
	require.NoError(t, err)

	// Circular reference: target also links back to linkerA.
	linkerAUID := memoUIDFromName(t, linkerA.Name)
	_, err = ts.Service.UpdateMemo(userCtx, &apiv1.UpdateMemoRequest{
		Memo:       &apiv1.Memo{Name: target.Name, Content: "target content, see [Linker A](/memos/" + linkerAUID + ")."},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content"}},
	})
	require.NoError(t, err)

	// href requiring space escaping via "<>" for the destination folder name.
	_, err = ts.Service.CreateWorkspaceFolder(userCtx, &apiv1.CreateWorkspaceFolderRequest{
		Parent: "workspaces/" + defaultWorkspaceUID(t, ctx, ts, user.ID),
		Folder: &apiv1.WorkspaceFolder{Path: "my notes"},
	})
	require.NoError(t, err)

	// Move the target into the space-containing folder.
	_, err = ts.Service.UpdateMemo(userCtx, &apiv1.UpdateMemoRequest{
		Memo:       &apiv1.Memo{Name: target.Name, FolderPath: "my notes"},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"folder_path"}},
	})
	require.NoError(t, err)
	_ = targetUID

	wantHref := "/my%20notes/API%20Guide"

	t.Run("all referencers' hrefs are rewritten to the new canonical path", func(t *testing.T) {
		a, err := ts.Service.GetMemo(userCtx, &apiv1.GetMemoRequest{Name: linkerA.Name})
		require.NoError(t, err)
		require.Contains(t, a.Content, "[API Guide]("+wantHref+")")

		b, err := ts.Service.GetMemo(userCtx, &apiv1.GetMemoRequest{Name: linkerB.Name})
		require.NoError(t, err)
		require.Contains(t, b.Content, "[API Guide]("+wantHref+")")
	})

	t.Run("hand-edited anchor text is preserved while href is still repaired", func(t *testing.T) {
		c, err := ts.Service.GetMemo(userCtx, &apiv1.GetMemoRequest{Name: customLinker.Name})
		require.NoError(t, err)
		require.Contains(t, c.Content, "[the guide]("+wantHref+")")
	})

	t.Run("uid/path text inside a code block is left alone", func(t *testing.T) {
		cb, err := ts.Service.GetMemo(userCtx, &apiv1.GetMemoRequest{Name: codeBlockLinker.Name})
		require.NoError(t, err)
		require.Contains(t, cb.Content, "[API Guide]("+wantHref+")")
		require.Contains(t, cb.Content, "/API Guide", "the code block's literal text must survive untouched")
	})

	t.Run("circular reference: the moved document's own outbound link is untouched", func(t *testing.T) {
		// Root-relative hrefs are a function of the target's own location, so
		// the memo that moved keeps its own outbound content byte-for-byte —
		// this is the direct, testable consequence of the scheme (also
		// covered standalone in TestMemoLinkSourceMovesItselfIsByteIdentical).
		updatedTarget, err := ts.Service.GetMemo(userCtx, &apiv1.GetMemoRequest{Name: target.Name})
		require.NoError(t, err)
		require.Contains(t, updatedTarget.Content, "[Linker A](/memos/"+linkerAUID+")")
	})

	t.Run("repeating the same move produces no second diff (idempotency)", func(t *testing.T) {
		before, err := ts.Service.GetMemo(userCtx, &apiv1.GetMemoRequest{Name: linkerA.Name})
		require.NoError(t, err)

		// Re-apply the identical folder_path; UpdateMemo only fires repair when
		// the value actually changes, and even if it did, resolving the
		// already-canonical href would be a no-op.
		_, err = ts.Service.UpdateMemo(userCtx, &apiv1.UpdateMemoRequest{
			Memo:       &apiv1.Memo{Name: target.Name, FolderPath: "my notes"},
			UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"folder_path"}},
		})
		require.NoError(t, err)

		after, err := ts.Service.GetMemo(userCtx, &apiv1.GetMemoRequest{Name: linkerA.Name})
		require.NoError(t, err)
		require.Equal(t, before.Content, after.Content)
		require.Equal(t, before.UpdateTime.AsTime(), after.UpdateTime.AsTime())
	})
}

// TestMemoLinkSourceMovesItselfIsByteIdentical is a standalone regression
// test for the acceptance criterion explicitly called out in the
// requirements doc: moving a document that itself contains outbound links
// must leave that document's own content byte-for-byte unchanged, since
// root-relative hrefs never depend on where the linking document lives.
func TestMemoLinkSourceMovesItselfIsByteIdentical(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	// Creating a knowledge base and its folders is admin-only, and these tests are
	// about link repair rather than authorization, so they act as the team owner.
	user, err := ts.CreateHostUser(ctx, "user")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	target, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Title: "Referenced Doc", Content: "content"},
	})
	require.NoError(t, err)
	targetUID := memoUIDFromName(t, target.Name)

	source, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Title: "Mover", Content: "See [Referenced Doc](/Referenced%20Doc) and [abs](/memos/" + targetUID + ")."},
	})
	require.NoError(t, err)

	_, err = ts.Service.CreateWorkspaceFolder(userCtx, &apiv1.CreateWorkspaceFolderRequest{
		Parent: "workspaces/" + defaultWorkspaceUID(t, ctx, ts, user.ID),
		Folder: &apiv1.WorkspaceFolder{Path: "elsewhere"},
	})
	require.NoError(t, err)

	before, err := ts.Service.GetMemo(userCtx, &apiv1.GetMemoRequest{Name: source.Name})
	require.NoError(t, err)

	_, err = ts.Service.UpdateMemo(userCtx, &apiv1.UpdateMemoRequest{
		Memo:       &apiv1.Memo{Name: source.Name, FolderPath: "elsewhere"},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"folder_path"}},
	})
	require.NoError(t, err)

	after, err := ts.Service.GetMemo(userCtx, &apiv1.GetMemoRequest{Name: source.Name})
	require.NoError(t, err)
	require.Equal(t, before.Content, after.Content, "moving a document must not touch its own outbound links")
}

// TestFolderRenameRepairP5 covers P5: renaming/moving a folder within the
// same workspace repairs both external referencers and intra-subtree
// cross-references (root-relative paths, unlike a standard relative-path
// scheme, need intra-subtree links rewritten too).
func TestFolderRenameRepairP5(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	// Creating a knowledge base and its folders is admin-only, and these tests are
	// about link repair rather than authorization, so they act as the team owner.
	user, err := ts.CreateHostUser(ctx, "user")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	workspace, err := ts.Service.CreateWorkspace(userCtx, &apiv1.CreateWorkspaceRequest{
		Workspace: &apiv1.Workspace{Title: "P5 Workspace"},
	})
	require.NoError(t, err)
	workspaceName := workspace.Name

	_, err = ts.Service.CreateWorkspaceFolder(userCtx, &apiv1.CreateWorkspaceFolderRequest{
		Parent: workspaceName, Folder: &apiv1.WorkspaceFolder{Path: "design"},
	})
	require.NoError(t, err)

	docA, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Workspace: workspaceName, FolderPath: "design", Title: "Doc A", Content: "content A"},
	})
	require.NoError(t, err)
	docB, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{
			Workspace: workspaceName, FolderPath: "design", Title: "Doc B",
			Content: "See [Doc A](/design/Doc%20A).",
		},
	})
	require.NoError(t, err)

	external, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Workspace: workspaceName, Title: "External Doc", Content: "See [Doc A](/design/Doc%20A) and [Doc B](/design/Doc%20B)."},
	})
	require.NoError(t, err)

	_, err = ts.Service.RenameWorkspaceFolder(userCtx, &apiv1.RenameWorkspaceFolderRequest{
		Parent: workspaceName, OldPath: "design", NewPath: "specs",
	})
	require.NoError(t, err)

	t.Run("external referencer's href prefix is rewritten", func(t *testing.T) {
		e, err := ts.Service.GetMemo(userCtx, &apiv1.GetMemoRequest{Name: external.Name})
		require.NoError(t, err)
		require.Contains(t, e.Content, "[Doc A](/specs/Doc%20A)")
		require.Contains(t, e.Content, "[Doc B](/specs/Doc%20B)")
		require.NotContains(t, e.Content, "/design/")
	})

	t.Run("intra-subtree cross-reference is also rewritten", func(t *testing.T) {
		b, err := ts.Service.GetMemo(userCtx, &apiv1.GetMemoRequest{Name: docB.Name})
		require.NoError(t, err)
		require.Contains(t, b.Content, "[Doc A](/specs/Doc%20A)")
		require.NotContains(t, b.Content, "/design/")
	})

	t.Run("moved documents themselves resolve at the new path", func(t *testing.T) {
		a, err := ts.Store.GetMemo(ctx, &store.FindMemo{UID: uidPtr(memoUIDFromName(t, docA.Name))})
		require.NoError(t, err)
		require.Equal(t, "specs", a.FolderPath)
	})

	t.Run("repeating the same rename is idempotent for referencers", func(t *testing.T) {
		before, err := ts.Service.GetMemo(userCtx, &apiv1.GetMemoRequest{Name: external.Name})
		require.NoError(t, err)

		_, err = ts.Service.RenameWorkspaceFolder(userCtx, &apiv1.RenameWorkspaceFolderRequest{
			Parent: workspaceName, OldPath: "specs", NewPath: "specs",
		})
		require.NoError(t, err)

		after, err := ts.Service.GetMemo(userCtx, &apiv1.GetMemoRequest{Name: external.Name})
		require.NoError(t, err)
		require.Equal(t, before.Content, after.Content)
	})
}

// TestCrossWorkspaceMoveRejectedP6 covers P6: extending the P1
// reject-with-references check to cross-workspace moves, both entry points
// (single-document UpdateMemo's workspace change, and MoveWorkspaceFolder).
func TestCrossWorkspaceMoveRejectedP6(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	// Creating a knowledge base and its folders is admin-only, and these tests are
	// about link repair rather than authorization, so they act as the team owner.
	user, err := ts.CreateHostUser(ctx, "user")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	// Force a real "home" workspace into existence (and keep its resource
	// name) before creating the "other" workspace below — otherwise the
	// still-workspace-less user's very first CreateWorkspace call becomes
	// their default workspace (resolveOrCreateDefaultWorkspace just returns
	// list[0]), and every subsequent no-Workspace-specified CreateMemo in
	// this test would land in "Other Workspace" itself, making "move to
	// otherWorkspace" a same-workspace no-op instead of the cross-workspace
	// move this test means to exercise.
	homeWorkspace, err := ts.Service.CreateWorkspace(userCtx, &apiv1.CreateWorkspaceRequest{
		Workspace: &apiv1.Workspace{Title: "Home Workspace"},
	})
	require.NoError(t, err)

	otherWorkspace, err := ts.Service.CreateWorkspace(userCtx, &apiv1.CreateWorkspaceRequest{
		Workspace: &apiv1.Workspace{Title: "Other Workspace"},
	})
	require.NoError(t, err)

	t.Run("single document move is rejected when referenced", func(t *testing.T) {
		target, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
			Memo: &apiv1.Memo{Workspace: homeWorkspace.Name, Title: "Doc To Move", Content: "content"},
		})
		require.NoError(t, err)
		targetUID := memoUIDFromName(t, target.Name)

		_, err = ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
			Memo: &apiv1.Memo{Workspace: homeWorkspace.Name, Title: "Referrer", Content: "See [Doc To Move](/memos/" + targetUID + ")."},
		})
		require.NoError(t, err)

		_, err = ts.Service.UpdateMemo(userCtx, &apiv1.UpdateMemoRequest{
			Memo:       &apiv1.Memo{Name: target.Name, Workspace: otherWorkspace.Name},
			UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"workspace"}},
		})
		require.Error(t, err)
		require.Equal(t, codes.FailedPrecondition, status.Code(err))
		require.Contains(t, err.Error(), "Referrer")
	})

	t.Run("single document move succeeds once unreferenced", func(t *testing.T) {
		lonely, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
			Memo: &apiv1.Memo{Workspace: homeWorkspace.Name, Title: "Lonely Mover", Content: "content"},
		})
		require.NoError(t, err)

		_, err = ts.Service.UpdateMemo(userCtx, &apiv1.UpdateMemoRequest{
			Memo:       &apiv1.Memo{Name: lonely.Name, Workspace: otherWorkspace.Name},
			UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"workspace"}},
		})
		require.NoError(t, err)
	})

	t.Run("folder cross-workspace move is rejected when referenced", func(t *testing.T) {
		workspaceName := homeWorkspace.Name

		_, err = ts.Service.CreateWorkspaceFolder(userCtx, &apiv1.CreateWorkspaceFolderRequest{
			Parent: workspaceName, Folder: &apiv1.WorkspaceFolder{Path: "movable"},
		})
		require.NoError(t, err)

		inFolder, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
			Memo: &apiv1.Memo{Workspace: workspaceName, FolderPath: "movable", Title: "In Movable Folder", Content: "content"},
		})
		require.NoError(t, err)
		inFolderUID := memoUIDFromName(t, inFolder.Name)

		_, err = ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
			Memo: &apiv1.Memo{Workspace: workspaceName, Title: "Folder Referrer", Content: "See [it](/memos/" + inFolderUID + ")."},
		})
		require.NoError(t, err)

		_, err = ts.Service.MoveWorkspaceFolder(userCtx, &apiv1.MoveWorkspaceFolderRequest{
			Parent: workspaceName, Path: "movable", DestinationWorkspace: otherWorkspace.Name,
		})
		require.Error(t, err)
		require.Equal(t, codes.FailedPrecondition, status.Code(err))
		require.Contains(t, err.Error(), "Folder Referrer")
	})
}

func uidPtr(uid string) *string { return &uid }

// defaultWorkspaceUID returns the UID of userID's default workspace, creating
// it if necessary (mirroring resolveOrCreateDefaultWorkspace), so tests that
// need to address "workspaces/{uid}" explicitly (e.g. to create a folder)
// don't have to thread a workspace name through every CreateMemo call.
func defaultWorkspaceUID(t *testing.T, ctx context.Context, ts *TestService, userID int32) string {
	t.Helper()
	visibleOnly := false
	list, err := ts.Store.ListWorkspaces(ctx, &store.FindWorkspace{CreatorID: &userID, Hidden: &visibleOnly})
	require.NoError(t, err)
	require.NotEmpty(t, list, "user must already have a default workspace (created by an earlier CreateMemo call)")
	return list[0].UID
}

// TestMoverOutboundRelativeLinksAreFossilized covers R1.3
// (docs/dev/design/20260829-relative-and-cross-workspace-refs.md): a document
// that moves must have its OWN document-relative hrefs pinned to the canonical
// root-relative form, because a relative href means "relative to where I am"
// and the move is exactly what changed that. Root-relative, uid, and
// non-document hrefs must come through byte-identical.
func TestMoverOutboundRelativeLinksAreFossilized(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	user, err := ts.CreateHostUser(ctx, "user")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	_, err = ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Title: "Referenced Doc", Content: "content"},
	})
	require.NoError(t, err)

	source, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{
			Title: "Mover",
			Content: "bare [a](Referenced%20Doc.md), explicit [b](./Referenced%20Doc), " +
				"rooted [c](/Referenced%20Doc), external [d](example.com/page), " +
				"unresolvable [e](./No%20Such%20Doc).",
		},
	})
	require.NoError(t, err)

	workspace := "workspaces/" + defaultWorkspaceUID(t, ctx, ts, user.ID)
	for _, path := range []string{"elsewhere", "later"} {
		_, err = ts.Service.CreateWorkspaceFolder(userCtx, &apiv1.CreateWorkspaceFolderRequest{
			Parent: workspace,
			Folder: &apiv1.WorkspaceFolder{Path: path},
		})
		require.NoError(t, err)
	}

	_, err = ts.Service.UpdateMemo(userCtx, &apiv1.UpdateMemoRequest{
		Memo:       &apiv1.Memo{Name: source.Name, FolderPath: "elsewhere"},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"folder_path"}},
	})
	require.NoError(t, err)

	after, err := ts.Service.GetMemo(userCtx, &apiv1.GetMemoRequest{Name: source.Name})
	require.NoError(t, err)
	require.Equal(t,
		"bare [a](/Referenced%20Doc.md), explicit [b](/Referenced%20Doc), "+
			"rooted [c](/Referenced%20Doc), external [d](example.com/page), "+
			"unresolvable [e](./No%20Such%20Doc).",
		after.Content,
		"relative hrefs that named a real document must be pinned; a schemeless external "+
			"destination and an href that never resolved must be left exactly as written")

	// Moving again must be a no-op: the pinned hrefs are root-relative now, and
	// the two left alone still resolve to nothing from either folder.
	_, err = ts.Service.UpdateMemo(userCtx, &apiv1.UpdateMemoRequest{
		Memo:       &apiv1.Memo{Name: source.Name, FolderPath: "later"},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"folder_path"}},
	})
	require.NoError(t, err)
	again, err := ts.Service.GetMemo(userCtx, &apiv1.GetMemoRequest{Name: source.Name})
	require.NoError(t, err)
	require.Equal(t, after.Content, again.Content, "fossilization must be idempotent")
}

// TestSubtreeRelativeLinksSurviveFolderMove is the other half of R1.3: when a
// whole folder moves, the relative paths BETWEEN its documents are unchanged,
// so they must be left alone. Only a relative href pointing out of the moved
// subtree is stale.
func TestSubtreeRelativeLinksSurviveFolderMove(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	user, err := ts.CreateHostUser(ctx, "user")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)
	_, err = ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Title: "Outside Doc", Content: "content"},
	})
	require.NoError(t, err)

	workspace := "workspaces/" + defaultWorkspaceUID(t, ctx, ts, user.ID)
	_, err = ts.Service.CreateWorkspaceFolder(userCtx, &apiv1.CreateWorkspaceFolderRequest{
		Parent: workspace,
		Folder: &apiv1.WorkspaceFolder{Path: "src"},
	})
	require.NoError(t, err)
	_, err = ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Title: "Sibling", FolderPath: "src", Content: "content"},
	})
	require.NoError(t, err)
	mover, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{
			Title:      "Mover",
			FolderPath: "src",
			Content:    "sibling [a](./Sibling), outside [b](../Outside%20Doc).",
		},
	})
	require.NoError(t, err)

	_, err = ts.Service.RenameWorkspaceFolder(userCtx, &apiv1.RenameWorkspaceFolderRequest{
		// A move that changes the subtree's DEPTH: "../" out of it now lands
		// somewhere else, whereas a same-depth rename would leave it correct.
		Parent: workspace, OldPath: "src", NewPath: "dst/src",
	})
	require.NoError(t, err)

	after, err := ts.Service.GetMemo(userCtx, &apiv1.GetMemoRequest{Name: mover.Name})
	require.NoError(t, err)
	require.Equal(t,
		"sibling [a](./Sibling), outside [b](/Outside%20Doc).",
		after.Content,
		"the intra-subtree relative link is still correct and must stay relative; "+
			"the one pointing out of the subtree must be pinned")
}
