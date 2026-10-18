package v1

import (
	"strings"
	"unicode/utf8"

	"github.com/pkg/errors"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
)

// Limits on the "Me" page items. They are hand-made shortcuts, so these are far above real use and only
// keep a buggy or hostile client from storing something unbounded in a user setting.
const (
	maxMeItems         = 50
	maxMeItemIDLength  = 64
	maxMeItemIcon      = 16
	maxMeItemTitle     = 100
	maxMeItemNote      = 500
	maxMeItemMemoField = 128
)

func validateMeItemsSetting(setting *v1pb.UserSetting_MeItemsSetting) error {
	if len(setting.Items) > maxMeItems {
		return errors.Errorf("at most %d items", maxMeItems)
	}
	seen := make(map[string]bool, len(setting.Items))
	for i, item := range setting.Items {
		if item == nil {
			return errors.Errorf("item %d is empty", i)
		}
		if item.Id == "" || len(item.Id) > maxMeItemIDLength {
			return errors.Errorf("item %d: id must be 1-%d characters", i, maxMeItemIDLength)
		}
		if seen[item.Id] {
			return errors.Errorf("item %d: duplicate id %q", i, item.Id)
		}
		seen[item.Id] = true
		if strings.TrimSpace(item.Title) == "" {
			return errors.Errorf("item %d: title is required", i)
		}
		if utf8.RuneCountInString(item.Title) > maxMeItemTitle {
			return errors.Errorf("item %d: title is longer than %d characters", i, maxMeItemTitle)
		}
		if utf8.RuneCountInString(item.Icon) > maxMeItemIcon {
			return errors.Errorf("item %d: icon is longer than %d characters", i, maxMeItemIcon)
		}
		if utf8.RuneCountInString(item.Note) > maxMeItemNote {
			return errors.Errorf("item %d: note is longer than %d characters", i, maxMeItemNote)
		}
		if item.Memo != "" {
			uid, ok := strings.CutPrefix(item.Memo, "memos/")
			if !ok || uid == "" || strings.Contains(uid, "/") || len(item.Memo) > maxMeItemMemoField {
				return errors.Errorf("item %d: memo must be memos/{memo}", i)
			}
		}
		if _, ok := v1pb.UserSetting_MeItem_Style_name[int32(item.Style)]; !ok {
			return errors.Errorf("item %d: unknown style %d", i, item.Style)
		}
	}
	return nil
}

func convertMeItemsSettingFromStore(setting *storepb.MeItemsUserSetting) *v1pb.UserSetting_MeItemsSetting {
	items := make([]*v1pb.UserSetting_MeItem, 0, len(setting.GetItems()))
	for _, item := range setting.GetItems() {
		items = append(items, &v1pb.UserSetting_MeItem{
			Id:    item.Id,
			Icon:  item.Icon,
			Title: item.Title,
			Note:  item.Note,
			Memo:  item.Memo,
			Style: v1pb.UserSetting_MeItem_Style(item.Style),
		})
	}
	return &v1pb.UserSetting_MeItemsSetting{Items: items}
}

func convertMeItemsSettingToStore(setting *v1pb.UserSetting_MeItemsSetting) *storepb.MeItemsUserSetting {
	items := make([]*storepb.MeItem, 0, len(setting.GetItems()))
	for _, item := range setting.GetItems() {
		items = append(items, &storepb.MeItem{
			Id:    item.Id,
			Icon:  item.Icon,
			Title: item.Title,
			Note:  item.Note,
			Memo:  item.Memo,
			Style: storepb.MeItem_Style(item.Style),
		})
	}
	return &storepb.MeItemsUserSetting{Items: items}
}
