package v1

import (
	"context"
	"math"
	"strconv"
	"strings"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/store"
)

// Workouts hang on check-ins: one session of a habit on a day is one check-in, and its exercises are the
// check-in's workout. A bot that coaches the session reports it once it is over, with a personal access
// token, and checks in as an agent. See planner-and-check-in.md §2.4.4 and ADR 0021.

// Generous caps that reject junk without constraining a real session.
const (
	plannerMaxExercises        = 30
	plannerMaxSets             = 30
	plannerMaxReps             = 1000
	plannerMaxWeightKg         = 1000
	plannerMaxWorkoutMinutes   = 24 * 60
	plannerMaxExerciseTextSize = 200
	plannerDefaultWorkouts     = 50
	plannerMaxWorkouts         = 200
)

// plannerAgent reports whether the caller is an agent: one with a personal access token (a bot, or an MCP
// session) rather than the app's login session. It is decided from the credential, so a caller cannot claim it.
func plannerAgent(ctx context.Context) bool {
	kind := auth.GetCredentialKind(ctx)
	return kind == auth.CredentialKindPAT || kind == auth.CredentialKindMCP
}

// plannerCheckInSourceFor is the source of a check-in the caller makes by hand (not by completing a todo).
func plannerCheckInSourceFor(ctx context.Context) string {
	if plannerAgent(ctx) {
		return store.PlannerCheckInAgent
	}
	return store.PlannerCheckInManual
}

// checkInOn returns the habit's check-in on date, or nil.
func (s *APIV1Service) checkInOn(ctx context.Context, user *store.User, habitID int32, date string) (*store.PlannerCheckIn, error) {
	existing, err := s.Store.ListPlannerCheckIns(ctx, &store.FindPlannerCheckIn{CreatorID: user.ID, HabitID: &habitID, StartDate: date, EndDate: date})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get check-in: %v", err)
	}
	if len(existing) == 0 {
		return nil, nil
	}
	return existing[0], nil
}

// plannerWorkoutFromRequest checks a workout from a request. An empty one (no length, no exercises) is nil:
// sending it removes the workout a check-in had. kept is the workout stored where this one goes, or nil; the
// exercise guides it already links are accepted as they are (see checkExerciseDoc).
func (s *APIV1Service) plannerWorkoutFromRequest(ctx context.Context, user *store.User, workout *v1pb.Workout, kept *store.PlannerWorkout) (*store.PlannerWorkout, error) {
	if workout == nil || (workout.DurationMinutes == nil && len(workout.Exercises) == 0) {
		return nil, nil
	}
	if len(workout.Exercises) > plannerMaxExercises {
		return nil, status.Errorf(codes.InvalidArgument, "a workout has at most %d exercises", plannerMaxExercises)
	}
	// Guides already known to be fine: the ones the stored workout links, then each one checked here.
	docs := map[string]bool{}
	if kept != nil {
		for _, e := range kept.Exercises {
			if e.DocUID != "" {
				docs[e.DocUID] = true
			}
		}
	}
	result := &store.PlannerWorkout{Exercises: []store.PlannerExercise{}}
	var err error
	if result.DurationMinutes, err = checkPlannerAmount(workout.DurationMinutes, "workout.duration_minutes", plannerMaxWorkoutMinutes); err != nil {
		return nil, err
	}
	for i, exercise := range workout.Exercises {
		field := func(name string) string { return "workout.exercises[" + strconv.Itoa(i) + "]." + name }
		e := store.PlannerExercise{Reps: exercise.Reps}
		if e.Name, err = checkPlannerText(exercise.Name, field("name"), plannerMaxExerciseTextSize, true); err != nil {
			return nil, err
		}
		if e.Equipment, err = checkPlannerText(exercise.Equipment, field("equipment"), plannerMaxExerciseTextSize, false); err != nil {
			return nil, err
		}
		if e.Settings, err = checkPlannerText(exercise.Settings, field("settings"), plannerMaxExerciseTextSize, false); err != nil {
			return nil, err
		}
		if e.Intensity, err = checkPlannerText(exercise.Intensity, field("intensity"), plannerMaxExerciseTextSize, false); err != nil {
			return nil, err
		}
		if e.Note, err = checkPlannerText(exercise.Note, field("note"), plannerMaxTitleLength, false); err != nil {
			return nil, err
		}
		if e.WeightKg, err = checkPlannerAmount(exercise.WeightKg, field("weight_kg"), plannerMaxWeightKg); err != nil {
			return nil, err
		}
		if e.DurationMinutes, err = checkPlannerAmount(exercise.DurationMinutes, field("duration_minutes"), plannerMaxWorkoutMinutes); err != nil {
			return nil, err
		}
		if e.DocUID, err = s.checkExerciseDoc(ctx, user, exercise.Doc, field("doc"), docs); err != nil {
			return nil, err
		}
		if len(e.Reps) > plannerMaxSets {
			return nil, status.Errorf(codes.InvalidArgument, "%s has at most %d sets", field("reps"), plannerMaxSets)
		}
		for _, reps := range e.Reps {
			if reps < 0 || reps > plannerMaxReps {
				return nil, status.Errorf(codes.InvalidArgument, "%s must be 0 to %d, got %d", field("reps"), plannerMaxReps, reps)
			}
		}
		result.Exercises = append(result.Exercises, e)
	}
	return result, nil
}

// checkExerciseDoc checks an exercise's guide (memos/{uid}) and returns its UID, or "" for none. It must be an
// unarchived document of the caller's. A guide in known passes without a lookup: one the stored workout already
// links stays even if it has since been archived, so that editing another exercise does not fail on it. A guide
// that passes is added to known.
func (s *APIV1Service) checkExerciseDoc(ctx context.Context, user *store.User, name, field string, known map[string]bool) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", nil
	}
	uid, err := ExtractMemoUIDFromName(name)
	if err != nil {
		return "", status.Errorf(codes.InvalidArgument, "%s must be a document name like memos/{uid}", field)
	}
	if known[uid] {
		return uid, nil
	}
	memo, err := s.Store.GetMemo(ctx, &store.FindMemo{UID: &uid, ExcludeContent: true})
	if err != nil {
		return "", status.Errorf(codes.Internal, "failed to get memo: %v", err)
	}
	// Someone else's document is reported like a missing one, so the error does not reveal it exists.
	if memo == nil || memo.CreatorID != user.ID {
		return "", status.Errorf(codes.InvalidArgument, "%s: no document of yours named %s", field, name)
	}
	if memo.RowStatus == store.Archived {
		return "", status.Errorf(codes.InvalidArgument, "%s: %s is archived", field, name)
	}
	known[uid] = true
	return uid, nil
}

// checkPlannerAmount checks an optional amount: unset, or a number from 0 to max.
func checkPlannerAmount(value *float64, field string, maxValue float64) (*float64, error) {
	if value == nil {
		return nil, nil
	}
	if math.IsNaN(*value) || *value < 0 || *value > maxValue {
		return nil, status.Errorf(codes.InvalidArgument, "%s must be 0 to %g", field, maxValue)
	}
	amount := *value
	return &amount, nil
}

func convertWorkoutFromStore(workout *store.PlannerWorkout) *v1pb.Workout {
	if workout == nil {
		return nil
	}
	result := &v1pb.Workout{DurationMinutes: workout.DurationMinutes, Exercises: []*v1pb.WorkoutExercise{}}
	for _, e := range workout.Exercises {
		reps := e.Reps
		if reps == nil {
			reps = []int32{}
		}
		result.Exercises = append(result.Exercises, &v1pb.WorkoutExercise{
			Name: e.Name, Equipment: e.Equipment, WeightKg: e.WeightKg, Reps: reps, DurationMinutes: e.DurationMinutes, Settings: e.Settings, Note: e.Note,
			Intensity: e.Intensity, Doc: exerciseDocName(e.DocUID),
		})
	}
	return result
}

// exerciseDocName is the resource name of an exercise's guide, or "" for none.
func exerciseDocName(uid string) string {
	if uid == "" {
		return ""
	}
	return MemoNamePrefix + uid
}

var checkInSourceFromStore = map[string]v1pb.CheckIn_Source{
	store.PlannerCheckInManual: v1pb.CheckIn_MANUAL,
	store.PlannerCheckInTodo:   v1pb.CheckIn_TODO,
	store.PlannerCheckInAgent:  v1pb.CheckIn_AGENT,
}

func (s *APIV1Service) ListWorkouts(ctx context.Context, request *v1pb.ListWorkoutsRequest) (*v1pb.ListWorkoutsResponse, error) {
	user, err := s.plannerUser(ctx)
	if err != nil {
		return nil, err
	}
	start, err := parsePlannerDate(request.StartDate, "start_date", true)
	if err != nil {
		return nil, err
	}
	end, err := parsePlannerDate(request.EndDate, "end_date", true)
	if err != nil {
		return nil, err
	}
	if start != "" && end != "" && end < start {
		return nil, status.Errorf(codes.InvalidArgument, "end_date is before start_date")
	}
	limit := int(request.Limit)
	if limit == 0 {
		limit = plannerDefaultWorkouts
	}
	if limit < 1 || limit > plannerMaxWorkouts {
		return nil, status.Errorf(codes.InvalidArgument, "limit must be 1 to %d, got %d", plannerMaxWorkouts, request.Limit)
	}
	find := &store.FindPlannerCheckIn{CreatorID: user.ID, StartDate: start, EndDate: end, WithWorkout: true}
	if request.Habit != "" {
		habit, err := s.getOwnHabit(ctx, user, request.Habit)
		if err != nil {
			return nil, err
		}
		find.HabitID = &habit.ID
	}
	exercise := strings.ToLower(strings.TrimSpace(request.Exercise))
	doc := ""
	if name := strings.TrimSpace(request.Doc); name != "" {
		if doc, err = ExtractMemoUIDFromName(name); err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "doc must be a document name like memos/{uid}")
		}
	}

	checkIns, err := s.Store.ListPlannerCheckIns(ctx, find)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list workouts: %v", err)
	}
	uids, err := s.habitUIDs(ctx, user)
	if err != nil {
		return nil, err
	}
	response := &v1pb.ListWorkoutsResponse{CheckIns: []*v1pb.CheckIn{}}
	// The store lists oldest first; the newest are wanted.
	for i := len(checkIns) - 1; i >= 0 && len(response.CheckIns) < limit; i-- {
		checkIn := checkIns[i]
		if exercise != "" && !workoutHasExercise(checkIn.Workout, exercise) {
			continue
		}
		if doc != "" && !workoutHasDoc(checkIn.Workout, doc) {
			continue
		}
		response.CheckIns = append(response.CheckIns, convertCheckInFromStore(checkIn, uids[checkIn.HabitID]))
	}
	return response, nil
}

// workoutHasExercise reports whether an exercise's name contains query, which is lower-cased.
func workoutHasExercise(workout *store.PlannerWorkout, query string) bool {
	if workout == nil {
		return false
	}
	for _, e := range workout.Exercises {
		if strings.Contains(strings.ToLower(e.Name), query) {
			return true
		}
	}
	return false
}

// workoutHasDoc reports whether an exercise links the guide with this memo UID.
func workoutHasDoc(workout *store.PlannerWorkout, uid string) bool {
	if workout == nil {
		return false
	}
	for _, e := range workout.Exercises {
		if e.DocUID == uid {
			return true
		}
	}
	return false
}
