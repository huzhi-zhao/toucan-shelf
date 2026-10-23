package v1

import (
	"context"

	"github.com/lithammer/shortuuid/v4"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/store"
)

// A habit todo can carry the workout planned for its day; see requirement §2.4.5 and ADR 0022.

var todoSourceFromStore = map[string]v1pb.Todo_Source{
	store.PlannerCheckInManual: v1pb.Todo_MANUAL,
	store.PlannerCheckInAgent:  v1pb.Todo_AGENT,
}

// plannerTodoSourceFor is who the caller is, as a todo or planned workout records it.
func plannerTodoSourceFor(ctx context.Context) string {
	if plannerAgent(ctx) {
		return store.PlannerCheckInAgent
	}
	return store.PlannerCheckInManual
}

// checkPlannableTodo refuses a plan on a todo that is not an active habit todo, or (given the caller's today)
// one whose day has passed: a failed habit todo is history, like a done or cancelled one.
func checkPlannableTodo(todo *store.PlannerTodo, localDate string) error {
	if todo.HabitID == 0 {
		return status.Errorf(codes.FailedPrecondition, "only a habit todo carries a planned workout")
	}
	if todo.Status != store.PlannerTodoActive {
		return status.Errorf(codes.FailedPrecondition, "the todo is closed; its planned workout no longer changes")
	}
	if localDate != "" {
		local, err := parsePlannerDate(localDate, "local_date", false)
		if err != nil {
			return err
		}
		if todo.Date < local {
			return status.Errorf(codes.FailedPrecondition, "the todo's day has passed; its planned workout no longer changes")
		}
	}
	return nil
}

// setPlannedWorkout puts a checked plan, or its removal, on an update, recording the caller as its source.
func setPlannedWorkout(ctx context.Context, update *store.UpdatePlannerTodo, workout *v1pb.Workout) error {
	planned, err := plannerWorkoutFromRequest(workout)
	if err != nil {
		return err
	}
	update.SetPlannedWorkout = true
	update.PlannedWorkout = planned
	update.PlannedWorkoutSource = ""
	if planned != nil {
		update.PlannedWorkoutSource = plannerTodoSourceFor(ctx)
	}
	return nil
}

func (s *APIV1Service) SetPlannedWorkout(ctx context.Context, request *v1pb.SetPlannedWorkoutRequest) (*v1pb.SetPlannedWorkoutResponse, error) {
	user, err := s.plannerUser(ctx)
	if err != nil {
		return nil, err
	}
	date, err := parsePlannerDate(request.Date, "date", false)
	if err != nil {
		return nil, err
	}
	local, err := parsePlannerDate(request.LocalDate, "local_date", false)
	if err != nil {
		return nil, err
	}
	if date < local {
		return nil, status.Errorf(codes.InvalidArgument, "a planned workout is for a date from today on")
	}
	planned, err := plannerWorkoutFromRequest(request.Workout)
	if err != nil {
		return nil, err
	}
	habit, err := s.getOwnHabit(ctx, user, request.Habit)
	if err != nil {
		return nil, err
	}
	todo, err := s.habitTodoOn(ctx, user, habit.ID, date)
	if err != nil {
		return nil, err
	}

	if todo == nil {
		if planned == nil {
			return &v1pb.SetPlannedWorkoutResponse{}, nil
		}
		// No habit todo that day: make one for the plan, as the habit button would (§2.4.5 §5).
		if _, err := s.checkNewHabitTodo(ctx, user, request.Habit, date, local); err != nil {
			return nil, err
		}
		source := plannerTodoSourceFor(ctx)
		created, err := s.Store.CreatePlannerTodo(ctx, &store.PlannerTodo{
			UID: shortuuid.New(), CreatorID: user.ID, Title: habit.Name, Date: date, Status: store.PlannerTodoActive,
			HabitID: habit.ID, Source: source, PlannedWorkout: planned, PlannedWorkoutSource: source,
		})
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to create todo: %v", err)
		}
		return &v1pb.SetPlannedWorkoutResponse{Todo: convertTodoFromStore(created), Created: true}, nil
	}

	if err := checkPlannableTodo(todo, local); err != nil {
		return nil, err
	}
	update := &store.UpdatePlannerTodo{ID: todo.ID}
	if err := setPlannedWorkout(ctx, update, request.Workout); err != nil {
		return nil, err
	}
	updated, err := s.Store.UpdatePlannerTodo(ctx, update)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to update todo: %v", err)
	}
	return &v1pb.SetPlannedWorkoutResponse{Todo: convertTodoFromStore(updated)}, nil
}
