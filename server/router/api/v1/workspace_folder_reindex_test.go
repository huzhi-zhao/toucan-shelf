package v1

import (
	"context"
	"os"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/store"
	teststore "github.com/usememos/memos/store/test"
)

// RenameWorkspaceFolder rewrites folder_path with bulk SQL, so nothing in the
// store layer enqueues the moved documents for re-indexing. reindexFolder is what
// keeps memo_chunk's denormalized folder_path from going stale; these tests pin
// down that it covers the whole subtree and nothing outside it.
func TestReindexFolder(t *testing.T) {
	if driver := os.Getenv("DRIVER"); driver != "" && driver != "sqlite" {
		t.Skip("index jobs are only implemented for sqlite")
	}
	ctx := context.Background()
	ts := teststore.NewTestingStore(ctx, t)
	service := &APIV1Service{Store: ts}

	const workspaceID int32 = 1
	create := func(uid, folderPath string) *store.Memo {
		memo, err := ts.CreateMemo(ctx, &store.Memo{
			UID:         uid,
			CreatorID:   1,
			WorkspaceID: workspaceID,
			FolderPath:  folderPath,
			Content:     "content of " + uid,
			Visibility:  store.Private,
		})
		require.NoError(t, err)
		return memo
	}

	root := create("renamed-root", "archive")
	nested := create("renamed-nested", "archive/2026")
	// A sibling whose path merely shares a prefix must not be dragged in.
	sibling := create("untouched", "archive-old")
	otherWorkspace, err := ts.CreateMemo(ctx, &store.Memo{
		UID:         "other-workspace",
		CreatorID:   1,
		WorkspaceID: workspaceID + 1,
		FolderPath:  "archive",
		Content:     "content of other-workspace",
		Visibility:  store.Private,
	})
	require.NoError(t, err)

	// Creating a memo already enqueues it; clear the queue so what remains after
	// the call is unambiguously reindexFolder's doing.
	for _, memo := range []*store.Memo{root, nested, sibling, otherWorkspace} {
		require.NoError(t, ts.DeleteMemoIndexJob(ctx, memo.ID))
	}

	service.reindexFolder(ctx, workspaceID, "archive")

	pending := store.IndexJobStatusPending
	jobs, err := ts.ListMemoIndexJobs(ctx, &store.FindMemoIndexJob{Status: &pending})
	require.NoError(t, err)

	queued := make(map[int32]string, len(jobs))
	for _, job := range jobs {
		queued[job.MemoID] = job.Reason
	}
	require.Equal(t, map[int32]string{
		root.ID:   store.IndexJobReasonUpdated,
		nested.ID: store.IndexJobReasonUpdated,
	}, queued)
}

func TestReindexFolderSurvivesAMissingFolder(t *testing.T) {
	if driver := os.Getenv("DRIVER"); driver != "" && driver != "sqlite" {
		t.Skip("index jobs are only implemented for sqlite")
	}
	ctx := context.Background()
	ts := teststore.NewTestingStore(ctx, t)
	service := &APIV1Service{Store: ts}

	// The rename has already committed by the time this runs, so an empty (or
	// nonexistent) folder must be a no-op rather than a panic.
	service.reindexFolder(ctx, 1, "nothing/here")

	pending := store.IndexJobStatusPending
	jobs, err := ts.ListMemoIndexJobs(ctx, &store.FindMemoIndexJob{Status: &pending})
	require.NoError(t, err)
	require.Empty(t, jobs)
}
