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
	maxMeItemMemos     = 20
	maxMeGroups        = 20
	maxMeGroupTitle    = 50
)

func validateMeItemsSetting(setting *v1pb.UserSetting_MeItemsSetting) error {
	if len(setting.Items) > maxMeItems {
		return errors.Errorf("at most %d items", maxMeItems)
	}
	if len(setting.Groups) > maxMeGroups {
		return errors.Errorf("at most %d groups", maxMeGroups)
	}
	groups := make(map[string]bool, len(setting.Groups))
	for i, group := range setting.Groups {
		if group == nil {
			return errors.Errorf("group %d is empty", i)
		}
		if group.Id == "" || len(group.Id) > maxMeItemIDLength {
			return errors.Errorf("group %d: id must be 1-%d characters", i, maxMeItemIDLength)
		}
		if groups[group.Id] {
			return errors.Errorf("group %d: duplicate id %q", i, group.Id)
		}
		groups[group.Id] = true
		if strings.TrimSpace(group.Title) == "" {
			return errors.Errorf("group %d: title is required", i)
		}
		if utf8.RuneCountInString(group.Title) > maxMeGroupTitle {
			return errors.Errorf("group %d: title is longer than %d characters", i, maxMeGroupTitle)
		}
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
		if len(item.Memos) > maxMeItemMemos {
			return errors.Errorf("item %d: at most %d linked documents", i, maxMeItemMemos)
		}
		for _, memo := range append([]string{item.Memo}, item.Memos...) { //nolint:staticcheck // the deprecated field is still accepted
			if memo == "" {
				continue
			}
			uid, ok := strings.CutPrefix(memo, "memos/")
			if !ok || uid == "" || strings.Contains(uid, "/") || len(memo) > maxMeItemMemoField {
				return errors.Errorf("item %d: memo must be memos/{memo}", i)
			}
		}
		if item.Group != "" && !groups[item.Group] {
			return errors.Errorf("item %d: unknown group %q", i, item.Group)
		}
		if _, ok := v1pb.UserSetting_MeItem_Style_name[int32(item.Style)]; !ok {
			return errors.Errorf("item %d: unknown style %d", i, item.Style)
		}
	}
	return nil
}

// meItemMemos is an item's linked documents: memos, or the one memo of an item saved before memos existed
// (or sent by a client that does not know them). Blanks and repeats are dropped.
func meItemMemos(memos []string, legacy string) []string {
	if len(memos) == 0 && legacy != "" {
		memos = []string{legacy}
	}
	list := []string{}
	seen := map[string]bool{}
	for _, memo := range memos {
		if memo == "" || seen[memo] {
			continue
		}
		seen[memo] = true
		list = append(list, memo)
	}
	return list
}

func convertMeItemsSettingFromStore(setting *storepb.MeItemsUserSetting) *v1pb.UserSetting_MeItemsSetting {
	items := make([]*v1pb.UserSetting_MeItem, 0, len(setting.GetItems()))
	for _, item := range setting.GetItems() {
		memos := meItemMemos(item.Memos, item.Memo)
		items = append(items, &v1pb.UserSetting_MeItem{
			Id:    item.Id,
			Icon:  item.Icon,
			Title: item.Title,
			Note:  item.Note,
			Memo:  firstMemo(memos), //nolint:staticcheck // still filled for clients that only know it
			Memos: memos,
			Style: v1pb.UserSetting_MeItem_Style(item.Style),
			Group: item.Group,
		})
	}
	groups := make([]*v1pb.UserSetting_MeGroup, 0, len(setting.GetGroups()))
	for _, group := range setting.GetGroups() {
		groups = append(groups, &v1pb.UserSetting_MeGroup{Id: group.Id, Title: group.Title})
	}
	return &v1pb.UserSetting_MeItemsSetting{Items: items, Groups: groups}
}

func convertMeItemsSettingToStore(setting *v1pb.UserSetting_MeItemsSetting) *storepb.MeItemsUserSetting {
	items := make([]*storepb.MeItem, 0, len(setting.GetItems()))
	for _, item := range setting.GetItems() {
		items = append(items, &storepb.MeItem{
			Id:    item.Id,
			Icon:  item.Icon,
			Title: item.Title,
			Note:  item.Note,
			Memos: meItemMemos(item.Memos, item.Memo), //nolint:staticcheck // the deprecated field is still accepted
			Style: storepb.MeItem_Style(item.Style),
			Group: item.Group,
		})
	}
	groups := make([]*storepb.MeGroup, 0, len(setting.GetGroups()))
	for _, group := range setting.GetGroups() {
		groups = append(groups, &storepb.MeGroup{Id: group.Id, Title: strings.TrimSpace(group.Title)})
	}
	return &storepb.MeItemsUserSetting{Items: items, Groups: groups}
}
