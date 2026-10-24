package test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/server/auth"
	apiv1 "github.com/usememos/memos/server/router/api/v1"
	"github.com/usememos/memos/store"
)

// An exercise links its guide in the exercise library; see requirement §2.4.4 and ADR 0023.
func TestWorkoutExerciseDocs(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()
	user, err := ts.CreateRegularUser(ctx, "planner")
	require.NoError(t, err)
	other, err := ts.CreateRegularUser(ctx, "other")
	require.NoError(t, err)
	app := ts.CreateUserContext(ctx, user.ID)
	bot := auth.SetCredentialKindInContext(app, auth.CredentialKindPAT)
	ts.Service.Clock = func() time.Time { return time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC) }
	const today = "2026-10-24"

	gym, err := ts.Service.CreateHabit(app, &v1pb.CreateHabitRequest{Habit: &v1pb.Habit{Title: "💪"}})
	require.NoError(t, err)
	useHabits(t, ts, app, "2026-10-01", gym.Name)

	guide := func(ctx context.Context, title string) *v1pb.Memo {
		memo, err := ts.Service.CreateMemo(ctx, &v1pb.CreateMemoRequest{Memo: &v1pb.Memo{Content: "---\nkind: exercise\ngroup: 腿臀\n---\n# " + title}})
		require.NoError(t, err)
		return memo
	}
	hipThrust := guide(app, "臀推")
	row := guide(app, "单臂哑铃划船")
	theirs := guide(ts.CreateUserContext(ctx, other.ID), "别人的臀推")

	workout := func(exercises ...*v1pb.WorkoutExercise) *v1pb.Workout {
		return &v1pb.Workout{Exercises: exercises}
	}
	checkIn := func(ctx context.Context, date string, w *v1pb.Workout) (*v1pb.CheckIn, error) {
		return ts.Service.SetCheckIn(ctx, &v1pb.SetCheckInRequest{CheckIn: &v1pb.CheckIn{Habit: gym.Name, Date: date, Workout: w}})
	}
	plan := func(ctx context.Context, date string, w *v1pb.Workout) (*v1pb.SetPlannedWorkoutResponse, error) {
		return ts.Service.SetPlannedWorkout(ctx, &v1pb.SetPlannedWorkoutRequest{Habit: gym.Name, Date: date, LocalDate: today, Workout: w})
	}
	workouts := func(request *v1pb.ListWorkoutsRequest) []string {
		response, err := ts.Service.ListWorkouts(bot, request)
		require.NoError(t, err)
		dates := []string{}
		for _, c := range response.CheckIns {
			dates = append(dates, c.Date)
		}
		return dates
	}

	t.Run("a check-in's exercises keep their guide, whatever they are called", func(t *testing.T) {
		made, err := checkIn(bot, "2026-10-20", workout(
			&v1pb.WorkoutExercise{Name: "Hip thrust", Doc: hipThrust.Name, Reps: []int32{12}},
			&v1pb.WorkoutExercise{Name: "热身走路"},
		))
		require.NoError(t, err)
		require.Equal(t, hipThrust.Name, made.Workout.Exercises[0].Doc)
		require.Empty(t, made.Workout.Exercises[1].Doc)

		_, err = checkIn(bot, "2026-10-22", workout(&v1pb.WorkoutExercise{Name: "Bench hip thrust", Doc: hipThrust.Name}))
		require.NoError(t, err)
		_, err = checkIn(bot, "2026-10-23", workout(&v1pb.WorkoutExercise{Name: "One-arm dumbbell row", Doc: row.Name}))
		require.NoError(t, err)

		// Two names, one exercise: the doc finds both sessions; the name only finds the one written that way.
		require.Equal(t, []string{"2026-10-22", "2026-10-20"}, workouts(&v1pb.ListWorkoutsRequest{Doc: hipThrust.Name}))
		require.Equal(t, []string{"2026-10-22"}, workouts(&v1pb.ListWorkoutsRequest{Exercise: "bench"}))
		require.Empty(t, workouts(&v1pb.ListWorkoutsRequest{Doc: theirs.Name}))
		_, err = ts.Service.ListWorkouts(bot, &v1pb.ListWorkoutsRequest{Doc: "臀推"})
		requireCode(t, err, codes.InvalidArgument)

		// The week's progress carries it too.
		progress, err := ts.Service.GetWeekProgress(bot, &v1pb.GetWeekProgressRequest{Date: "2026-10-20"})
		require.NoError(t, err)
		found := false
		for _, habit := range progress.Weeks[0].Habits {
			for _, c := range habit.CheckIns {
				if c.Date == "2026-10-20" {
					found = c.Workout.Exercises[0].Doc == hipThrust.Name
				}
			}
		}
		require.True(t, found)
	})

	t.Run("a doc that is not the caller's own live document is refused", func(t *testing.T) {
		for _, doc := range []string{theirs.Name, "memos/nope", "臀推"} {
			_, err := checkIn(bot, "2026-10-21", workout(&v1pb.WorkoutExercise{Name: "臀推", Doc: doc}))
			requireCode(t, err, codes.InvalidArgument)
			_, err = plan(bot, "2026-10-26", workout(&v1pb.WorkoutExercise{Name: "臀推", Doc: doc}))
			requireCode(t, err, codes.InvalidArgument)
		}
		// Nothing was stored on the way.
		require.NotContains(t, workouts(&v1pb.ListWorkoutsRequest{}), "2026-10-21")
	})

	t.Run("a plan's exercises keep their guide, on both write paths", func(t *testing.T) {
		made, err := plan(bot, "2026-10-26", workout(&v1pb.WorkoutExercise{Name: "臀推", Doc: hipThrust.Name}))
		require.NoError(t, err)
		require.Equal(t, hipThrust.Name, made.Todo.PlannedWorkout.Exercises[0].Doc)

		updated, err := ts.Service.UpdateTodo(app, &v1pb.UpdateTodoRequest{
			Todo:       &v1pb.Todo{Name: made.Todo.Name, PlannedWorkout: workout(&v1pb.WorkoutExercise{Name: "划船", Doc: row.Name})},
			UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"planned_workout"}},
			LocalDate:  today,
		})
		require.NoError(t, err)
		require.Equal(t, row.Name, updated.PlannedWorkout.Exercises[0].Doc)

		_, err = ts.Service.UpdateTodo(app, &v1pb.UpdateTodoRequest{
			Todo:       &v1pb.Todo{Name: made.Todo.Name, PlannedWorkout: workout(&v1pb.WorkoutExercise{Name: "划船", Doc: theirs.Name})},
			UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"planned_workout"}},
			LocalDate:  today,
		})
		requireCode(t, err, codes.InvalidArgument)
	})

	t.Run("an archived guide is refused when new, kept where it already was", func(t *testing.T) {
		old := guide(app, "老动作")
		_, err := checkIn(bot, "2026-10-25", workout(&v1pb.WorkoutExercise{Name: "老动作", Doc: old.Name}))
		require.NoError(t, err)

		uid, err := apiv1.ExtractMemoUIDFromName(old.Name)
		require.NoError(t, err)
		memo, err := ts.Store.GetMemo(ctx, &store.FindMemo{UID: &uid})
		require.NoError(t, err)
		archived := store.Archived
		require.NoError(t, ts.Store.UpdateMemo(ctx, &store.UpdateMemo{ID: memo.ID, RowStatus: &archived}))

		// Still read back as it was stored.
		require.Equal(t, []string{"2026-10-25"}, workouts(&v1pb.ListWorkoutsRequest{Doc: old.Name}))
		// Resending the workout with another exercise changed does not fail on the archived guide.
		again, err := checkIn(bot, "2026-10-25", workout(
			&v1pb.WorkoutExercise{Name: "老动作", Doc: old.Name, Reps: []int32{10}},
			&v1pb.WorkoutExercise{Name: "臀推", Doc: hipThrust.Name},
		))
		require.NoError(t, err)
		require.Equal(t, old.Name, again.Workout.Exercises[0].Doc)
		// But it cannot be linked anywhere new.
		_, err = checkIn(bot, "2026-10-24", workout(&v1pb.WorkoutExercise{Name: "老动作", Doc: old.Name}))
		requireCode(t, err, codes.InvalidArgument)
	})
}
