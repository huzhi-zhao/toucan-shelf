package test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/store"
)

func TestMemoFavorites(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	user, err := createTestingHostUser(ctx, ts)
	require.NoError(t, err)
	other, err := createTestingUserWithRole(ctx, ts, "other", store.RoleUser)
	require.NoError(t, err)

	first, err := ts.AddMemoFavorite(ctx, user.ID, 1)
	require.NoError(t, err)
	require.False(t, first.Pinned)
	_, err = ts.AddMemoFavorite(ctx, user.ID, 2)
	require.NoError(t, err)
	_, err = ts.AddMemoFavorite(ctx, other.ID, 1)
	require.NoError(t, err)

	// Pinned first; adding again keeps the pin.
	pinned := true
	updated, err := ts.UpdateMemoFavorite(ctx, &store.UpdateMemoFavorite{UserID: user.ID, MemoID: 1, Pinned: &pinned})
	require.NoError(t, err)
	require.True(t, updated.Pinned)
	again, err := ts.AddMemoFavorite(ctx, user.ID, 1)
	require.NoError(t, err)
	require.True(t, again.Pinned)

	list, err := ts.ListMemoFavorites(ctx, &store.FindMemoFavorite{UserID: &user.ID})
	require.NoError(t, err)
	require.Len(t, list, 2)
	require.Equal(t, int32(1), list[0].MemoID)
	require.Equal(t, int32(2), list[1].MemoID)

	// Updating a document that is not a favorite finds nothing.
	missing, err := ts.UpdateMemoFavorite(ctx, &store.UpdateMemoFavorite{UserID: user.ID, MemoID: 3, Pinned: &pinned})
	require.NoError(t, err)
	require.Nil(t, missing)

	require.NoError(t, ts.DeleteMemoFavorite(ctx, user.ID, 1))
	require.NoError(t, ts.DeleteMemoFavorite(ctx, user.ID, 1))
	list, err = ts.ListMemoFavorites(ctx, &store.FindMemoFavorite{UserID: &user.ID})
	require.NoError(t, err)
	require.Len(t, list, 1)

	// Other users' favorites are their own.
	list, err = ts.ListMemoFavorites(ctx, &store.FindMemoFavorite{UserID: &other.ID})
	require.NoError(t, err)
	require.Len(t, list, 1)
}
