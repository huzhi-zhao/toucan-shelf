package test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/fieldmaskpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	apiv1 "github.com/usememos/memos/proto/gen/api/v1"
)

func TestMemoIcon(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	user, workspace, err := ts.CreateRegularUserWithWorkspace(ctx, "memo-icon")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)
	oldTime := time.Now().Add(-7 * 24 * time.Hour).Truncate(time.Second)
	memo, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{
			Workspace:  "workspaces/" + workspace.UID,
			Title:      "patrol",
			Content:    "before",
			UpdateTime: timestamppb.New(oldTime),
		},
	})
	require.NoError(t, err)
	require.Empty(t, memo.Icon)

	setIcon := func(icon string) (*apiv1.Memo, error) {
		return ts.Service.UpdateMemo(userCtx, &apiv1.UpdateMemoRequest{
			Memo:       &apiv1.Memo{Name: memo.Name, Icon: icon},
			UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"icon"}},
		})
	}

	// Setting the icon is chrome, not authoring: the content freshness time stays put.
	updated, err := setIcon("🏆")
	require.NoError(t, err)
	require.Equal(t, "🏆", updated.Icon)
	require.Equal(t, oldTime.Unix(), updated.UpdateTime.AsTime().Unix())

	tree, err := ts.Service.GetWorkspaceTree(userCtx, &apiv1.GetWorkspaceTreeRequest{Name: "workspaces/" + workspace.UID})
	require.NoError(t, err)
	require.Len(t, tree.Nodes, 1)
	require.Equal(t, "🏆", tree.Nodes[0].Icon)

	// A content write rebuilds the derived payload fields and must leave the icon alone.
	edited, err := ts.Service.UpdateMemo(userCtx, &apiv1.UpdateMemoRequest{
		Memo:       &apiv1.Memo{Name: memo.Name, Content: "after"},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content"}},
	})
	require.NoError(t, err)
	require.Equal(t, "🏆", edited.Icon)

	_, err = setIcon("🏆 patrol")
	require.Equal(t, codes.InvalidArgument, status.Code(err))

	cleared, err := setIcon("")
	require.NoError(t, err)
	require.Empty(t, cleared.Icon)
}
