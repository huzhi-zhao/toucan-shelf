package test

import (
	"context"
	"testing"

	"github.com/lithammer/shortuuid/v4"
	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/store"
)

func createWorkspace(ctx context.Context, t *testing.T, ts *store.Store, creatorID int32, title string) *store.Workspace {
	t.Helper()
	workspace, err := ts.CreateWorkspace(ctx, &store.Workspace{
		UID: shortuuid.New(), CreatorID: creatorID, Title: title, StorageSlug: title,
	})
	require.NoError(t, err)
	return workspace
}

func TestListWorkspacesOrdersByDisplayOrder(t *testing.T) {
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	user, err := createTestingHostUser(ctx, ts)
	require.NoError(t, err)

	// Created first-to-last; display_order deliberately does not match creation order.
	first := createWorkspace(ctx, t, ts, user.ID, "first")
	second := createWorkspace(ctx, t, ts, user.ID, "second")
	third := createWorkspace(ctx, t, ts, user.ID, "third")

	order := int32(5)
	_, err = ts.UpdateWorkspace(ctx, &store.UpdateWorkspace{ID: first.ID, DisplayOrder: &order})
	require.NoError(t, err)
	negative := int32(-1)
	_, err = ts.UpdateWorkspace(ctx, &store.UpdateWorkspace{ID: third.ID, DisplayOrder: &negative})
	require.NoError(t, err)

	list, err := ts.ListWorkspaces(ctx, &store.FindWorkspace{CreatorID: &user.ID})
	require.NoError(t, err)
	require.Len(t, list, 3)
	// third (-1), then first (5), and finally second — its display_order is still the
	// default 0, which means "unset" and sorts last rather than first.
	require.Equal(t, third.ID, list[0].ID)
	require.Equal(t, first.ID, list[1].ID)
	require.Equal(t, second.ID, list[2].ID)
}

func TestListWorkspacesFiltersHidden(t *testing.T) {
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	user, err := createTestingHostUser(ctx, ts)
	require.NoError(t, err)

	visible := createWorkspace(ctx, t, ts, user.ID, "visible")
	hidden := createWorkspace(ctx, t, ts, user.ID, "hidden")
	require.False(t, visible.Hidden, "workspaces must default to visible")

	hide := true
	updated, err := ts.UpdateWorkspace(ctx, &store.UpdateWorkspace{ID: hidden.ID, Hidden: &hide})
	require.NoError(t, err)
	require.True(t, updated.Hidden)

	visibleOnly := false
	list, err := ts.ListWorkspaces(ctx, &store.FindWorkspace{CreatorID: &user.ID, Hidden: &visibleOnly})
	require.NoError(t, err)
	require.Len(t, list, 1)
	require.Equal(t, visible.ID, list[0].ID)

	// A nil Hidden filter returns both — that is what the "show hidden" view relies on.
	all, err := ts.ListWorkspaces(ctx, &store.FindWorkspace{CreatorID: &user.ID})
	require.NoError(t, err)
	require.Len(t, all, 2)

	// Hidden workspaces stay reachable by UID, which is what makes restoring possible.
	got, err := ts.GetWorkspace(ctx, &store.FindWorkspace{UID: &hidden.UID})
	require.NoError(t, err)
	require.NotNil(t, got)
	require.True(t, got.Hidden)
}
