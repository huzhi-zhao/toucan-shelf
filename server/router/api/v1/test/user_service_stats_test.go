package test

import (
	"context"
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/store"
)

func TestGetUserStats_MemoUpdatedTimestamps(t *testing.T) {
	ctx := context.Background()

	ts := NewTestService(t)
	defer ts.Cleanup()

	user, err := ts.CreateHostUser(ctx, "ts-user")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	memo, err := ts.Store.CreateMemo(ctx, &store.Memo{
		UID:        "ts-memo-1",
		CreatorID:  user.ID,
		Content:    "first content",
		Visibility: store.Public,
	})
	require.NoError(t, err)
	require.NotNil(t, memo)

	// SQLite UpdateMemo only sets fields explicitly passed (created_ts default
	// fires on INSERT only). So bump updated_ts explicitly to simulate an edit
	// happening after creation.
	newContent := "second content"
	newUpdatedTs := memo.UpdatedTs + 100
	require.NoError(t, ts.Store.UpdateMemo(ctx, &store.UpdateMemo{
		ID:        memo.ID,
		Content:   &newContent,
		UpdatedTs: &newUpdatedTs,
	}))

	userName := fmt.Sprintf("users/%s", user.Username)
	resp, err := ts.Service.GetUserStats(userCtx, &v1pb.GetUserStatsRequest{Name: userName})
	require.NoError(t, err)
	require.NotNil(t, resp)

	require.Len(t, resp.MemoCreatedTimestamps, 1, "should have one created timestamp")
	require.Len(t, resp.MemoUpdatedTimestamps, 1, "should have one updated timestamp")

	require.Equal(t, memo.CreatedTs, resp.MemoCreatedTimestamps[0].AsTime().Unix())
	require.Equal(t, newUpdatedTs, resp.MemoUpdatedTimestamps[0].AsTime().Unix())
	require.Greater(
		t,
		resp.MemoUpdatedTimestamps[0].AsTime().Unix(),
		resp.MemoCreatedTimestamps[0].AsTime().Unix(),
		"updated_ts should be after created_ts after an edit",
	)
}

func TestListAllUserStats_FilterExcludesPrivateMemos(t *testing.T) {
	ctx := context.Background()

	ts := NewTestService(t)
	defer ts.Cleanup()

	user, err := ts.CreateHostUser(ctx, "stats-filter-user")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	_, err = ts.Store.CreateMemo(ctx, &store.Memo{
		UID:        "stats-filter-public",
		CreatorID:  user.ID,
		Content:    "public memo",
		Visibility: store.Public,
	})
	require.NoError(t, err)
	_, err = ts.Store.CreateMemo(ctx, &store.Memo{
		UID:        "stats-filter-private",
		CreatorID:  user.ID,
		Content:    "private memo",
		Visibility: store.Private,
	})
	require.NoError(t, err)

	unfilteredResp, err := ts.Service.ListAllUserStats(userCtx, &v1pb.ListAllUserStatsRequest{})
	require.NoError(t, err)
	require.Len(t, unfilteredResp.Stats, 1)
	require.Equal(t, int32(2), unfilteredResp.Stats[0].TotalMemoCount)

	filteredResp, err := ts.Service.ListAllUserStats(userCtx, &v1pb.ListAllUserStatsRequest{
		Filter: `visibility in ["PUBLIC", "PROTECTED"]`,
	})
	require.NoError(t, err)
	require.Len(t, filteredResp.Stats, 1)
	require.Equal(t, int32(1), filteredResp.Stats[0].TotalMemoCount, "the private memo must be filtered out")
}
