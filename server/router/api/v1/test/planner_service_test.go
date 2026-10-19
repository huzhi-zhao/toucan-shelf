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

	_, err = ts.Service.UpdateHabit(userCtx, &v1pb.UpdateHabitRequest{
		Habit:      &v1pb.Habit{Name: second.Name, Archived: true},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"archived"}},
	})
	require.NoError(t, err)
	_, err = ts.Service.SetCheckIn(userCtx, &v1pb.SetCheckInRequest{CheckIn: &v1pb.CheckIn{Habit: second.Name, Date: "2026-10-16"}})
	requireCode(t, err, codes.FailedPrecondition)

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
