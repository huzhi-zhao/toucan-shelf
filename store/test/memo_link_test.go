package test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/store"
)

func TestMemoLinkStore(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	user, err := createTestingHostUser(ctx, ts)
	require.NoError(t, err)

	a, err := ts.CreateMemo(ctx, &store.Memo{UID: "link-a", CreatorID: user.ID, Content: "a", Visibility: store.Public})
	require.NoError(t, err)
	b, err := ts.CreateMemo(ctx, &store.Memo{UID: "link-b", CreatorID: user.ID, Content: "b", Visibility: store.Public})
	require.NoError(t, err)
	c, err := ts.CreateMemo(ctx, &store.Memo{UID: "link-c", CreatorID: user.ID, Content: "c", Visibility: store.Public})
	require.NoError(t, err)

	t.Run("ReplaceMemoLinks writes and overwrites outbound links", func(t *testing.T) {
		require.NoError(t, ts.ReplaceMemoLinks(ctx, a.ID, []int32{b.ID, c.ID}))

		outbound, err := ts.ListMemoLinks(ctx, &store.FindMemoLink{MemoID: &a.ID})
		require.NoError(t, err)
		require.Len(t, outbound, 2)

		// Overwrite with a smaller set: the stale edge to c must disappear.
		require.NoError(t, ts.ReplaceMemoLinks(ctx, a.ID, []int32{b.ID}))
		outbound, err = ts.ListMemoLinks(ctx, &store.FindMemoLink{MemoID: &a.ID})
		require.NoError(t, err)
		require.Len(t, outbound, 1)
		require.Equal(t, b.ID, outbound[0].TargetMemoID)
	})

	t.Run("ReplaceMemoLinks de-duplicates targets", func(t *testing.T) {
		require.NoError(t, ts.ReplaceMemoLinks(ctx, a.ID, []int32{b.ID, b.ID, b.ID}))
		outbound, err := ts.ListMemoLinks(ctx, &store.FindMemoLink{MemoID: &a.ID})
		require.NoError(t, err)
		require.Len(t, outbound, 1)
	})

	t.Run("ReplaceMemoLinks with an empty slice clears all outbound links", func(t *testing.T) {
		require.NoError(t, ts.ReplaceMemoLinks(ctx, a.ID, []int32{b.ID, c.ID}))
		require.NoError(t, ts.ReplaceMemoLinks(ctx, a.ID, nil))
		outbound, err := ts.ListMemoLinks(ctx, &store.FindMemoLink{MemoID: &a.ID})
		require.NoError(t, err)
		require.Empty(t, outbound)
	})

	t.Run("ListMemoLinks by TargetMemoID finds reverse references", func(t *testing.T) {
		require.NoError(t, ts.ReplaceMemoLinks(ctx, a.ID, []int32{c.ID}))
		require.NoError(t, ts.ReplaceMemoLinks(ctx, b.ID, []int32{c.ID}))

		inbound, err := ts.ListMemoLinks(ctx, &store.FindMemoLink{TargetMemoID: &c.ID})
		require.NoError(t, err)
		require.Len(t, inbound, 2)

		inbound, err = ts.ListMemoLinks(ctx, &store.FindMemoLink{TargetMemoIDList: []int32{c.ID}})
		require.NoError(t, err)
		require.Len(t, inbound, 2)
	})

	t.Run("DeleteMemoLinks by MemoID removes outbound links only", func(t *testing.T) {
		require.NoError(t, ts.ReplaceMemoLinks(ctx, a.ID, []int32{c.ID}))
		require.NoError(t, ts.ReplaceMemoLinks(ctx, b.ID, []int32{c.ID}))

		require.NoError(t, ts.DeleteMemoLinks(ctx, &store.DeleteMemoLink{MemoID: &a.ID}))

		outboundA, err := ts.ListMemoLinks(ctx, &store.FindMemoLink{MemoID: &a.ID})
		require.NoError(t, err)
		require.Empty(t, outboundA)

		outboundB, err := ts.ListMemoLinks(ctx, &store.FindMemoLink{MemoID: &b.ID})
		require.NoError(t, err)
		require.Len(t, outboundB, 1)
	})

	t.Run("DeleteMemoLinks by TargetMemoID removes inbound links only", func(t *testing.T) {
		require.NoError(t, ts.ReplaceMemoLinks(ctx, a.ID, []int32{c.ID}))
		require.NoError(t, ts.ReplaceMemoLinks(ctx, b.ID, []int32{c.ID, a.ID}))

		require.NoError(t, ts.DeleteMemoLinks(ctx, &store.DeleteMemoLink{TargetMemoID: &c.ID}))

		inboundC, err := ts.ListMemoLinks(ctx, &store.FindMemoLink{TargetMemoID: &c.ID})
		require.NoError(t, err)
		require.Empty(t, inboundC)

		// b -> a survives since it doesn't target c.
		inboundA, err := ts.ListMemoLinks(ctx, &store.FindMemoLink{TargetMemoID: &a.ID})
		require.NoError(t, err)
		require.Len(t, inboundA, 1)
	})

	t.Run("deleting a memo cleans up both its outbound and inbound links", func(t *testing.T) {
		d, err := ts.CreateMemo(ctx, &store.Memo{UID: "link-d", CreatorID: user.ID, Content: "d", Visibility: store.Public})
		require.NoError(t, err)
		e, err := ts.CreateMemo(ctx, &store.Memo{UID: "link-e", CreatorID: user.ID, Content: "e", Visibility: store.Public})
		require.NoError(t, err)

		// d -> e (d's outbound), e -> d (e's outbound, i.e. d's inbound).
		require.NoError(t, ts.ReplaceMemoLinks(ctx, d.ID, []int32{e.ID}))
		require.NoError(t, ts.ReplaceMemoLinks(ctx, e.ID, []int32{d.ID}))

		require.NoError(t, ts.DeleteMemo(ctx, &store.DeleteMemo{ID: d.ID}))

		remaining, err := ts.ListMemoLinks(ctx, &store.FindMemoLink{MemoIDList: []int32{d.ID, e.ID}, TargetMemoIDList: []int32{d.ID, e.ID}})
		require.NoError(t, err)
		require.Empty(t, remaining, "both d's outbound row and e's row targeting d must be gone")
	})
}
