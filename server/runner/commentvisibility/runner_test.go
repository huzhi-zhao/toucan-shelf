package commentvisibility

import (
	"context"
	"encoding/csv"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/store"
	teststore "github.com/usememos/memos/store/test"
)

type fixture struct {
	store   *store.Store
	dataDir string
	user    *store.User
}

func newFixture(ctx context.Context, t *testing.T) *fixture {
	t.Helper()
	testStore := teststore.NewTestingStore(ctx, t)
	t.Cleanup(func() { _ = testStore.Close() })

	user, err := testStore.CreateUser(ctx, &store.User{
		Username: "backfill-owner",
		Role:     store.RoleUser,
		Email:    "backfill-owner@example.com",
	})
	require.NoError(t, err)

	return &fixture{store: testStore, dataDir: t.TempDir(), user: user}
}

func (f *fixture) createMemo(ctx context.Context, t *testing.T, uid string, visibility store.Visibility) *store.Memo {
	t.Helper()
	memo, err := f.store.CreateMemo(ctx, &store.Memo{
		UID:        uid,
		CreatorID:  f.user.ID,
		Content:    uid + " content",
		Visibility: visibility,
	})
	require.NoError(t, err)
	return memo
}

// commentOn wires up the COMMENT relation the same way CreateMemoComment does.
func (f *fixture) commentOn(ctx context.Context, t *testing.T, comment, parent *store.Memo) {
	t.Helper()
	_, err := f.store.UpsertMemoRelation(ctx, &store.MemoRelation{
		MemoID:        comment.ID,
		RelatedMemoID: parent.ID,
		Type:          store.MemoRelationComment,
	})
	require.NoError(t, err)
}

func (f *fixture) visibilityOf(ctx context.Context, t *testing.T, id int32) store.Visibility {
	t.Helper()
	memo, err := f.store.GetMemo(ctx, &store.FindMemo{ID: &id})
	require.NoError(t, err)
	require.NotNil(t, memo)
	return memo.Visibility
}

// dumpRows returns the rows of the single dump file in the data directory.
func dumpRows(t *testing.T, dataDir string) [][]string {
	t.Helper()
	entries, err := os.ReadDir(dataDir)
	require.NoError(t, err)

	var dumps []string
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), DumpFilePrefix) {
			dumps = append(dumps, filepath.Join(dataDir, entry.Name()))
		}
	}
	require.Len(t, dumps, 1, "expected exactly one dump file")

	file, err := os.Open(dumps[0])
	require.NoError(t, err)
	defer file.Close()
	rows, err := csv.NewReader(file).ReadAll()
	require.NoError(t, err)
	return rows
}

// A comment that was created while its parent was public, on a parent since made
// private, is the shape this backfill exists for.
func TestRunOnce_AlignsStaleComments(t *testing.T) {
	ctx := context.Background()
	f := newFixture(ctx, t)

	parent := f.createMemo(ctx, t, "stale-parent", store.Private)
	stale := f.createMemo(ctx, t, "stale-comment", store.Public)
	f.commentOn(ctx, t, stale, parent)

	// Already in step: must not be touched, and must not show up in the dump.
	aligned := f.createMemo(ctx, t, "aligned-comment", store.Private)
	f.commentOn(ctx, t, aligned, parent)

	// Not a comment at all.
	unrelated := f.createMemo(ctx, t, "unrelated", store.Public)

	NewRunner(f.store, f.dataDir).RunOnce(ctx)

	require.Equal(t, store.Private, f.visibilityOf(ctx, t, stale.ID))
	require.Equal(t, store.Private, f.visibilityOf(ctx, t, aligned.ID))
	require.Equal(t, store.Public, f.visibilityOf(ctx, t, unrelated.ID))
	require.Equal(t, store.Private, f.visibilityOf(ctx, t, parent.ID), "the parent itself is never rewritten")

	// The rewrite is not reversible, so the pre-backfill values have to survive it.
	rows := dumpRows(t, f.dataDir)
	require.Len(t, rows, 2, "header plus the one rewritten comment")
	require.Equal(t, []string{"memo_id", "memo_uid", "parent_memo_id", "previous_visibility", "new_visibility"}, rows[0])
	require.Equal(t, "stale-comment", rows[1][1])
	require.Equal(t, string(store.Public), rows[1][3])
	require.Equal(t, string(store.Private), rows[1][4])
}

// Loosening is carried over too: the runner aligns, it does not only tighten.
func TestRunOnce_AlignsInBothDirections(t *testing.T) {
	ctx := context.Background()
	f := newFixture(ctx, t)

	parent := f.createMemo(ctx, t, "public-parent", store.Public)
	comment := f.createMemo(ctx, t, "private-comment", store.Private)
	f.commentOn(ctx, t, comment, parent)

	NewRunner(f.store, f.dataDir).RunOnce(ctx)

	require.Equal(t, store.Public, f.visibilityOf(ctx, t, comment.ID))
}

// With nothing to fix, the run leaves no dump behind — an empty file every restart
// would be pure noise in the data directory.
func TestRunOnce_NothingToDoWritesNoDump(t *testing.T) {
	ctx := context.Background()
	f := newFixture(ctx, t)

	parent := f.createMemo(ctx, t, "in-step-parent", store.Protected)
	comment := f.createMemo(ctx, t, "in-step-comment", store.Protected)
	f.commentOn(ctx, t, comment, parent)

	NewRunner(f.store, f.dataDir).RunOnce(ctx)

	entries, err := os.ReadDir(f.dataDir)
	require.NoError(t, err)
	for _, entry := range entries {
		require.False(t, strings.HasPrefix(entry.Name(), DumpFilePrefix), "unexpected dump file %s", entry.Name())
	}
	require.Equal(t, store.Protected, f.visibilityOf(ctx, t, comment.ID))
}

// The dump is the only record of what the values were, so a data directory that
// cannot be written to means the backfill declines to run at all.
func TestRunOnce_SkipsBackfillWhenDumpCannotBeWritten(t *testing.T) {
	ctx := context.Background()
	f := newFixture(ctx, t)

	parent := f.createMemo(ctx, t, "unwritable-parent", store.Private)
	comment := f.createMemo(ctx, t, "unwritable-comment", store.Public)
	f.commentOn(ctx, t, comment, parent)

	NewRunner(f.store, filepath.Join(f.dataDir, "does-not-exist")).RunOnce(ctx)

	require.Equal(t, store.Public, f.visibilityOf(ctx, t, comment.ID),
		"without a dump the comment must be left as it was")
}
