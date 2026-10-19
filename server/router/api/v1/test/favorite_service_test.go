package test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	apiv1 "github.com/usememos/memos/proto/gen/api/v1"
)

func TestFavorites(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	user, workspace, err := ts.CreateRegularUserWithWorkspace(ctx, "reader")
	require.NoError(t, err)
	other, err := ts.CreateRegularUser(ctx, "outsider")
	require.NoError(t, err)
	userCtx, otherCtx := ts.CreateUserContext(ctx, user.ID), ts.CreateUserContext(ctx, other.ID)
	workspaceName := "workspaces/" + workspace.UID

	_, err = ts.Service.ListFavorites(ctx, &apiv1.ListFavoritesRequest{})
	requireCode(t, err, codes.Unauthenticated)

	create := func(title string) *apiv1.Memo {
		memo, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
			Memo: &apiv1.Memo{Title: title, Content: "# " + title, Workspace: workspaceName},
		})
		require.NoError(t, err)
		return memo
	}
	older, newer, binned := create("Older"), create("Newer"), create("Binned")

	for _, memo := range []*apiv1.Memo{older, newer, binned} {
		_, err := ts.Service.AddFavorite(userCtx, &apiv1.AddFavoriteRequest{Memo: memo.Name})
		require.NoError(t, err)
	}
	// Adding twice is harmless.
	again, err := ts.Service.AddFavorite(userCtx, &apiv1.AddFavoriteRequest{Memo: older.Name})
	require.NoError(t, err)
	require.Equal(t, "Older", again.Title)
	require.Equal(t, workspaceName, again.Workspace)
	require.Equal(t, "reader's workspace", again.WorkspaceTitle)

	// Someone who cannot read the document cannot add it.
	_, err = ts.Service.AddFavorite(otherCtx, &apiv1.AddFavoriteRequest{Memo: older.Name})
	requireCode(t, err, codes.NotFound)

	// Pinning moves an older favorite to the top.
	pinned, err := ts.Service.UpdateFavorite(userCtx, &apiv1.UpdateFavoriteRequest{
		Favorite:   &apiv1.Favorite{Name: "favorites/" + older.Name[len("memos/"):], Pinned: true},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"pinned"}},
	})
	require.NoError(t, err)
	require.True(t, pinned.Pinned)

	// A document in the recycle bin drops out of the list, without being forgotten.
	_, err = ts.Service.UpdateMemo(userCtx, &apiv1.UpdateMemoRequest{
		Memo:       &apiv1.Memo{Name: binned.Name, State: apiv1.State_ARCHIVED},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"state"}},
	})
	require.NoError(t, err)

	list, err := ts.Service.ListFavorites(userCtx, &apiv1.ListFavoritesRequest{})
	require.NoError(t, err)
	require.Len(t, list.Favorites, 2)
	require.Equal(t, older.Name, list.Favorites[0].Memo)
	require.True(t, list.Favorites[0].Pinned)
	require.Equal(t, newer.Name, list.Favorites[1].Memo)

	_, err = ts.Service.UpdateMemo(userCtx, &apiv1.UpdateMemoRequest{
		Memo:       &apiv1.Memo{Name: binned.Name, State: apiv1.State_NORMAL},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"state"}},
	})
	require.NoError(t, err)
	list, err = ts.Service.ListFavorites(userCtx, &apiv1.ListFavoritesRequest{})
	require.NoError(t, err)
	require.Len(t, list.Favorites, 3)

	// Favorites are personal.
	list, err = ts.Service.ListFavorites(otherCtx, &apiv1.ListFavoritesRequest{})
	require.NoError(t, err)
	require.Empty(t, list.Favorites)

	_, err = ts.Service.DeleteFavorite(userCtx, &apiv1.DeleteFavoriteRequest{Name: "favorites/" + newer.Name[len("memos/"):]})
	require.NoError(t, err)
	list, err = ts.Service.ListFavorites(userCtx, &apiv1.ListFavoritesRequest{})
	require.NoError(t, err)
	require.Len(t, list.Favorites, 2)

	// Pinning something that is not a favorite.
	_, err = ts.Service.UpdateFavorite(userCtx, &apiv1.UpdateFavoriteRequest{
		Favorite:   &apiv1.Favorite{Name: "favorites/" + newer.Name[len("memos/"):], Pinned: true},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"pinned"}},
	})
	requireCode(t, err, codes.NotFound)
}
