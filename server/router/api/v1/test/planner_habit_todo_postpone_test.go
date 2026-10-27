package test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
)

// A habit todo can be postponed, missed or not, to a day that could take a new one; completing it checks in there.
func TestPostponeHabitTodo(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()
	user, err := ts.CreateRegularUser(ctx, "planner")
	require.NoError(t, err)
	app := ts.CreateUserContext(ctx, user.ID)

	gym, err := ts.Service.CreateHabit(app, &v1pb.CreateHabitRequest{Habit: &v1pb.Habit{Title: "💪"}})
	require.NoError(t, err)
	useHabits(t, ts, app, "2026-10-01", gym.Name)

	newTodo := func(date string) *v1pb.Todo {
		todo, err := ts.Service.CreateTodo(app, &v1pb.CreateTodoRequest{
			Todo: &v1pb.Todo{Title: "💪 练腿", Date: date, Habit: gym.Name}, LocalDate: date,
		})
		require.NoError(t, err)
		return todo
	}
	postpone := func(todo *v1pb.Todo, date, local string) (*v1pb.Todo, error) {
		return ts.Service.PostponeTodo(app, &v1pb.PostponeTodoRequest{Name: todo.Name, Date: date, LocalDate: local})
	}

	// Missed on the 20th, moved on the 21st to that day: the original date is kept and it is done there.
	missed := newTodo("2026-10-20")
	moved, err := postpone(missed, "2026-10-21", "2026-10-21")
	require.NoError(t, err)
	require.Equal(t, "2026-10-21", moved.Date)
	require.Equal(t, "2026-10-20", moved.OriginalDate)
	require.Equal(t, int32(1), moved.PostponeCount)

	moved.Status = v1pb.Todo_DONE
	_, err = ts.Service.UpdateTodo(app, &v1pb.UpdateTodoRequest{Todo: moved, UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"status"}}, LocalDate: "2026-10-21"})
	require.NoError(t, err)
	entries, err := ts.Service.ListPlannerEntries(app, &v1pb.ListPlannerEntriesRequest{StartDate: "2026-10-20", EndDate: "2026-10-21"})
	require.NoError(t, err)
	require.Len(t, entries.CheckIns, 1)
	require.Equal(t, "2026-10-21", entries.CheckIns[0].Date)

	t.Run("not onto a day with the habit's todo or check-in, nor into the past", func(t *testing.T) {
		todo := newTodo("2026-10-22")
		newTodo("2026-10-23")
		_, err := postpone(todo, "2026-10-23", "2026-10-22")
		requireCode(t, err, codes.AlreadyExists)
		_, err = postpone(todo, "2026-10-21", "2026-10-22")
		requireCode(t, err, codes.InvalidArgument)
		_, err = postpone(todo, "2026-10-24", "2026-10-22")
		require.NoError(t, err)
	})
}
