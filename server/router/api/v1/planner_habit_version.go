package v1

import (
	"context"
	"slices"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/store"
)

// Habit versions decide which habits are in use on a day: the latest version effective on or before it. A
// version only takes effect from the caller's today on, so the past never changes; one not yet in effect
// can still be replaced or deleted. See planner-and-check-in.md §2.4.2.

// plannerHabitColors is the size of the client's habit palette; a habit's color indexes it.
const plannerHabitColors = 8

// plannerMaxWeeklyGoal is a check-in every day of the week.
const plannerMaxWeeklyGoal = 7

// habitVersionOn returns the version in use on date, or nil before the first one. versions are earliest
// first, as the store lists them.
func habitVersionOn(versions []*store.PlannerHabitVersion, date string) *store.PlannerHabitVersion {
	var on *store.PlannerHabitVersion
	for _, version := range versions {
		if version.EffectiveDate > date {
			break
		}
		on = version
	}
	return on
}

// nextHabitVersionDate is the effective date of the first version after date, or "" when none follows.
func nextHabitVersionDate(versions []*store.PlannerHabitVersion, date string) string {
	for _, version := range versions {
		if version.EffectiveDate > date {
			return version.EffectiveDate
		}
	}
	return ""
}

func habitVersionHas(version *store.PlannerHabitVersion, habitID int32) bool {
	if version == nil {
		return false
	}
	return slices.ContainsFunc(version.Entries, func(entry store.PlannerHabitVersionEntry) bool { return entry.HabitID == habitID })
}

func (s *APIV1Service) listHabitVersions(ctx context.Context, user *store.User) ([]*store.PlannerHabitVersion, error) {
	versions, err := s.Store.ListPlannerHabitVersions(ctx, user.ID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list habit versions: %v", err)
	}
	return versions, nil
}

// habitInUse reports whether the habit is in the version in use on date.
func (s *APIV1Service) habitInUse(ctx context.Context, user *store.User, habitID int32, date string) (bool, error) {
	versions, err := s.listHabitVersions(ctx, user)
	if err != nil {
		return false, err
	}
	return habitVersionHas(habitVersionOn(versions, date), habitID), nil
}

// liveHabitVersions are the versions still in use or yet to come: the one in use today (by the server's
// clock, as close as a request without the caller's date gets) and any after it.
func (s *APIV1Service) liveHabitVersions(versions []*store.PlannerHabitVersion) []*store.PlannerHabitVersion {
	today := s.now().UTC().Format(time.DateOnly)
	current := habitVersionOn(versions, today)
	for i, version := range versions {
		if version == current || version.EffectiveDate > today {
			return versions[i:]
		}
	}
	return nil
}

func convertHabitVersionFromStore(version *store.PlannerHabitVersion, habitUIDs map[int32]string) *v1pb.HabitVersion {
	result := &v1pb.HabitVersion{
		EffectiveDate: version.EffectiveDate,
		Entries:       []*v1pb.HabitVersionEntry{},
		CreateTime:    optionalTimestamp(version.CreatedTs),
		UpdateTime:    optionalTimestamp(version.UpdatedTs),
	}
	for _, entry := range version.Entries {
		uid, ok := habitUIDs[entry.HabitID]
		if !ok {
			continue
		}
		result.Entries = append(result.Entries, &v1pb.HabitVersionEntry{Habit: habitNamePrefix + uid, WeeklyGoal: entry.WeeklyGoal})
	}
	return result
}

func (s *APIV1Service) habitUIDs(ctx context.Context, user *store.User) (map[int32]string, error) {
	habits, err := s.Store.ListPlannerHabits(ctx, &store.FindPlannerHabit{CreatorID: &user.ID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list habits: %v", err)
	}
	uids := make(map[int32]string, len(habits))
	for _, habit := range habits {
		uids[habit.ID] = habit.UID
	}
	return uids, nil
}

func (s *APIV1Service) ListHabitVersions(ctx context.Context, _ *v1pb.ListHabitVersionsRequest) (*v1pb.ListHabitVersionsResponse, error) {
	user, err := s.plannerUser(ctx)
	if err != nil {
		return nil, err
	}
	versions, err := s.listHabitVersions(ctx, user)
	if err != nil {
		return nil, err
	}
	uids, err := s.habitUIDs(ctx, user)
	if err != nil {
		return nil, err
	}
	response := &v1pb.ListHabitVersionsResponse{Versions: []*v1pb.HabitVersion{}}
	for _, version := range versions {
		response.Versions = append(response.Versions, convertHabitVersionFromStore(version, uids))
	}
	return response, nil
}

// SetHabitVersion writes the version taking effect on its date, replacing one already set for that date.
// Habit todos it leaves without their habit become plain todos, but only once the caller agrees.
func (s *APIV1Service) SetHabitVersion(ctx context.Context, request *v1pb.SetHabitVersionRequest) (*v1pb.HabitVersion, error) {
	user, err := s.plannerUser(ctx)
	if err != nil {
		return nil, err
	}
	if request.Version == nil {
		return nil, status.Errorf(codes.InvalidArgument, "version is required")
	}
	local, err := parsePlannerDate(request.LocalDate, "local_date", false)
	if err != nil {
		return nil, err
	}
	effective, err := parsePlannerDate(request.Version.EffectiveDate, "effective_date", false)
	if err != nil {
		return nil, err
	}
	if effective < local {
		return nil, status.Errorf(codes.InvalidArgument, "a version takes effect today or later, not on %s", effective)
	}
	if len(request.Version.Entries) > store.PlannerMaxHabitsPerVersion {
		return nil, status.Errorf(codes.InvalidArgument, "a version has at most %d habits", store.PlannerMaxHabitsPerVersion)
	}
	version := &store.PlannerHabitVersion{CreatorID: user.ID, EffectiveDate: effective, Entries: []store.PlannerHabitVersionEntry{}}
	colors := map[int32]bool{}
	uids := map[int32]string{}
	for _, entry := range request.Version.Entries {
		habit, err := s.getOwnHabit(ctx, user, entry.Habit)
		if err != nil {
			return nil, err
		}
		if _, dup := uids[habit.ID]; dup {
			return nil, status.Errorf(codes.InvalidArgument, "habit %s is in the version twice", entry.Habit)
		}
		if colors[habit.Color] {
			return nil, status.Errorf(codes.InvalidArgument, "two habits in a version share a color")
		}
		if entry.WeeklyGoal < 0 || entry.WeeklyGoal > plannerMaxWeeklyGoal {
			return nil, status.Errorf(codes.InvalidArgument, "weekly_goal must be 0 to %d", plannerMaxWeeklyGoal)
		}
		uids[habit.ID], colors[habit.Color] = habit.UID, true
		version.Entries = append(version.Entries, store.PlannerHabitVersionEntry{HabitID: habit.ID, WeeklyGoal: entry.WeeklyGoal})
	}

	versions, err := s.listHabitVersions(ctx, user)
	if err != nil {
		return nil, err
	}
	dropped, err := s.orphanedHabitTodos(ctx, user, version, effective, nextHabitVersionDate(versions, effective))
	if err != nil {
		return nil, err
	}
	if len(dropped) > 0 && !request.UnlinkTodos {
		return nil, status.Errorf(codes.FailedPrecondition, "%d habit todos lose their habit in this version; set unlink_todos to make them plain todos", len(dropped))
	}
	saved, err := s.Store.UpsertPlannerHabitVersion(ctx, version, dropped)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to set habit version: %v", err)
	}
	return convertHabitVersionFromStore(saved, uids), nil
}

// DeleteHabitVersion removes a version not yet in effect; its days fall back to the version before it.
func (s *APIV1Service) DeleteHabitVersion(ctx context.Context, request *v1pb.DeleteHabitVersionRequest) (*emptypb.Empty, error) {
	user, err := s.plannerUser(ctx)
	if err != nil {
		return nil, err
	}
	local, err := parsePlannerDate(request.LocalDate, "local_date", false)
	if err != nil {
		return nil, err
	}
	effective, err := parsePlannerDate(request.EffectiveDate, "effective_date", false)
	if err != nil {
		return nil, err
	}
	if effective <= local {
		return nil, status.Errorf(codes.FailedPrecondition, "a version in effect can no longer be deleted")
	}
	versions, err := s.listHabitVersions(ctx, user)
	if err != nil {
		return nil, err
	}
	index := slices.IndexFunc(versions, func(version *store.PlannerHabitVersion) bool { return version.EffectiveDate == effective })
	if index < 0 {
		return nil, status.Errorf(codes.NotFound, "no habit version takes effect on %s", effective)
	}
	previous := &store.PlannerHabitVersion{}
	if index > 0 {
		previous = versions[index-1]
	}
	orphaned, err := s.orphanedHabitTodos(ctx, user, previous, effective, nextHabitVersionDate(versions, effective))
	if err != nil {
		return nil, err
	}
	if len(orphaned) > 0 {
		return nil, status.Errorf(codes.FailedPrecondition, "%d habit todos rely on this version; delete them first", len(orphaned))
	}
	if err := s.Store.DeletePlannerHabitVersion(ctx, user.ID, effective); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to delete habit version: %v", err)
	}
	return &emptypb.Empty{}, nil
}

// orphanedHabitTodos lists the open habit todos dated from start up to (not including) end, "" for no end,
// whose habit is not in version: the ones that version would leave without their habit.
func (s *APIV1Service) orphanedHabitTodos(ctx context.Context, user *store.User, version *store.PlannerHabitVersion, start, end string) ([]int32, error) {
	active := store.PlannerTodoActive
	todos, err := s.Store.ListPlannerTodos(ctx, &store.FindPlannerTodo{CreatorID: &user.ID, Status: &active, StartDate: start})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list todos: %v", err)
	}
	ids := []int32{}
	for _, todo := range todos {
		if todo.HabitID == 0 || (end != "" && todo.Date >= end) || habitVersionHas(version, todo.HabitID) {
			continue
		}
		ids = append(ids, todo.ID)
	}
	return ids, nil
}

// habitTodoCheckIn is the check-in that completing a habit todo makes: on the todo's own date, noted with
// its title. A habit todo cannot be done ahead of its day. If the habit is not in use that day, the todo
// just closes.
func (s *APIV1Service) habitTodoCheckIn(ctx context.Context, user *store.User, todo *store.PlannerTodo, title, localDate string) (*store.PlannerCheckIn, error) {
	date := todo.Date
	if date == "" {
		// Linked before habit todos had to be dated (§2.4.1): it checks in on the day it is done.
		date = localDate
	}
	if date > localDate {
		return nil, status.Errorf(codes.FailedPrecondition, "a habit todo is completed on its own date, %s", date)
	}
	inUse, err := s.habitInUse(ctx, user, todo.HabitID, date)
	if err != nil || !inUse {
		return nil, err
	}
	return &store.PlannerCheckIn{CreatorID: user.ID, HabitID: todo.HabitID, Date: date, Note: title}, nil
}

// habitTodoOn returns the user's habit todo for the habit on date, any status, or nil.
func (s *APIV1Service) habitTodoOn(ctx context.Context, user *store.User, habitID int32, date string) (*store.PlannerTodo, error) {
	todos, err := s.Store.ListPlannerTodos(ctx, &store.FindPlannerTodo{CreatorID: &user.ID, HabitID: &habitID, StartDate: date, EndDate: date})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list todos: %v", err)
	}
	if len(todos) == 0 {
		return nil, nil
	}
	return todos[0], nil
}
