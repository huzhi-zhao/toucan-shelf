package test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/server/auth"
)

func TestPlannedWorkouts(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()
	user, err := ts.CreateRegularUser(ctx, "planner")
	require.NoError(t, err)
	app := ts.CreateUserContext(ctx, user.ID)
	bot := auth.SetCredentialKindInContext(app, auth.CredentialKindPAT)
	const today = "2026-10-23"

	gym, err := ts.Service.CreateHabit(app, &v1pb.CreateHabitRequest{Habit: &v1pb.Habit{Title: "💪 健身"}})
	require.NoError(t, err)
	walk, err := ts.Service.CreateHabit(app, &v1pb.CreateHabitRequest{Habit: &v1pb.Habit{Title: "🚶"}})
	require.NoError(t, err)
	useHabits(t, ts, app, "2026-10-01", gym.Name, walk.Name)

	plan := func(names ...string) *v1pb.Workout {
		workout := &v1pb.Workout{}
		for _, name := range names {
			workout.Exercises = append(workout.Exercises, &v1pb.WorkoutExercise{Name: name, Reps: []int32{12, 12}})
		}
		return workout
	}
	set := func(ctx context.Context, habit, date string, workout *v1pb.Workout) (*v1pb.SetPlannedWorkoutResponse, error) {
		return ts.Service.SetPlannedWorkout(ctx, &v1pb.SetPlannedWorkoutRequest{Habit: habit, Date: date, LocalDate: today, Workout: workout})
	}
	deleteTodo := func(ctx context.Context, name string) error {
		_, err := ts.Service.DeleteTodo(ctx, &v1pb.DeleteTodoRequest{Name: name})
		return err
	}

	t.Run("the bot plans a day with no habit todo, making one", func(t *testing.T) {
		made, err := set(bot, gym.Name, "2026-10-24", plan("罗马尼亚硬拉", "臀推"))
		require.NoError(t, err)
		require.True(t, made.Created)
		require.Equal(t, "💪 健身", made.Todo.Title)
		require.Equal(t, gym.Name, made.Todo.Habit)
		require.Equal(t, v1pb.Todo_AGENT, made.Todo.Source)
		require.Equal(t, v1pb.Todo_AGENT, made.Todo.PlannedWorkoutSource)
		require.Len(t, made.Todo.PlannedWorkout.Exercises, 2)

		// Sending it again replaces the plan on the same todo: no second todo.
		again, err := set(bot, gym.Name, "2026-10-24", plan("深蹲"))
		require.NoError(t, err)
		require.False(t, again.Created)
		require.Equal(t, made.Todo.Name, again.Todo.Name)
		require.Equal(t, "深蹲", again.Todo.PlannedWorkout.Exercises[0].Name)

		// The week's progress carries the plan, for the bot to follow at the gym.
		progress, err := ts.Service.GetWeekProgress(bot, &v1pb.GetWeekProgressRequest{Date: today})
		require.NoError(t, err)
		require.Len(t, progress.Weeks[0].HabitTodos, 1)
		require.Equal(t, "深蹲", progress.Weeks[0].HabitTodos[0].PlannedWorkout.Exercises[0].Name)
		require.Equal(t, v1pb.Todo_AGENT, progress.Weeks[0].HabitTodos[0].Source)

		// The user changed their mind: the bot takes back the todo it made.
		require.NoError(t, deleteTodo(bot, made.Todo.Name))
	})

	t.Run("the bot plans the user's own habit todo but cannot delete it", func(t *testing.T) {
		own, err := ts.Service.CreateTodo(app, &v1pb.CreateTodoRequest{Todo: &v1pb.Todo{Title: "健身房", Date: "2026-10-25", Habit: gym.Name}, LocalDate: today})
		require.NoError(t, err)
		require.Equal(t, v1pb.Todo_MANUAL, own.Source)

		planned, err := set(bot, gym.Name, "2026-10-25", plan("臀推"))
		require.NoError(t, err)
		require.False(t, planned.Created)
		require.Equal(t, "健身房", planned.Todo.Title, "the bot leaves the title alone")
		require.Equal(t, v1pb.Todo_MANUAL, planned.Todo.Source)
		require.Equal(t, v1pb.Todo_AGENT, planned.Todo.PlannedWorkoutSource)
		requireCode(t, deleteTodo(bot, own.Name), codes.PermissionDenied)

		// The user edits the plan in the app: it becomes theirs.
		edited, err := ts.Service.UpdateTodo(app, &v1pb.UpdateTodoRequest{
			Todo:       &v1pb.Todo{Name: own.Name, PlannedWorkout: plan("臀推", "侧平板")},
			UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"planned_workout"}},
			LocalDate:  today,
		})
		require.NoError(t, err)
		require.Len(t, edited.PlannedWorkout.Exercises, 2)
		require.Equal(t, v1pb.Todo_MANUAL, edited.PlannedWorkoutSource)

		// An empty workout clears it, source and all.
		cleared, err := set(bot, gym.Name, "2026-10-25", &v1pb.Workout{})
		require.NoError(t, err)
		require.Nil(t, cleared.Todo.PlannedWorkout)
		require.Equal(t, v1pb.Todo_SOURCE_UNSPECIFIED, cleared.Todo.PlannedWorkoutSource)
		require.NoError(t, deleteTodo(app, own.Name))
	})

	t.Run("plans follow the habit todo rules", func(t *testing.T) {
		_, err := set(bot, gym.Name, "2026-10-22", plan("臀推"))
		requireCode(t, err, codes.InvalidArgument) // a day already past

		// Clearing a day with no todo makes nothing.
		none, err := set(bot, walk.Name, "2026-10-26", &v1pb.Workout{})
		require.NoError(t, err)
		require.Nil(t, none.Todo)
		require.False(t, none.Created)

		// A closed habit todo keeps its plan.
		todo, err := ts.Service.CreateTodo(app, &v1pb.CreateTodoRequest{Todo: &v1pb.Todo{Title: "走", Date: today, Habit: walk.Name}, LocalDate: today})
		require.NoError(t, err)
		_, err = ts.Service.UpdateTodo(app, &v1pb.UpdateTodoRequest{
			Todo:       &v1pb.Todo{Name: todo.Name, Status: v1pb.Todo_DONE},
			UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"status"}},
			LocalDate:  today,
		})
		require.NoError(t, err)
		_, err = set(bot, walk.Name, today, plan("快走"))
		requireCode(t, err, codes.FailedPrecondition)

		// A plain todo carries no plan.
		plain, err := ts.Service.CreateTodo(app, &v1pb.CreateTodoRequest{Todo: &v1pb.Todo{Title: "买菜", Date: today}})
		require.NoError(t, err)
		_, err = ts.Service.UpdateTodo(app, &v1pb.UpdateTodoRequest{
			Todo:       &v1pb.Todo{Name: plain.Name, PlannedWorkout: plan("x")},
			UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"planned_workout"}},
		})
		requireCode(t, err, codes.FailedPrecondition)

		// The workout limits are those of a check-in's workout.
		tooMany := plan()
		for range 31 {
			tooMany.Exercises = append(tooMany.Exercises, &v1pb.WorkoutExercise{Name: "x"})
		}
		_, err = set(bot, gym.Name, "2026-10-27", tooMany)
		requireCode(t, err, codes.InvalidArgument)
	})
}
