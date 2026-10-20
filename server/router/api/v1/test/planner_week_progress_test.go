package test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
)

func TestPlannerSettings(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()
	user, err := ts.CreateRegularUser(ctx, "planner")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	_, err = ts.Service.GetPlannerSettings(ctx, &v1pb.GetPlannerSettingsRequest{})
	requireCode(t, err, codes.Unauthenticated)

	settings, err := ts.Service.GetPlannerSettings(userCtx, &v1pb.GetPlannerSettingsRequest{})
	require.NoError(t, err)
	require.Zero(t, settings.WeekStartDay) // follows the instance until set

	_, err = ts.Service.UpdatePlannerSettings(userCtx, &v1pb.UpdatePlannerSettingsRequest{Settings: &v1pb.PlannerSettings{WeekStartDay: 8}})
	requireCode(t, err, codes.InvalidArgument)
	_, err = ts.Service.UpdatePlannerSettings(userCtx, &v1pb.UpdatePlannerSettingsRequest{})
	requireCode(t, err, codes.InvalidArgument)

	_, err = ts.Service.UpdatePlannerSettings(userCtx, &v1pb.UpdatePlannerSettingsRequest{Settings: &v1pb.PlannerSettings{WeekStartDay: 1}})
	require.NoError(t, err)
	settings, err = ts.Service.GetPlannerSettings(userCtx, &v1pb.GetPlannerSettingsRequest{})
	require.NoError(t, err)
	require.Equal(t, int32(1), settings.WeekStartDay)

	// Planner settings are not general user settings: they stay out of that list.
	listed, err := ts.Service.ListUserSettings(userCtx, &v1pb.ListUserSettingsRequest{Parent: "users/" + user.Username})
	require.NoError(t, err)
	for _, setting := range listed.Settings {
		require.NotContains(t, setting.Name, "PLANNER")
	}
}

func TestWeekProgress(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()
	user, err := ts.CreateRegularUser(ctx, "planner")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)
	// The server's clock runs ahead, so that check-ins in the days below are not refused as future ones.
	ts.Service.Clock = func() time.Time { return time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC) }

	progress := func(date string, weeks int32) *v1pb.GetWeekProgressResponse {
		t.Helper()
		response, err := ts.Service.GetWeekProgress(userCtx, &v1pb.GetWeekProgressRequest{Date: date, Weeks: weeks})
		require.NoError(t, err)
		return response
	}
	setWeekStart := func(day int32) {
		t.Helper()
		_, err := ts.Service.UpdatePlannerSettings(userCtx, &v1pb.UpdatePlannerSettingsRequest{Settings: &v1pb.PlannerSettings{WeekStartDay: day}})
		require.NoError(t, err)
	}
	enable := func(localDate string, memos []string, entries ...*v1pb.HabitVersionEntry) {
		t.Helper()
		_, err := ts.Service.UpdateHabitDraft(userCtx, &v1pb.UpdateHabitDraftRequest{Draft: &v1pb.HabitVersion{Entries: entries, Memos: memos}})
		require.NoError(t, err)
		_, err = ts.Service.EnableHabitDraft(userCtx, &v1pb.EnableHabitDraftRequest{LocalDate: localDate})
		require.NoError(t, err)
	}
	checkIn := func(habit, date, note string) {
		t.Helper()
		_, err := ts.Service.SetCheckIn(userCtx, &v1pb.SetCheckInRequest{CheckIn: &v1pb.CheckIn{Habit: habit, Date: date, Note: note}})
		require.NoError(t, err)
	}
	goal := func(n int32) *int32 { return &n }

	t.Run("arguments are checked", func(t *testing.T) {
		_, err := ts.Service.GetWeekProgress(ctx, &v1pb.GetWeekProgressRequest{Date: "2026-10-20"})
		requireCode(t, err, codes.Unauthenticated)
		_, err = ts.Service.GetWeekProgress(userCtx, &v1pb.GetWeekProgressRequest{Date: "10/20"})
		requireCode(t, err, codes.InvalidArgument)
		_, err = ts.Service.GetWeekProgress(userCtx, &v1pb.GetWeekProgressRequest{Date: "2026-10-20", Weeks: 13})
		requireCode(t, err, codes.InvalidArgument)
	})

	t.Run("before any plan", func(t *testing.T) {
		response := progress("2026-10-20", 0)
		require.Equal(t, int32(7), response.WeekStartDay) // the instance's default, Sunday
		require.Len(t, response.Weeks, 1)
		week := response.Weeks[0]
		require.Equal(t, "2026-10-18", week.WeekStart)
		require.Equal(t, "2026-10-24", week.WeekEnd)
		require.True(t, week.ContainsDate)
		require.Equal(t, int32(5), week.DaysLeft)
		require.Nil(t, week.Plan)
		require.Empty(t, week.Habits)
	})

	run, err := ts.Service.CreateHabit(userCtx, &v1pb.CreateHabitRequest{Habit: &v1pb.Habit{Title: "💪运动"}})
	require.NoError(t, err)
	read, err := ts.Service.CreateHabit(userCtx, &v1pb.CreateHabitRequest{Habit: &v1pb.Habit{Title: "📖 阅读"}})
	require.NoError(t, err)
	walk, err := ts.Service.CreateHabit(userCtx, &v1pb.CreateHabitRequest{Habit: &v1pb.Habit{Title: "🚶🏻"}})
	require.NoError(t, err)

	// Plan A from 10-01; plan B from Wednesday 10-21 drops reading, adds walking and lowers the running goal.
	enable("2026-10-01", nil,
		&v1pb.HabitVersionEntry{Habit: run.Name, WeeklyGoal: 3},
		&v1pb.HabitVersionEntry{Habit: read.Name, WeeklyGoal: 2})
	checkIn(run.Name, "2026-10-13", "跑步")
	checkIn(read.Name, "2026-10-14", "")
	checkIn(run.Name, "2026-10-15", "")
	checkIn(read.Name, "2026-10-20", "第三章")
	enable("2026-10-21", []string{"memos/gone"},
		&v1pb.HabitVersionEntry{Habit: run.Name, WeeklyGoal: 2},
		&v1pb.HabitVersionEntry{Habit: walk.Name})
	checkIn(walk.Name, "2026-10-22", "")

	// A habit todo done on its day checks in and counts; one left past its day has failed.
	fiveK, err := ts.Service.CreateTodo(userCtx, &v1pb.CreateTodoRequest{Todo: &v1pb.Todo{Title: "跑 5 公里", Date: "2026-10-23", Habit: run.Name}, LocalDate: "2026-10-22"})
	require.NoError(t, err)
	_, err = ts.Service.UpdateTodo(userCtx, &v1pb.UpdateTodoRequest{
		Todo: &v1pb.Todo{Name: fiveK.Name, Status: v1pb.Todo_DONE}, UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"status"}}, LocalDate: "2026-10-23",
	})
	require.NoError(t, err)
	stroll, err := ts.Service.CreateTodo(userCtx, &v1pb.CreateTodoRequest{Todo: &v1pb.Todo{Title: "散步", Date: "2026-10-24", Habit: walk.Name}, LocalDate: "2026-10-22"})
	require.NoError(t, err)
	_, err = ts.Service.CreateTodo(userCtx, &v1pb.CreateTodoRequest{Todo: &v1pb.Todo{Title: "交电费", Date: "2026-10-23"}, LocalDate: "2026-10-22"})
	require.NoError(t, err)

	t.Run("weeks from Monday, a plan changed mid-week", func(t *testing.T) {
		setWeekStart(1)
		response := progress("2026-10-25", 2)
		require.Equal(t, int32(1), response.WeekStartDay)
		require.Len(t, response.Weeks, 2)

		this := response.Weeks[0]
		require.Equal(t, "2026-10-19", this.WeekStart)
		require.Equal(t, "2026-10-25", this.WeekEnd)
		require.True(t, this.ContainsDate)
		require.Equal(t, int32(1), this.DaysLeft) // Sunday is the last day
		// Measured against plan B, the one in effect on the last day; plan A ran Monday and Tuesday.
		require.Equal(t, "2026-10-21", this.Plan.EffectiveDate)
		require.Equal(t, []string{"2026-10-01"}, this.Plan.Replaced)
		require.Len(t, this.Plan.Documents, 1)
		require.Equal(t, "memos/gone", this.Plan.Documents[0].Name)
		require.Empty(t, this.Plan.Documents[0].Title)

		require.Len(t, this.Habits, 3)
		require.Equal(t, run.Name, this.Habits[0].Habit)
		require.Equal(t, "💪", this.Habits[0].Icon)
		require.Equal(t, "运动", this.Habits[0].Label)
		require.True(t, this.Habits[0].InPlan)
		require.Equal(t, goal(2), this.Habits[0].WeeklyGoal)
		require.Equal(t, int32(1), this.Habits[0].CheckInCount) // made by the todo
		require.Equal(t, fiveK.Name, this.Habits[0].CheckIns[0].Todo)
		require.Equal(t, "跑 5 公里", this.Habits[0].CheckIns[0].Note)

		require.Equal(t, "🚶🏻", this.Habits[1].Icon)
		require.Empty(t, this.Habits[1].Label)
		require.Nil(t, this.Habits[1].WeeklyGoal) // in the plan without a goal
		require.Equal(t, int32(1), this.Habits[1].CheckInCount)

		// Reading left with plan A but was checked in on Tuesday: reported, outside the plan.
		require.Equal(t, read.Name, this.Habits[2].Habit)
		require.Equal(t, "阅读", this.Habits[2].Label)
		require.False(t, this.Habits[2].InPlan)
		require.Nil(t, this.Habits[2].WeeklyGoal)
		require.Equal(t, int32(1), this.Habits[2].CheckInCount)
		require.Equal(t, "第三章", this.Habits[2].CheckIns[0].Note)

		require.Len(t, this.HabitTodos, 2) // the plain todo is not reported
		require.Equal(t, v1pb.WeekHabitTodo_DONE, this.HabitTodos[0].State)
		require.Equal(t, stroll.Name, this.HabitTodos[1].Name)
		require.Equal(t, walk.Name, this.HabitTodos[1].Habit)
		require.Equal(t, v1pb.WeekHabitTodo_FAILED, this.HabitTodos[1].State)

		last := response.Weeks[1]
		require.Equal(t, "2026-10-12", last.WeekStart)
		require.False(t, last.ContainsDate)
		require.Zero(t, last.DaysLeft)
		require.Equal(t, "2026-10-01", last.Plan.EffectiveDate)
		require.Empty(t, last.Plan.Replaced)
		require.Len(t, last.Habits, 2)
		require.Equal(t, goal(3), last.Habits[0].WeeklyGoal)
		require.Equal(t, int32(2), last.Habits[0].CheckInCount)
		require.Equal(t, []string{"2026-10-13", "2026-10-15"}, []string{last.Habits[0].CheckIns[0].Date, last.Habits[0].CheckIns[1].Date})
		require.Equal(t, goal(2), last.Habits[1].WeeklyGoal)
		require.Equal(t, int32(1), last.Habits[1].CheckInCount)
	})

	t.Run("the same days split from Sunday", func(t *testing.T) {
		setWeekStart(7)
		response := progress("2026-10-24", 2)
		require.Equal(t, int32(7), response.WeekStartDay)
		this := response.Weeks[0]
		require.Equal(t, "2026-10-18", this.WeekStart)
		require.Equal(t, "2026-10-24", this.WeekEnd)
		require.Equal(t, int32(1), this.DaysLeft)
		// The failed todo is still active on its own day.
		require.Equal(t, v1pb.WeekHabitTodo_ACTIVE, this.HabitTodos[1].State)
		require.Equal(t, "2026-10-21", this.Plan.EffectiveDate)
		require.Equal(t, int32(1), this.Habits[0].CheckInCount)

		last := response.Weeks[1]
		require.Equal(t, "2026-10-11", last.WeekStart)
		require.Equal(t, "2026-10-17", last.WeekEnd)
		require.Equal(t, int32(2), last.Habits[0].CheckInCount)

		// Saturday is the instance's other common choice: Saturday 10-24 starts a week of its own.
		setWeekStart(6)
		this = progress("2026-10-24", 1).Weeks[0]
		require.Equal(t, "2026-10-24", this.WeekStart)
		require.Equal(t, "2026-10-30", this.WeekEnd)
		require.Equal(t, int32(7), this.DaysLeft)
		require.Empty(t, this.Plan.Replaced)
	})
}
