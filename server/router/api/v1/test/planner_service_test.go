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

func TestPlannerRequiresAuthentication(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	_, err := ts.Service.ListOpenTodos(ctx, &v1pb.ListOpenTodosRequest{})
	requireCode(t, err, codes.Unauthenticated)
}

func TestPlannerHabitsAndCheckIns(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()
	user, err := ts.CreateRegularUser(ctx, "planner")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	first, err := ts.Service.CreateHabit(userCtx, &v1pb.CreateHabitRequest{Habit: &v1pb.Habit{Title: "🙏冥想"}})
	require.NoError(t, err)
	second, err := ts.Service.CreateHabit(userCtx, &v1pb.CreateHabitRequest{Habit: &v1pb.Habit{Title: "💪运动"}})
	require.NoError(t, err)
	require.Greater(t, second.Position, first.Position, "new habits go last")
	require.NotEqual(t, first.Color, second.Color, "a new habit gets a color of its own")
	useHabits(t, ts, userCtx, "2026-01-01", first.Name)

	_, err = ts.Service.SetCheckIn(userCtx, &v1pb.SetCheckInRequest{CheckIn: &v1pb.CheckIn{Habit: first.Name, Date: "2026-10-16", Note: "15"}})
	require.NoError(t, err)
	_, err = ts.Service.SetCheckIn(userCtx, &v1pb.SetCheckInRequest{CheckIn: &v1pb.CheckIn{Habit: first.Name, Date: "2026-10-16", Note: "20"}})
	require.NoError(t, err)

	entries, err := ts.Service.ListPlannerEntries(userCtx, &v1pb.ListPlannerEntriesRequest{StartDate: "2026-10-01", EndDate: "2026-10-31"})
	require.NoError(t, err)
	require.Len(t, entries.CheckIns, 1)
	require.Equal(t, first.Name, entries.CheckIns[0].Habit)
	require.Equal(t, "20", entries.CheckIns[0].Note)

	_, err = ts.Service.SetCheckIn(userCtx, &v1pb.SetCheckInRequest{CheckIn: &v1pb.CheckIn{Habit: first.Name, Date: "2026/10/16"}})
	requireCode(t, err, codes.InvalidArgument)

	// Only a habit in the day's version takes check-ins, and habits are no longer archived.
	_, err = ts.Service.SetCheckIn(userCtx, &v1pb.SetCheckInRequest{CheckIn: &v1pb.CheckIn{Habit: second.Name, Date: "2026-10-16"}})
	requireCode(t, err, codes.FailedPrecondition)
	_, err = ts.Service.UpdateHabit(userCtx, &v1pb.UpdateHabitRequest{
		Habit:      &v1pb.Habit{Name: second.Name},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"archived"}},
	})
	requireCode(t, err, codes.InvalidArgument)

	_, err = ts.Service.DeleteCheckIn(userCtx, &v1pb.DeleteCheckInRequest{Habit: first.Name, Date: "2026-10-16"})
	require.NoError(t, err)
	entries, err = ts.Service.ListPlannerEntries(userCtx, &v1pb.ListPlannerEntriesRequest{StartDate: "2026-10-01", EndDate: "2026-10-31"})
	require.NoError(t, err)
	require.Empty(t, entries.CheckIns)

	_, err = ts.Service.ListPlannerEntries(userCtx, &v1pb.ListPlannerEntriesRequest{StartDate: "2026-10-31", EndDate: "2026-10-01"})
	requireCode(t, err, codes.InvalidArgument)
}

func TestPlannerTodoStatusRules(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()
	user, err := ts.CreateRegularUser(ctx, "planner")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	statusMask := &fieldmaskpb.FieldMask{Paths: []string{"status"}}
	newTodo := func(date string) *v1pb.Todo {
		todo, err := ts.Service.CreateTodo(userCtx, &v1pb.CreateTodoRequest{Todo: &v1pb.Todo{Title: "作业", Date: date, Status: v1pb.Todo_DONE}})
		require.NoError(t, err)
		require.Equal(t, v1pb.Todo_ACTIVE, todo.Status, "a new todo is always active")
		return todo
	}

	t.Run("closing needs the caller's local date", func(t *testing.T) {
		todo := newTodo("2026-10-15")
		_, err := ts.Service.UpdateTodo(userCtx, &v1pb.UpdateTodoRequest{Todo: &v1pb.Todo{Name: todo.Name, Status: v1pb.Todo_DONE}, UpdateMask: statusMask})
		requireCode(t, err, codes.InvalidArgument)
	})

	t.Run("done on time and done late", func(t *testing.T) {
		onTime := newTodo("2026-10-17")
		done, err := ts.Service.UpdateTodo(userCtx, &v1pb.UpdateTodoRequest{
			Todo: &v1pb.Todo{Name: onTime.Name, Status: v1pb.Todo_DONE}, UpdateMask: statusMask, LocalDate: "2026-10-17",
		})
		require.NoError(t, err)
		require.Equal(t, v1pb.Todo_DONE, done.Status)
		require.False(t, done.ClosedOverdue)
		require.NotNil(t, done.CloseTime)

		late := newTodo("2026-10-15")
		done, err = ts.Service.UpdateTodo(userCtx, &v1pb.UpdateTodoRequest{
			Todo: &v1pb.Todo{Name: late.Name, Status: v1pb.Todo_DONE}, UpdateMask: statusMask, LocalDate: "2026-10-17",
		})
		require.NoError(t, err)
		require.True(t, done.ClosedOverdue)

		undated := newTodo("")
		done, err = ts.Service.UpdateTodo(userCtx, &v1pb.UpdateTodoRequest{
			Todo: &v1pb.Todo{Name: undated.Name, Status: v1pb.Todo_DONE}, UpdateMask: statusMask, LocalDate: "2026-10-17",
		})
		require.NoError(t, err)
		require.False(t, done.ClosedOverdue, "an undated todo is never overdue")
	})

	t.Run("cancelling needs a reason, reopening clears it", func(t *testing.T) {
		todo := newTodo("2026-10-10")
		_, err := ts.Service.UpdateTodo(userCtx, &v1pb.UpdateTodoRequest{
			Todo: &v1pb.Todo{Name: todo.Name, Status: v1pb.Todo_CANCELLED}, UpdateMask: statusMask, LocalDate: "2026-10-17",
		})
		requireCode(t, err, codes.InvalidArgument)

		cancelled, err := ts.Service.UpdateTodo(userCtx, &v1pb.UpdateTodoRequest{
			Todo:       &v1pb.Todo{Name: todo.Name, Status: v1pb.Todo_CANCELLED, CancelReason: "  不需要了  "},
			UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"status", "cancel_reason"}},
			LocalDate:  "2026-10-17",
		})
		require.NoError(t, err)
		require.Equal(t, "不需要了", cancelled.CancelReason)
		require.True(t, cancelled.ClosedOverdue)

		reopened, err := ts.Service.UpdateTodo(userCtx, &v1pb.UpdateTodoRequest{Todo: &v1pb.Todo{Name: todo.Name, Status: v1pb.Todo_ACTIVE}, UpdateMask: statusMask})
		require.NoError(t, err)
		require.Equal(t, v1pb.Todo_ACTIVE, reopened.Status)
		require.Empty(t, reopened.CancelReason)
		require.False(t, reopened.ClosedOverdue)
		require.Nil(t, reopened.CloseTime)

		_, err = ts.Service.UpdateTodo(userCtx, &v1pb.UpdateTodoRequest{
			Todo: &v1pb.Todo{Name: todo.Name, CancelReason: "x"}, UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"cancel_reason"}},
		})
		requireCode(t, err, codes.InvalidArgument)
	})

	t.Run("open list holds active todos only, undated last", func(t *testing.T) {
		open, err := ts.Service.ListOpenTodos(userCtx, &v1pb.ListOpenTodosRequest{})
		require.NoError(t, err)
		require.NotEmpty(t, open.Todos)
		for _, todo := range open.Todos {
			require.Equal(t, v1pb.Todo_ACTIVE, todo.Status)
		}
		newTodo("")
		open, err = ts.Service.ListOpenTodos(userCtx, &v1pb.ListOpenTodosRequest{})
		require.NoError(t, err)
		require.Empty(t, open.Todos[len(open.Todos)-1].Date)
	})

	t.Run("postponing keeps the original date and counts", func(t *testing.T) {
		todo := newTodo("2026-10-15")
		postpone := func(date string) (*v1pb.Todo, error) {
			return ts.Service.PostponeTodo(userCtx, &v1pb.PostponeTodoRequest{Name: todo.Name, Date: date, LocalDate: "2026-10-17"})
		}

		_, err := postpone("2026-10-16")
		requireCode(t, err, codes.InvalidArgument) // before today
		_, err = postpone("")
		requireCode(t, err, codes.InvalidArgument)

		moved, err := postpone("2026-10-18")
		require.NoError(t, err)
		require.Equal(t, "2026-10-18", moved.Date)
		require.Equal(t, "2026-10-15", moved.OriginalDate)
		require.Equal(t, int32(1), moved.PostponeCount)

		_, err = postpone("2026-10-18")
		requireCode(t, err, codes.InvalidArgument) // same date

		moved, err = postpone("2026-10-20")
		require.NoError(t, err)
		require.Equal(t, "2026-10-15", moved.OriginalDate, "the first date is kept")
		require.Equal(t, int32(2), moved.PostponeCount)

		// Correcting the date is not a postponement.
		fixed, err := ts.Service.UpdateTodo(userCtx, &v1pb.UpdateTodoRequest{
			Todo: &v1pb.Todo{Name: todo.Name, Date: "2026-10-21"}, UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"date"}},
		})
		require.NoError(t, err)
		require.Equal(t, int32(2), fixed.PostponeCount)

		undated := newTodo("")
		_, err = ts.Service.PostponeTodo(userCtx, &v1pb.PostponeTodoRequest{Name: undated.Name, Date: "2026-10-20", LocalDate: "2026-10-17"})
		requireCode(t, err, codes.FailedPrecondition)

		_, err = ts.Service.UpdateTodo(userCtx, &v1pb.UpdateTodoRequest{
			Todo: &v1pb.Todo{Name: todo.Name, Status: v1pb.Todo_DONE}, UpdateMask: statusMask, LocalDate: "2026-10-17",
		})
		require.NoError(t, err)
		_, err = postpone("2026-10-25")
		requireCode(t, err, codes.FailedPrecondition) // closed
	})
}

func TestPlannerTodoFields(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()
	user, err := ts.CreateRegularUser(ctx, "planner")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	_, err = ts.Service.CreateTodo(userCtx, &v1pb.CreateTodoRequest{Todo: &v1pb.Todo{Title: "x", Url: "javascript:alert(1)"}})
	requireCode(t, err, codes.InvalidArgument)
	_, err = ts.Service.CreateTodo(userCtx, &v1pb.CreateTodoRequest{Todo: &v1pb.Todo{Title: "x", Memo: "workspaces/abc"}})
	requireCode(t, err, codes.InvalidArgument)
	_, err = ts.Service.CreateTodo(userCtx, &v1pb.CreateTodoRequest{Todo: &v1pb.Todo{Title: "   "}})
	requireCode(t, err, codes.InvalidArgument)

	todo, err := ts.Service.CreateTodo(userCtx, &v1pb.CreateTodoRequest{Todo: &v1pb.Todo{Title: "读第三章", Date: "2026-10-20"}})
	require.NoError(t, err)
	updated, err := ts.Service.UpdateTodo(userCtx, &v1pb.UpdateTodoRequest{
		Todo: &v1pb.Todo{
			Name: todo.Name, Important: true, Tag: "学习", Note: "重点看例题",
			Memo: "memos/abc123", Url: "https://example.com/ch3",
		},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"important", "tag", "note", "memo", "url"}},
	})
	require.NoError(t, err)
	require.True(t, updated.Important)
	require.Equal(t, "学习", updated.Tag)
	require.Equal(t, "memos/abc123", updated.Memo)
	require.Equal(t, []string{"memos/abc123"}, updated.Memos, "the deprecated path sets the whole list")
	require.Equal(t, "https://example.com/ch3", updated.Url)
	require.Equal(t, "2026-10-20", updated.Date, "fields outside the mask stay")

	_, err = ts.Service.DeleteTodo(userCtx, &v1pb.DeleteTodoRequest{Name: todo.Name})
	require.NoError(t, err)
	_, err = ts.Service.GetTodo(userCtx, &v1pb.GetTodoRequest{Name: todo.Name})
	requireCode(t, err, codes.NotFound)
}

func TestTodoLinksSeveralDocuments(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()
	user, err := ts.CreateRegularUser(ctx, "planner")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	todo, err := ts.Service.CreateTodo(userCtx, &v1pb.CreateTodoRequest{Todo: &v1pb.Todo{Title: "x", Memos: []string{"memos/a", "memos/b"}}})
	require.NoError(t, err)
	require.Equal(t, []string{"memos/a", "memos/b"}, todo.Memos)
	require.Equal(t, "memos/a", todo.Memo, "the deprecated field reads the first")

	updated, err := ts.Service.UpdateTodo(userCtx, &v1pb.UpdateTodoRequest{
		Todo:       &v1pb.Todo{Name: todo.Name, Memos: []string{"memos/c", " ", "memos/a", "memos/c"}},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"memos"}},
	})
	require.NoError(t, err)
	require.Equal(t, []string{"memos/c", "memos/a"}, updated.Memos, "order kept, blanks and repeats dropped")

	fetched, err := ts.Service.GetTodo(userCtx, &v1pb.GetTodoRequest{Name: todo.Name})
	require.NoError(t, err)
	require.Equal(t, []string{"memos/c", "memos/a"}, fetched.Memos)

	cleared, err := ts.Service.UpdateTodo(userCtx, &v1pb.UpdateTodoRequest{
		Todo:       &v1pb.Todo{Name: todo.Name},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"memos"}},
	})
	require.NoError(t, err)
	require.Empty(t, cleared.Memos)
	require.Empty(t, cleared.Memo)

	_, err = ts.Service.UpdateTodo(userCtx, &v1pb.UpdateTodoRequest{
		Todo:       &v1pb.Todo{Name: todo.Name, Memos: []string{"memos/a", "workspaces/b"}},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"memos"}},
	})
	requireCode(t, err, codes.InvalidArgument)
}

func TestPlannerIsPerUser(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()
	owner, err := ts.CreateRegularUser(ctx, "owner")
	require.NoError(t, err)
	other, err := ts.CreateRegularUser(ctx, "other")
	require.NoError(t, err)
	ownerCtx := ts.CreateUserContext(ctx, owner.ID)
	otherCtx := ts.CreateUserContext(ctx, other.ID)

	habit, err := ts.Service.CreateHabit(ownerCtx, &v1pb.CreateHabitRequest{Habit: &v1pb.Habit{Title: "跑步"}})
	require.NoError(t, err)
	todo, err := ts.Service.CreateTodo(ownerCtx, &v1pb.CreateTodoRequest{Todo: &v1pb.Todo{Title: "私事"}})
	require.NoError(t, err)
	note, err := ts.Service.CreatePlannerNote(ownerCtx, &v1pb.CreatePlannerNoteRequest{Note: &v1pb.PlannerNote{Date: "2026-10-01", Content: "记一笔"}})
	require.NoError(t, err)

	_, err = ts.Service.GetTodo(otherCtx, &v1pb.GetTodoRequest{Name: todo.Name})
	requireCode(t, err, codes.NotFound)
	_, err = ts.Service.DeleteTodo(otherCtx, &v1pb.DeleteTodoRequest{Name: todo.Name})
	requireCode(t, err, codes.NotFound)
	_, err = ts.Service.SetCheckIn(otherCtx, &v1pb.SetCheckInRequest{CheckIn: &v1pb.CheckIn{Habit: habit.Name, Date: "2026-10-01"}})
	requireCode(t, err, codes.NotFound)
	_, err = ts.Service.DeletePlannerNote(otherCtx, &v1pb.DeletePlannerNoteRequest{Name: note.Name})
	requireCode(t, err, codes.NotFound)

	habits, err := ts.Service.ListHabits(otherCtx, &v1pb.ListHabitsRequest{})
	require.NoError(t, err)
	require.Empty(t, habits.Habits)
	open, err := ts.Service.ListOpenTodos(otherCtx, &v1pb.ListOpenTodosRequest{})
	require.NoError(t, err)
	require.Empty(t, open.Todos)
	entries, err := ts.Service.ListPlannerEntries(otherCtx, &v1pb.ListPlannerEntriesRequest{StartDate: "2026-10-01", EndDate: "2026-10-31"})
	require.NoError(t, err)
	require.Empty(t, entries.Notes)
}

func TestPlannerImport(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()
	user, err := ts.CreateRegularUser(ctx, "planner")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	request := &v1pb.ImportPlannerRequest{
		Habits: []*v1pb.Habit{{Title: "🏃跑步"}, {Title: "🙏冥想"}},
		CheckIns: []*v1pb.ImportCheckIn{
			{HabitIndex: 0, Date: "2026-10-16", Note: "遗"},
			{HabitIndex: 1, Date: "2026-10-08", Note: "15"},
		},
		Todos: []*v1pb.ImportTodo{
			{Todo: &v1pb.Todo{Title: "AI theory作业", Date: "2026-10-17", Status: v1pb.Todo_ACTIVE}},
			{Todo: &v1pb.Todo{Title: "两个作业", Date: "2026-07-19", Status: v1pb.Todo_DONE}},
			{Todo: &v1pb.Todo{Title: "写报告", Date: "2026-08-02", Status: v1pb.Todo_CANCELLED, CancelReason: "迁移时关闭", Important: true}, ClosedOverdue: true},
		},
		Notes: []*v1pb.PlannerNote{{Date: "2026-10-01", Content: "记一笔"}},
	}

	t.Run("a cancelled todo needs a reason", func(t *testing.T) {
		bad := &v1pb.ImportPlannerRequest{Todos: []*v1pb.ImportTodo{{Todo: &v1pb.Todo{Title: "x", Date: "2026-08-02", Status: v1pb.Todo_CANCELLED}}}}
		_, err := ts.Service.ImportPlanner(userCtx, bad)
		requireCode(t, err, codes.InvalidArgument)
	})

	t.Run("a habit checked in twice on a day is refused", func(t *testing.T) {
		bad := &v1pb.ImportPlannerRequest{
			Habits:   []*v1pb.Habit{{Title: "x"}},
			CheckIns: []*v1pb.ImportCheckIn{{HabitIndex: 0, Date: "2026-10-01"}, {HabitIndex: 0, Date: "2026-10-01"}},
		}
		_, err := ts.Service.ImportPlanner(userCtx, bad)
		requireCode(t, err, codes.InvalidArgument)
	})

	response, err := ts.Service.ImportPlanner(userCtx, request)
	require.NoError(t, err)
	require.Equal(t, int32(2), response.HabitCount)
	require.Equal(t, int32(2), response.CheckInCount)
	require.Equal(t, int32(3), response.TodoCount)
	require.Equal(t, int32(1), response.NoteCount)

	// The imported habits are in use from the very beginning, each in its own color.
	versions, err := ts.Service.ListHabitVersions(userCtx, &v1pb.ListHabitVersionsRequest{})
	require.NoError(t, err)
	require.Len(t, versions.Versions, 1)
	require.Empty(t, versions.Versions[0].EffectiveDate)
	require.Len(t, versions.Versions[0].Entries, 2)
	habits, err := ts.Service.ListHabits(userCtx, &v1pb.ListHabitsRequest{})
	require.NoError(t, err)
	require.NotEqual(t, habits.Habits[0].Color, habits.Habits[1].Color)

	entries, err := ts.Service.ListPlannerEntries(userCtx, &v1pb.ListPlannerEntriesRequest{StartDate: "2026-07-01", EndDate: "2026-10-31"})
	require.NoError(t, err)
	require.Len(t, entries.CheckIns, 2)
	require.Len(t, entries.Todos, 3)
	for _, todo := range entries.Todos {
		if todo.Status == v1pb.Todo_CANCELLED {
			require.True(t, todo.ClosedOverdue)
			require.True(t, todo.Important)
			require.Equal(t, "迁移时关闭", todo.CancelReason)
		}
	}

	_, err = ts.Service.ImportPlanner(userCtx, request)
	requireCode(t, err, codes.FailedPrecondition)
}

func TestPlannerTodoTags(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()
	user, err := ts.CreateRegularUser(ctx, "planner")
	require.NoError(t, err)
	other, err := ts.CreateRegularUser(ctx, "other")
	require.NoError(t, err)
	userCtx, otherCtx := ts.CreateUserContext(ctx, user.ID), ts.CreateUserContext(ctx, other.ID)

	_, err = ts.Service.ListTodoTags(ctx, &v1pb.ListTodoTagsRequest{})
	requireCode(t, err, codes.Unauthenticated)

	for _, tag := range []string{"学业", "工作", "学业", ""} {
		_, err := ts.Service.CreateTodo(userCtx, &v1pb.CreateTodoRequest{Todo: &v1pb.Todo{Title: "x", Tag: tag}})
		require.NoError(t, err)
	}
	tags, err := ts.Service.ListTodoTags(userCtx, &v1pb.ListTodoTagsRequest{})
	require.NoError(t, err)
	require.ElementsMatch(t, []string{"学业", "工作"}, tags.Tags)

	tags, err = ts.Service.ListTodoTags(otherCtx, &v1pb.ListTodoTagsRequest{})
	require.NoError(t, err)
	require.Empty(t, tags.Tags)
}

func TestPlannerNoFutureCheckIns(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()
	user, err := ts.CreateRegularUser(ctx, "planner")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)
	habit, err := ts.Service.CreateHabit(userCtx, &v1pb.CreateHabitRequest{Habit: &v1pb.Habit{Title: "冥想"}})
	require.NoError(t, err)
	useHabits(t, ts, userCtx, "2026-01-01", habit.Name)

	// Noon UTC on the 17th: UTC+14 is already on the 18th, nowhere has reached the 19th.
	ts.Service.Clock = func() time.Time { return time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC) }
	checkIn := func(date string) error {
		_, err := ts.Service.SetCheckIn(userCtx, &v1pb.SetCheckInRequest{CheckIn: &v1pb.CheckIn{Habit: habit.Name, Date: date}})
		return err
	}
	require.NoError(t, checkIn("2026-10-17"))
	require.NoError(t, checkIn("2026-10-18"))
	requireCode(t, checkIn("2026-10-19"), codes.InvalidArgument)
}

// useHabits sets the habit version taking effect on date, as if set that very day.
func useHabits(t *testing.T, ts *TestService, ctx context.Context, date string, habits ...string) *v1pb.HabitVersion {
	t.Helper()
	version, err := ts.Service.SetHabitVersion(ctx, &v1pb.SetHabitVersionRequest{Version: habitVersion(date, habits...), LocalDate: date})
	require.NoError(t, err)
	return version
}

func habitVersion(date string, habits ...string) *v1pb.HabitVersion {
	version := &v1pb.HabitVersion{EffectiveDate: date}
	for _, habit := range habits {
		version.Entries = append(version.Entries, &v1pb.HabitVersionEntry{Habit: habit})
	}
	return version
}

func TestHabitVersions(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()
	user, err := ts.CreateRegularUser(ctx, "planner")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)
	ts.Service.Clock = func() time.Time { return time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC) }
	const today = "2026-10-18"

	habits := make([]*v1pb.Habit, 7)
	names := make([]string, 7)
	for i := range habits {
		habits[i], err = ts.Service.CreateHabit(userCtx, &v1pb.CreateHabitRequest{Habit: &v1pb.Habit{Title: string(rune('a' + i))}})
		require.NoError(t, err)
		names[i] = habits[i].Name
	}
	set := func(version *v1pb.HabitVersion, unlink bool) (*v1pb.HabitVersion, error) {
		return ts.Service.SetHabitVersion(userCtx, &v1pb.SetHabitVersionRequest{Version: version, LocalDate: today, UnlinkTodos: unlink})
	}

	t.Run("a version is checked", func(t *testing.T) {
		_, err := set(habitVersion("2026-10-17", names[0]), false)
		requireCode(t, err, codes.InvalidArgument) // takes effect in the past
		_, err = set(habitVersion("", names[0]), false)
		requireCode(t, err, codes.InvalidArgument)
		_, err = set(habitVersion(today, names[:6]...), false)
		requireCode(t, err, codes.InvalidArgument) // more than five
		_, err = set(habitVersion(today, names[0], names[0]), false)
		requireCode(t, err, codes.InvalidArgument)
		goal := habitVersion(today, names[0])
		goal.Entries[0].WeeklyGoal = 8
		_, err = set(goal, false)
		requireCode(t, err, codes.InvalidArgument)
	})

	// The first eight habits get the eight colors, so habits 0..6 differ.
	version := habitVersion(today, names[0], names[1])
	version.Entries[1].WeeklyGoal = 3
	saved, err := set(version, false)
	require.NoError(t, err)
	require.Equal(t, int32(3), saved.Entries[1].WeeklyGoal)

	// Two habits of the same color cannot share a version, nor can a habit take a color its versions use.
	_, err = ts.Service.UpdateHabit(userCtx, &v1pb.UpdateHabitRequest{
		Habit: &v1pb.Habit{Name: names[1], Color: habits[0].Color}, UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"color"}},
	})
	requireCode(t, err, codes.FailedPrecondition)
	recolored, err := ts.Service.UpdateHabit(userCtx, &v1pb.UpdateHabitRequest{
		Habit: &v1pb.Habit{Name: names[6], Color: habits[0].Color}, UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"color"}},
	})
	require.NoError(t, err)
	require.Equal(t, habits[0].Color, recolored.Color)
	_, err = set(habitVersion("2026-10-25", names[0], names[6]), false)
	requireCode(t, err, codes.InvalidArgument)

	// A new habit takes a color the latest version does not use.
	fresh, err := ts.Service.CreateHabit(userCtx, &v1pb.CreateHabitRequest{Habit: &v1pb.Habit{Title: "new"}})
	require.NoError(t, err)
	require.NotEqual(t, habits[0].Color, fresh.Color)
	require.NotEqual(t, habits[1].Color, fresh.Color)

	// A habit todo on the 22nd for habit 1, then a version from the 20th without it.
	todo, err := ts.Service.CreateTodo(userCtx, &v1pb.CreateTodoRequest{Todo: &v1pb.Todo{Title: "b", Date: "2026-10-22", Habit: names[1]}, LocalDate: today})
	require.NoError(t, err)
	_, err = set(habitVersion("2026-10-20", names[0]), false)
	requireCode(t, err, codes.FailedPrecondition)
	_, err = set(habitVersion("2026-10-20", names[0]), true)
	require.NoError(t, err)
	unlinked, err := ts.Service.GetTodo(userCtx, &v1pb.GetTodoRequest{Name: todo.Name})
	require.NoError(t, err)
	require.Empty(t, unlinked.Habit, "the todo became a plain one")

	// Setting the same date again replaces that version.
	_, err = set(habitVersion("2026-10-20", names[2], names[0]), false)
	require.NoError(t, err)
	list, err := ts.Service.ListHabitVersions(userCtx, &v1pb.ListHabitVersionsRequest{})
	require.NoError(t, err)
	require.Len(t, list.Versions, 2)
	require.Equal(t, today, list.Versions[0].EffectiveDate)
	require.Equal(t, "2026-10-20", list.Versions[1].EffectiveDate)
	require.Equal(t, names[2], list.Versions[1].Entries[0].Habit, "entries keep their order")

	// A version in effect stays; one to come can go, unless its habit todos rely on it.
	_, err = ts.Service.DeleteHabitVersion(userCtx, &v1pb.DeleteHabitVersionRequest{EffectiveDate: today, LocalDate: today})
	requireCode(t, err, codes.FailedPrecondition)
	_, err = ts.Service.CreateTodo(userCtx, &v1pb.CreateTodoRequest{Todo: &v1pb.Todo{Title: "c", Date: "2026-10-21", Habit: names[2]}, LocalDate: today})
	require.NoError(t, err)
	_, err = ts.Service.DeleteHabitVersion(userCtx, &v1pb.DeleteHabitVersionRequest{EffectiveDate: "2026-10-20", LocalDate: today})
	requireCode(t, err, codes.FailedPrecondition)
	_, err = set(habitVersion("2026-10-20", names[0], names[2]), false)
	require.NoError(t, err)
	_, err = set(habitVersion("2026-10-23", names[0]), true)
	require.NoError(t, err)
	_, err = ts.Service.DeleteHabitVersion(userCtx, &v1pb.DeleteHabitVersionRequest{EffectiveDate: "2026-10-23", LocalDate: today})
	require.NoError(t, err)
	list, err = ts.Service.ListHabitVersions(userCtx, &v1pb.ListHabitVersionsRequest{})
	require.NoError(t, err)
	require.Len(t, list.Versions, 2)
}

func TestHabitTodos(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()
	user, err := ts.CreateRegularUser(ctx, "planner")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)
	const today = "2026-10-18"
	// The server's clock runs ahead, so that check-ins in the days below are not refused as future ones.
	ts.Service.Clock = func() time.Time { return time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC) }

	run, err := ts.Service.CreateHabit(userCtx, &v1pb.CreateHabitRequest{Habit: &v1pb.Habit{Title: "💪运动"}})
	require.NoError(t, err)
	read, err := ts.Service.CreateHabit(userCtx, &v1pb.CreateHabitRequest{Habit: &v1pb.Habit{Title: "📖阅读"}})
	require.NoError(t, err)
	idle, err := ts.Service.CreateHabit(userCtx, &v1pb.CreateHabitRequest{Habit: &v1pb.Habit{Title: "😴"}})
	require.NoError(t, err)
	useHabits(t, ts, userCtx, "2026-10-01", run.Name, read.Name)

	create := func(title, date, habit, localDate string) (*v1pb.Todo, error) {
		return ts.Service.CreateTodo(userCtx, &v1pb.CreateTodoRequest{Todo: &v1pb.Todo{Title: title, Date: date, Habit: habit}, LocalDate: localDate})
	}
	update := func(todo *v1pb.Todo, localDate string, paths ...string) (*v1pb.Todo, error) {
		return ts.Service.UpdateTodo(userCtx, &v1pb.UpdateTodoRequest{Todo: todo, UpdateMask: &fieldmaskpb.FieldMask{Paths: paths}, LocalDate: localDate})
	}
	complete := func(todo *v1pb.Todo, localDate string) (*v1pb.Todo, error) {
		return update(&v1pb.Todo{Name: todo.Name, Status: v1pb.Todo_DONE}, localDate, "status")
	}
	checkIns := func(date string) []*v1pb.CheckIn {
		entries, err := ts.Service.ListPlannerEntries(userCtx, &v1pb.ListPlannerEntriesRequest{StartDate: date, EndDate: date})
		require.NoError(t, err)
		return entries.CheckIns
	}

	t.Run("creating is checked", func(t *testing.T) {
		_, err := create("x", "2026-10-20", run.Name, "")
		requireCode(t, err, codes.InvalidArgument) // needs the caller's day
		_, err = create("x", "", run.Name, today)
		requireCode(t, err, codes.InvalidArgument) // needs a date
		_, err = create("x", "2026-10-17", run.Name, today)
		requireCode(t, err, codes.InvalidArgument) // not for the past
		_, err = create("x", "2026-10-20", idle.Name, today)
		requireCode(t, err, codes.FailedPrecondition) // not in use
	})

	tenK, err := create("跑 10 公里", "2026-10-20", run.Name, today)
	require.NoError(t, err)
	require.Equal(t, run.Name, tenK.Habit)
	_, err = create("跑 5 公里", "2026-10-20", run.Name, today)
	requireCode(t, err, codes.AlreadyExists) // one per habit per day

	// A habit todo keeps its day: no moving, no postponing, no completing ahead of it, no relinking.
	_, err = update(&v1pb.Todo{Name: tenK.Name, Date: "2026-10-21"}, today, "date")
	requireCode(t, err, codes.FailedPrecondition)
	_, err = ts.Service.PostponeTodo(userCtx, &v1pb.PostponeTodoRequest{Name: tenK.Name, Date: "2026-10-21", LocalDate: today})
	requireCode(t, err, codes.FailedPrecondition)
	_, err = complete(tenK, today)
	requireCode(t, err, codes.FailedPrecondition)
	_, err = update(&v1pb.Todo{Name: tenK.Name, Habit: read.Name}, today, "habit")
	requireCode(t, err, codes.InvalidArgument)

	// While it is open, the habit is checked in that day only by completing it.
	_, err = ts.Service.SetCheckIn(userCtx, &v1pb.SetCheckInRequest{CheckIn: &v1pb.CheckIn{Habit: run.Name, Date: "2026-10-20"}})
	requireCode(t, err, codes.FailedPrecondition)

	// Done on its day: checked in that day, noted with the title.
	done, err := complete(tenK, "2026-10-20")
	require.NoError(t, err)
	require.Equal(t, "2026-10-20", done.CheckInDate)
	made := checkIns("2026-10-20")
	require.Len(t, made, 1)
	require.Equal(t, "跑 10 公里", made[0].Note)
	require.Equal(t, tenK.Name, made[0].Todo)

	// Settled: no reopening or cancelling, its check-in is its own; deleting takes both.
	_, err = update(&v1pb.Todo{Name: tenK.Name, Status: v1pb.Todo_ACTIVE}, today, "status")
	requireCode(t, err, codes.FailedPrecondition)
	_, err = update(&v1pb.Todo{Name: tenK.Name, Status: v1pb.Todo_CANCELLED, CancelReason: "不跑了"}, today, "status", "cancel_reason")
	requireCode(t, err, codes.FailedPrecondition)
	_, err = ts.Service.DeleteCheckIn(userCtx, &v1pb.DeleteCheckInRequest{Habit: run.Name, Date: "2026-10-20"})
	requireCode(t, err, codes.FailedPrecondition)
	_, err = update(&v1pb.Todo{Name: tenK.Name, Note: "配速 6 分"}, today, "note")
	require.NoError(t, err)
	_, err = ts.Service.DeleteTodo(userCtx, &v1pb.DeleteTodoRequest{Name: tenK.Name})
	require.NoError(t, err)
	require.Empty(t, checkIns("2026-10-20"))

	// A habit already checked in that day takes no habit todo.
	_, err = ts.Service.SetCheckIn(userCtx, &v1pb.SetCheckInRequest{CheckIn: &v1pb.CheckIn{Habit: read.Name, Date: today}})
	require.NoError(t, err)
	_, err = create("读书", today, read.Name, today)
	requireCode(t, err, codes.FailedPrecondition)

	// Missed and done later: the backfill checks in on the todo's own day.
	late, err := create("读 30 页", "2026-10-19", read.Name, today)
	require.NoError(t, err)
	done, err = complete(late, "2026-10-21")
	require.NoError(t, err)
	require.Equal(t, "2026-10-19", done.CheckInDate)
	require.Len(t, checkIns("2026-10-19"), 1)

	// A habit dropped by a later version: the todo, unlinked when the version came, closes without a check-in.
	walk, err := create("散步", "2026-10-22", run.Name, today)
	require.NoError(t, err)
	_, err = ts.Service.SetHabitVersion(userCtx, &v1pb.SetHabitVersionRequest{
		Version: habitVersion("2026-10-21", read.Name), LocalDate: today, UnlinkTodos: true,
	})
	require.NoError(t, err)
	done, err = complete(walk, "2026-10-22")
	require.NoError(t, err)
	require.Empty(t, done.Habit)
	require.Empty(t, done.CheckInDate)
	_, err = ts.Service.SetCheckIn(userCtx, &v1pb.SetCheckInRequest{CheckIn: &v1pb.CheckIn{Habit: run.Name, Date: "2026-10-22"}})
	requireCode(t, err, codes.FailedPrecondition)
}
