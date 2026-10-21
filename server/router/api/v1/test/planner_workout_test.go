package test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/server/auth"
)

func TestWorkoutCheckIns(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()
	user, err := ts.CreateRegularUser(ctx, "planner")
	require.NoError(t, err)
	app := ts.CreateUserContext(ctx, user.ID)
	// The same user through a personal access token, as the bot calls.
	bot := auth.SetCredentialKindInContext(app, auth.CredentialKindPAT)
	// The server's clock runs ahead, so that check-ins in the days below are not refused as future ones.
	ts.Service.Clock = func() time.Time { return time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC) }

	gym, err := ts.Service.CreateHabit(app, &v1pb.CreateHabitRequest{Habit: &v1pb.Habit{Title: "💪"}})
	require.NoError(t, err)
	walk, err := ts.Service.CreateHabit(app, &v1pb.CreateHabitRequest{Habit: &v1pb.Habit{Title: "🚶"}})
	require.NoError(t, err)
	useHabits(t, ts, app, "2026-10-01", gym.Name, walk.Name)

	kg := func(v float64) *float64 { return &v }
	session := func(weight float64) *v1pb.Workout {
		return &v1pb.Workout{DurationMinutes: kg(30), Exercises: []*v1pb.WorkoutExercise{
			{Name: "跑步机", Equipment: "Spirit 跑步机", DurationMinutes: kg(5), Settings: "坡度 10，3.8–4 km/h"},
			{Name: "罗马尼亚硬拉", Equipment: "哑铃", WeightKg: kg(weight), Reps: []int32{15, 12, 12}},
		}}
	}
	set := func(ctx context.Context, habit, date, note string, workout *v1pb.Workout) (*v1pb.CheckIn, error) {
		return ts.Service.SetCheckIn(ctx, &v1pb.SetCheckInRequest{CheckIn: &v1pb.CheckIn{Habit: habit, Date: date, Note: note, Workout: workout}})
	}
	del := func(ctx context.Context, habit, date string) error {
		_, err := ts.Service.DeleteCheckIn(ctx, &v1pb.DeleteCheckInRequest{Habit: habit, Date: date})
		return err
	}
	dayCheckIns := func(date string) []*v1pb.CheckIn {
		entries, err := ts.Service.ListPlannerEntries(app, &v1pb.ListPlannerEntriesRequest{StartDate: date, EndDate: date})
		require.NoError(t, err)
		return entries.CheckIns
	}

	t.Run("the bot reports a session once, and again to retry or correct it", func(t *testing.T) {
		made, err := set(bot, gym.Name, "2026-10-20", "下肢", session(2.3))
		require.NoError(t, err)
		require.Equal(t, v1pb.CheckIn_AGENT, made.Source)
		require.Equal(t, 30.0, made.Workout.GetDurationMinutes())
		require.Len(t, made.Workout.Exercises, 2)
		require.Equal(t, []int32{15, 12, 12}, made.Workout.Exercises[1].Reps)
		require.Nil(t, made.Workout.Exercises[0].WeightKg)

		again, err := set(bot, gym.Name, "2026-10-20", "下肢", session(2.3))
		require.NoError(t, err)
		require.True(t, proto.Equal(made, again))
		require.Len(t, dayCheckIns("2026-10-20"), 1)

		corrected, err := set(bot, gym.Name, "2026-10-20", "下肢", session(4.5))
		require.NoError(t, err)
		require.Equal(t, 4.5, corrected.Workout.Exercises[1].GetWeightKg())

		// Without a workout the note changes and the workout stays; an empty one removes it.
		renamed, err := set(bot, gym.Name, "2026-10-20", "下肢 + 有氧", nil)
		require.NoError(t, err)
		require.Equal(t, "下肢 + 有氧", renamed.Note)
		require.Len(t, renamed.Workout.Exercises, 2)
		cleared, err := set(bot, gym.Name, "2026-10-20", "下肢 + 有氧", &v1pb.Workout{})
		require.NoError(t, err)
		require.Nil(t, cleared.Workout)

		require.NoError(t, del(bot, gym.Name, "2026-10-20"))
		require.Empty(t, dayCheckIns("2026-10-20"))
	})

	t.Run("the bot adds a workout to a check-in made in the app, and nothing else", func(t *testing.T) {
		manual, err := set(app, walk.Name, "2026-10-21", "走路", nil)
		require.NoError(t, err)
		require.Equal(t, v1pb.CheckIn_MANUAL, manual.Source)

		_, err = set(bot, walk.Name, "2026-10-21", "改掉", nil)
		requireCode(t, err, codes.FailedPrecondition)
		detailed, err := set(bot, walk.Name, "2026-10-21", "改掉", &v1pb.Workout{Exercises: []*v1pb.WorkoutExercise{{Name: "快走", DurationMinutes: kg(40)}}})
		require.NoError(t, err)
		require.Equal(t, "走路", detailed.Note) // the user's note stays
		require.Equal(t, v1pb.CheckIn_MANUAL, detailed.Source)
		require.Equal(t, "快走", detailed.Workout.Exercises[0].Name)

		err = del(bot, walk.Name, "2026-10-21")
		requireCode(t, err, codes.PermissionDenied)

		// The user changes and removes anything, including what the bot made.
		botMade, err := set(bot, gym.Name, "2026-10-21", "", session(2.3))
		require.NoError(t, err)
		edited, err := set(app, gym.Name, "2026-10-21", "其实练了上肢", session(3))
		require.NoError(t, err)
		require.Equal(t, v1pb.CheckIn_AGENT, edited.Source) // who made it does not change
		require.Equal(t, botMade.Habit, edited.Habit)
		require.NoError(t, del(app, gym.Name, "2026-10-21"))
		require.NoError(t, del(app, walk.Name, "2026-10-21"))
	})

	t.Run("the bot's session completes the habit todo due that day, and undoing it reopens the todo", func(t *testing.T) {
		todo, err := ts.Service.CreateTodo(app, &v1pb.CreateTodoRequest{Todo: &v1pb.Todo{Title: "练腿", Date: "2026-10-22", Habit: gym.Name}, LocalDate: "2026-10-22"})
		require.NoError(t, err)
		_, err = set(app, gym.Name, "2026-10-22", "", nil)
		requireCode(t, err, codes.FailedPrecondition) // in the app, the todo is ticked instead

		made, err := set(bot, gym.Name, "2026-10-22", "", session(2.3))
		require.NoError(t, err)
		require.Equal(t, todo.Name, made.Todo)
		require.Equal(t, v1pb.CheckIn_AGENT, made.Source)
		require.Equal(t, "练腿", made.Note)
		require.Len(t, made.Workout.Exercises, 2)
		done, err := ts.Service.GetTodo(app, &v1pb.GetTodoRequest{Name: todo.Name})
		require.NoError(t, err)
		require.Equal(t, v1pb.Todo_DONE, done.Status)
		require.Equal(t, "2026-10-22", done.CheckInDate)

		// The bot corrects its own todo check-in like any other.
		corrected, err := set(bot, gym.Name, "2026-10-22", "练腿，加了臀推", session(4.5))
		require.NoError(t, err)
		require.Equal(t, "练腿，加了臀推", corrected.Note)

		require.NoError(t, del(bot, gym.Name, "2026-10-22"))
		reopened, err := ts.Service.GetTodo(app, &v1pb.GetTodoRequest{Name: todo.Name})
		require.NoError(t, err)
		require.Equal(t, v1pb.Todo_ACTIVE, reopened.Status)
		require.Empty(t, reopened.CheckInDate)
		require.Nil(t, reopened.CloseTime)
		require.Empty(t, dayCheckIns("2026-10-22"))

		// Ticked in the app, it is the todo's; the bot may still add the workout, but not remove it.
		_, err = ts.Service.UpdateTodo(app, &v1pb.UpdateTodoRequest{
			Todo: &v1pb.Todo{Name: todo.Name, Status: v1pb.Todo_DONE}, UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"status"}}, LocalDate: "2026-10-22",
		})
		require.NoError(t, err)
		ticked := dayCheckIns("2026-10-22")[0]
		require.Equal(t, v1pb.CheckIn_TODO, ticked.Source)
		detailed, err := set(bot, gym.Name, "2026-10-22", "", session(2.3))
		require.NoError(t, err)
		require.Equal(t, "练腿", detailed.Note)
		require.Len(t, detailed.Workout.Exercises, 2)
		requireCode(t, del(bot, gym.Name, "2026-10-22"), codes.PermissionDenied)
		requireCode(t, del(app, gym.Name, "2026-10-22"), codes.FailedPrecondition)
		// And the app may add one to the todo's check-in too, keeping the todo's note.
		_, err = set(app, gym.Name, "2026-10-22", "", session(6))
		require.NoError(t, err)
	})

	t.Run("a todo completed through a token is the agent's", func(t *testing.T) {
		todo, err := ts.Service.CreateTodo(app, &v1pb.CreateTodoRequest{Todo: &v1pb.Todo{Title: "散步", Date: "2026-10-23", Habit: walk.Name}, LocalDate: "2026-10-23"})
		require.NoError(t, err)
		_, err = ts.Service.UpdateTodo(bot, &v1pb.UpdateTodoRequest{
			Todo: &v1pb.Todo{Name: todo.Name, Status: v1pb.Todo_DONE}, UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"status"}}, LocalDate: "2026-10-23",
		})
		require.NoError(t, err)
		require.Equal(t, v1pb.CheckIn_AGENT, dayCheckIns("2026-10-23")[0].Source)
	})

	t.Run("workouts are checked", func(t *testing.T) {
		for _, workout := range []*v1pb.Workout{
			{Exercises: []*v1pb.WorkoutExercise{{Name: " "}}},
			{Exercises: []*v1pb.WorkoutExercise{{Name: "臀推", WeightKg: kg(-1)}}},
			{Exercises: []*v1pb.WorkoutExercise{{Name: "臀推", Reps: []int32{15, -1}}}},
			{DurationMinutes: kg(24*60 + 1)},
			{Exercises: make([]*v1pb.WorkoutExercise, 31)},
		} {
			for i := range workout.Exercises {
				if workout.Exercises[i] == nil {
					workout.Exercises[i] = &v1pb.WorkoutExercise{Name: "x"}
				}
			}
			_, err := set(bot, gym.Name, "2026-10-24", "", workout)
			requireCode(t, err, codes.InvalidArgument)
		}
		_, err := set(bot, gym.Name, "2026-11-02", "", session(2.3))
		requireCode(t, err, codes.InvalidArgument) // not ahead of time
	})

	t.Run("listing workouts", func(t *testing.T) {
		for _, day := range []struct {
			habit, date string
			workout     *v1pb.Workout
		}{
			{gym.Name, "2026-10-25", session(5)},
			{gym.Name, "2026-10-27", &v1pb.Workout{Exercises: []*v1pb.WorkoutExercise{{Name: "臀推", WeightKg: kg(6.8), Reps: []int32{15, 15, 15}}}}},
			{walk.Name, "2026-10-27", &v1pb.Workout{Exercises: []*v1pb.WorkoutExercise{{Name: "滑冰", DurationMinutes: kg(45)}}}},
			{walk.Name, "2026-10-26", nil},
		} {
			_, err := set(bot, day.habit, day.date, "", day.workout)
			require.NoError(t, err)
		}
		list := func(request *v1pb.ListWorkoutsRequest) []string {
			t.Helper()
			response, err := ts.Service.ListWorkouts(bot, request)
			require.NoError(t, err)
			lines := []string{}
			for _, checkIn := range response.CheckIns {
				lines = append(lines, checkIn.Date+" "+checkIn.Workout.Exercises[0].Name)
			}
			return lines
		}
		// Newest first (on one day, the later recorded first), only check-ins with a workout (10-26 has none).
		require.Equal(t, []string{"2026-10-27 滑冰", "2026-10-27 臀推", "2026-10-25 跑步机", "2026-10-22 跑步机"},
			list(&v1pb.ListWorkoutsRequest{StartDate: "2026-10-22"}))
		// The last times of one exercise, matched in any position, ignoring case.
		require.Equal(t, []string{"2026-10-25 跑步机"}, list(&v1pb.ListWorkoutsRequest{Exercise: "硬拉", Limit: 1}))
		require.Equal(t, []string{"2026-10-27 滑冰"}, list(&v1pb.ListWorkoutsRequest{Habit: walk.Name}))
		require.Equal(t, []string{"2026-10-25 跑步机", "2026-10-22 跑步机"}, list(&v1pb.ListWorkoutsRequest{StartDate: "2026-10-20", EndDate: "2026-10-25"}))

		_, err := ts.Service.ListWorkouts(bot, &v1pb.ListWorkoutsRequest{Limit: 201})
		requireCode(t, err, codes.InvalidArgument)
		_, err = ts.Service.ListWorkouts(bot, &v1pb.ListWorkoutsRequest{StartDate: "2026-10-25", EndDate: "2026-10-20"})
		requireCode(t, err, codes.InvalidArgument)
		_, err = ts.Service.ListWorkouts(ctx, &v1pb.ListWorkoutsRequest{})
		requireCode(t, err, codes.Unauthenticated)
	})

	t.Run("the week's progress carries who checked in and the workout", func(t *testing.T) {
		response, err := ts.Service.GetWeekProgress(bot, &v1pb.GetWeekProgressRequest{Date: "2026-10-27"})
		require.NoError(t, err)
		var gymWeek *v1pb.WeekHabitProgress
		for _, habit := range response.Weeks[0].Habits {
			if habit.Habit == gym.Name {
				gymWeek = habit
			}
		}
		require.NotNil(t, gymWeek)
		last := gymWeek.CheckIns[len(gymWeek.CheckIns)-1]
		require.Equal(t, "2026-10-27", last.Date)
		require.Equal(t, v1pb.CheckIn_AGENT, last.Source)
		require.Equal(t, 6.8, last.Workout.Exercises[0].GetWeightKg())
	})
}
