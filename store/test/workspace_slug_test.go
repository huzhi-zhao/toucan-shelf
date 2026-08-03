package test

import (
	"context"
	"testing"

	"github.com/lithammer/shortuuid/v4"
	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/store"
)

func TestGenerateStorageSlugCollision(t *testing.T) {
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	user, err := createTestingHostUser(ctx, ts)
	require.NoError(t, err)

	// Two different titles that clean down to the same slug.
	firstUID, secondUID := shortuuid.New(), shortuuid.New()

	firstSlug, err := ts.GenerateStorageSlug(ctx, firstUID, "AI 知识库")
	require.NoError(t, err)
	require.Equal(t, "AI知识库", firstSlug)

	_, err = ts.CreateWorkspace(ctx, &store.Workspace{
		UID: firstUID, CreatorID: user.ID, Title: "AI 知识库", StorageSlug: firstSlug,
	})
	require.NoError(t, err)

	// The second workspace must not land in the first one's directory.
	secondSlug, err := ts.GenerateStorageSlug(ctx, secondUID, "AI·知识库")
	require.NoError(t, err)
	require.NotEqual(t, firstSlug, secondSlug)
	require.Equal(t, "AI知识库-"+secondUID, secondSlug)
}

func TestGenerateStorageSlugFallsBackToUID(t *testing.T) {
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)

	uid := shortuuid.New()
	slug, err := ts.GenerateStorageSlug(ctx, uid, "···")
	require.NoError(t, err)
	require.Equal(t, uid, slug)
}

func TestEnsureWorkspaceStorageSlugBackfillsOnce(t *testing.T) {
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	user, err := createTestingHostUser(ctx, ts)
	require.NoError(t, err)

	// A workspace predating the storage_slug column: created with an empty slug.
	workspace, err := ts.CreateWorkspace(ctx, &store.Workspace{
		UID: shortuuid.New(), CreatorID: user.ID, Title: "旧知识库",
	})
	require.NoError(t, err)
	require.Empty(t, workspace.StorageSlug)

	slug, err := ts.EnsureWorkspaceStorageSlug(ctx, workspace)
	require.NoError(t, err)
	require.Equal(t, "旧知识库", slug)

	// Persisted, and stable across a rename — object keys already written must keep resolving.
	newTitle := "改名后的知识库"
	_, err = ts.UpdateWorkspace(ctx, &store.UpdateWorkspace{ID: workspace.ID, Title: &newTitle})
	require.NoError(t, err)

	reloaded, err := ts.GetWorkspace(ctx, &store.FindWorkspace{ID: &workspace.ID})
	require.NoError(t, err)
	require.Equal(t, "旧知识库", reloaded.StorageSlug)

	again, err := ts.EnsureWorkspaceStorageSlug(ctx, reloaded)
	require.NoError(t, err)
	require.Equal(t, "旧知识库", again)
}
