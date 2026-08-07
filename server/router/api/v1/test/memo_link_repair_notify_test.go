package test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	apiv1 "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/store"
)

// TestMemoLinkRepairEnqueuesReindex covers the "silent write to somebody
// else's document" gap: a repair rewrites a referencing document's content,
// but that document's owner never asked for anything, so nothing else in the
// system knows it changed. Without an index job (and the SSE broadcast that
// rides along with it in notifyRepairedMemo) the search index keeps the
// pre-repair text and open readers keep the stale link until a hard reload.
func TestMemoLinkRepairEnqueuesReindex(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	user, err := ts.CreateRegularUser(ctx, "user")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	target, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Title: "Target", Content: "t"},
	})
	require.NoError(t, err)
	linker, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Title: "Linker", Content: "see [Target](/Target)"},
	})
	require.NoError(t, err)
	linkerID := memoIDFromName(ctx, t, ts, linker.Name)

	// Clear whatever the create path queued, so the assertion below can only
	// be satisfied by the repair itself.
	require.NoError(t, ts.Store.DeleteMemoIndexJob(ctx, linkerID))

	_, err = ts.Service.UpdateMemo(userCtx, &apiv1.UpdateMemoRequest{
		Memo:       &apiv1.Memo{Name: target.Name, Title: "Renamed"},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"title"}},
	})
	require.NoError(t, err)

	updated, err := ts.Service.GetMemo(userCtx, &apiv1.GetMemoRequest{Name: linker.Name})
	require.NoError(t, err)
	require.Contains(t, updated.Content, "[Renamed](/Renamed)")

	jobs, err := ts.Store.ListMemoIndexJobs(ctx, &store.FindMemoIndexJob{MemoID: &linkerID})
	require.NoError(t, err)
	require.NotEmpty(t, jobs, "the repaired referrer must be queued for re-indexing")
}

// TestFolderRenameDoesNotTouchOtherWorkspaces covers a data-corruption bug:
// memo_link rows legitimately cross workspaces (a "/memos/{uid}" link can
// point anywhere), so the folder-rename sweep saw a referrer in a different
// workspace and prefix-swapped that document's OWN paths — which mean
// something else entirely over there.
func TestFolderRenameDoesNotTouchOtherWorkspaces(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	user, err := ts.CreateRegularUser(ctx, "user")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	w1, err := ts.Service.CreateWorkspace(userCtx, &apiv1.CreateWorkspaceRequest{Workspace: &apiv1.Workspace{Title: "W1"}})
	require.NoError(t, err)
	w2, err := ts.Service.CreateWorkspace(userCtx, &apiv1.CreateWorkspaceRequest{Workspace: &apiv1.Workspace{Title: "W2"}})
	require.NoError(t, err)

	// Both workspaces have a folder with the same name — that's the trap.
	for _, w := range []string{w1.Name, w2.Name} {
		_, err = ts.Service.CreateWorkspaceFolder(userCtx, &apiv1.CreateWorkspaceFolderRequest{
			Parent: w, Folder: &apiv1.WorkspaceFolder{Path: "guides"},
		})
		require.NoError(t, err)
	}

	target, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Workspace: w1.Name, FolderPath: "guides", Title: "Target", Content: "t"},
	})
	require.NoError(t, err)
	targetUID := memoUIDFromName(t, target.Name)

	_, err = ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Workspace: w2.Name, FolderPath: "guides", Title: "Local", Content: "local"},
	})
	require.NoError(t, err)

	// Links into W1 by uid (which no rename can break) AND to its own sibling
	// by path (which this rename must not touch).
	outsider, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{
			Workspace: w2.Name, Title: "Outsider",
			Content: "cross [Target](/memos/" + targetUID + ") own [Local](/guides/Local)",
		},
	})
	require.NoError(t, err)

	_, err = ts.Service.RenameWorkspaceFolder(userCtx, &apiv1.RenameWorkspaceFolderRequest{
		Parent: w1.Name, OldPath: "guides", NewPath: "manuals",
	})
	require.NoError(t, err)

	got, err := ts.Service.GetMemo(userCtx, &apiv1.GetMemoRequest{Name: outsider.Name})
	require.NoError(t, err)
	require.Contains(t, got.Content, "/guides/Local", "W2's own path must survive a W1 folder rename")
	require.Contains(t, got.Content, "/memos/"+targetUID, "the uid link is workspace-independent and needs no repair")
}

// TestCrossWorkspaceMovePinsOutboundLinksToUID covers the other side of P6:
// the reference check blocks documents linking INTO the moved one, but the
// moved document's own root-relative hrefs name paths in the workspace it
// just left. They're pinned to uid form rather than left to rot.
func TestCrossWorkspaceMovePinsOutboundLinksToUID(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	user, err := ts.CreateRegularUser(ctx, "user")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	w1, err := ts.Service.CreateWorkspace(userCtx, &apiv1.CreateWorkspaceRequest{Workspace: &apiv1.Workspace{Title: "Source"}})
	require.NoError(t, err)
	w2, err := ts.Service.CreateWorkspace(userCtx, &apiv1.CreateWorkspaceRequest{Workspace: &apiv1.Workspace{Title: "Dest"}})
	require.NoError(t, err)

	stayer, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Workspace: w1.Name, Title: "Stayer", Content: "stays put"},
	})
	require.NoError(t, err)
	stayerUID := memoUIDFromName(t, stayer.Name)

	traveler, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Workspace: w1.Name, Title: "Traveler", Content: "see [Stayer](/Stayer) and [ext](https://example.com)"},
	})
	require.NoError(t, err)

	_, err = ts.Service.UpdateMemo(userCtx, &apiv1.UpdateMemoRequest{
		Memo:       &apiv1.Memo{Name: traveler.Name, Workspace: w2.Name},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"workspace"}},
	})
	require.NoError(t, err)

	got, err := ts.Service.GetMemo(userCtx, &apiv1.GetMemoRequest{Name: traveler.Name})
	require.NoError(t, err)
	require.Contains(t, got.Content, "[Stayer](/memos/"+stayerUID+")",
		"a path that only meant something in the old workspace becomes a uid link")
	require.Contains(t, got.Content, "https://example.com", "external links are untouched")
}
