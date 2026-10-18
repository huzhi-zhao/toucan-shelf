package test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	apiv1 "github.com/usememos/memos/proto/gen/api/v1"
)

func TestUserMeItemsSetting(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	user, err := ts.CreateRegularUser(ctx, "me-user")
	require.NoError(t, err)
	other, err := ts.CreateRegularUser(ctx, "other-user")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)
	const name = "users/me-user/settings/ME_ITEMS"

	// Nothing saved yet: an empty list, not an error.
	got, err := ts.Service.GetUserSetting(userCtx, &apiv1.GetUserSettingRequest{Name: name})
	require.NoError(t, err)
	require.NotNil(t, got.GetMeItemsSetting())
	require.Empty(t, got.GetMeItemsSetting().Items)

	update := func(ctx context.Context, items ...*apiv1.UserSetting_MeItem) (*apiv1.UserSetting, error) {
		return ts.Service.UpdateUserSetting(ctx, &apiv1.UpdateUserSettingRequest{
			Setting: &apiv1.UserSetting{
				Name:  name,
				Value: &apiv1.UserSetting_MeItemsSetting_{MeItemsSetting: &apiv1.UserSetting_MeItemsSetting{Items: items}},
			},
			UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"me_items_setting"}},
		})
	}

	finance := &apiv1.UserSetting_MeItem{
		Id: "a", Icon: "💰", Title: "年度理财计划", Note: "配置 7.7w", Memo: "memos/plan", Style: apiv1.UserSetting_MeItem_MULTI_LINE,
	}
	reading := &apiv1.UserSetting_MeItem{Id: "b", Title: "书单", Style: apiv1.UserSetting_MeItem_SINGLE_LINE}
	_, err = update(userCtx, reading, finance)
	require.NoError(t, err)

	// Order is kept: it is the display order.
	got, err = ts.Service.GetUserSetting(userCtx, &apiv1.GetUserSettingRequest{Name: name})
	require.NoError(t, err)
	items := got.GetMeItemsSetting().Items
	require.Len(t, items, 2)
	require.Equal(t, "b", items[0].Id)
	require.Equal(t, "a", items[1].Id)
	require.Equal(t, "💰", items[1].Icon)
	require.Equal(t, "memos/plan", items[1].Memo)
	require.Equal(t, apiv1.UserSetting_MeItem_MULTI_LINE, items[1].Style)

	// An update replaces the whole list.
	_, err = update(userCtx, finance)
	require.NoError(t, err)
	got, err = ts.Service.GetUserSetting(userCtx, &apiv1.GetUserSettingRequest{Name: name})
	require.NoError(t, err)
	require.Len(t, got.GetMeItemsSetting().Items, 1)

	for _, bad := range [][]*apiv1.UserSetting_MeItem{
		{{Id: "", Title: "x"}},
		{{Id: "a", Title: "  "}},
		{{Id: "a", Title: "x"}, {Id: "a", Title: "y"}},
		{{Id: "a", Title: "x", Memo: "workspaces/x"}},
		{{Id: "a", Title: "x", Style: 9}},
	} {
		_, err = update(userCtx, bad...)
		requireCode(t, err, codes.InvalidArgument)
	}

	_, err = update(ts.CreateUserContext(ctx, other.ID), finance)
	requireCode(t, err, codes.PermissionDenied)
}
