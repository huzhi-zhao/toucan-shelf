package test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/server/auth"
)

// A check-in is rated 1 to 5; a write that leaves the rating out keeps it, so callers that predate it lose nothing.
func TestCheckInRating(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()
	user, err := ts.CreateRegularUser(ctx, "planner")
	require.NoError(t, err)
	app := ts.CreateUserContext(ctx, user.ID)
	bot := auth.SetCredentialKindInContext(app, auth.CredentialKindPAT)
	ts.Service.Clock = func() time.Time { return time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC) }

	gym, err := ts.Service.CreateHabit(app, &v1pb.CreateHabitRequest{Habit: &v1pb.Habit{Title: "💪"}})
	require.NoError(t, err)
	useHabits(t, ts, app, "2026-10-01", gym.Name)

	set := func(ctx context.Context, date string, rating *int32) (*v1pb.CheckIn, error) {
		return ts.Service.SetCheckIn(ctx, &v1pb.SetCheckInRequest{CheckIn: &v1pb.CheckIn{
			Habit: gym.Name, Date: date, Note: "练了", Rating: rating,
			Workout: &v1pb.Workout{Exercises: []*v1pb.WorkoutExercise{{Name: "臀推"}}},
		}})
	}

	t.Run("set, kept when left out, cleared with 0", func(t *testing.T) {
		made, err := set(app, "2026-10-20", proto.Int32(4))
		require.NoError(t, err)
		require.Equal(t, int32(4), made.GetRating())

		kept, err := set(bot, "2026-10-20", nil)
		require.NoError(t, err)
		require.Equal(t, int32(4), kept.GetRating())

		cleared, err := set(app, "2026-10-20", proto.Int32(0))
		require.NoError(t, err)
		require.Equal(t, int32(0), cleared.GetRating())

		unrated, err := set(app, "2026-10-21", nil)
		require.NoError(t, err)
		require.Equal(t, int32(0), unrated.GetRating())
	})

	t.Run("out of range is refused", func(t *testing.T) {
		for _, rating := range []int32{-1, 6} {
			_, err := set(app, "2026-10-22", proto.Int32(rating))
			requireCode(t, err, codes.InvalidArgument)
		}
	})

	t.Run("an agent completing a habit todo rates its check-in", func(t *testing.T) {
		const day = "2026-10-28"
		_, err := ts.Service.SetPlannedWorkout(bot, &v1pb.SetPlannedWorkoutRequest{
			Habit: gym.Name, Date: day, LocalDate: day, Workout: &v1pb.Workout{Exercises: []*v1pb.WorkoutExercise{{Name: "臀推"}}},
		})
		require.NoError(t, err)
		made, err := set(bot, day, proto.Int32(5))
		require.NoError(t, err)
		require.NotEmpty(t, made.Todo)
		require.Equal(t, int32(5), made.GetRating())

		entries, err := ts.Service.ListPlannerEntries(app, &v1pb.ListPlannerEntriesRequest{StartDate: day, EndDate: day})
		require.NoError(t, err)
		require.Len(t, entries.CheckIns, 1)
		require.Equal(t, int32(5), entries.CheckIns[0].GetRating())
	})
}
