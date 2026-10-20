package v1

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestSplitHabitTitle(t *testing.T) {
	for _, tc := range []struct{ title, icon, label string }{
		{"💪运动", "💪", "运动"},
		{"📖 阅读", "📖", "阅读"},
		{"🚶🏻", "🚶🏻", ""},
		{"🏃‍♀️跑步", "🏃‍♀️", "跑步"},
		{"👨‍👩‍👧家人", "👨‍👩‍👧", "家人"},
		{"🇨🇦 Canada", "🇨🇦", "Canada"},
		{"❤️", "❤️", ""},
		{"  🙏  ", "🙏", ""},
		{"冥想", "冥", "冥想"},
		{"", "", ""},
	} {
		icon, label := splitHabitTitle(tc.title)
		require.Equal(t, tc.icon, icon, tc.title)
		require.Equal(t, tc.label, label, tc.title)
	}
}

func TestPlannerWeekOf(t *testing.T) {
	day := time.Date(2026, 10, 21, 0, 0, 0, 0, time.UTC) // a Wednesday
	for weekStart, want := range map[int32]string{1: "2026-10-19", 3: "2026-10-21", 4: "2026-10-15", 6: "2026-10-17", 7: "2026-10-18"} {
		start, end := plannerWeekOf(day, weekStart)
		require.Equal(t, want, start.Format(time.DateOnly), weekStart)
		require.Equal(t, start.AddDate(0, 0, 6), end)
	}
}
