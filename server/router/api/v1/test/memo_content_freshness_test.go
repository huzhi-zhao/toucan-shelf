package test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/fieldmaskpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	apiv1 "github.com/usememos/memos/proto/gen/api/v1"
)

func TestContentOnlyUpdateRefreshesWorkspaceTreeTime(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	user, workspace, err := ts.CreateRegularUserWithWorkspace(ctx, "content-only-freshness")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)
	oldTime := time.Now().Add(-7 * 24 * time.Hour).Truncate(time.Second)
	memo, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{
			Workspace:  "workspaces/" + workspace.UID,
			Title:      "edited through memogit",
			Content:    "before",
			UpdateTime: timestamppb.New(oldTime),
		},
	})
	require.NoError(t, err)
	require.Equal(t, oldTime.Unix(), memo.UpdateTime.AsTime().Unix())

	// UI-only changes must leave the content freshness time alone.
	pinned, err := ts.Service.UpdateMemo(userCtx, &apiv1.UpdateMemoRequest{
		Memo:       &apiv1.Memo{Name: memo.Name, Pinned: true},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"pinned"}},
	})
	require.NoError(t, err)
	require.Equal(t, oldTime.Unix(), pinned.UpdateTime.AsTime().Unix())

	// memogit sends exactly this mask when it pushes an edited local file.
	updated, err := ts.Service.UpdateMemo(userCtx, &apiv1.UpdateMemoRequest{
		Memo:       &apiv1.Memo{Name: memo.Name, Content: "after"},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content"}},
	})
	require.NoError(t, err)
	require.Equal(t, "after", updated.Content)
	require.WithinDuration(t, time.Now(), updated.UpdateTime.AsTime(), time.Minute)

	tree, err := ts.Service.GetWorkspaceTree(userCtx, &apiv1.GetWorkspaceTreeRequest{Name: "workspaces/" + workspace.UID})
	require.NoError(t, err)
	require.Len(t, tree.Nodes, 1)
	require.Equal(t, memo.Name, tree.Nodes[0].Memo)
	require.Equal(t, updated.UpdateTime.AsTime().Unix(), tree.Nodes[0].UpdateTime.AsTime().Unix())
}
