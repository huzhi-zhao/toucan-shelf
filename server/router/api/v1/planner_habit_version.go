package v1

import (
	"context"
	"slices"
	"time"

	"github.com/pkg/errors"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/store"
)

// Habit versions decide which habits are in use on a day: the latest version effective on or before it. A plan
// is drafted first, changed freely, and takes effect only when enabled, from the caller's today on; once
// enabled it never changes, so the past stays as it was. See planner-and-check-in.md §2.4.2.

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
		Memos:         version.MemoNames,
		CreateTime:    optionalTimestamp(version.CreatedTs),
		UpdateTime:    optionalTimestamp(version.UpdatedTs),
	}
	for _, entry := range version.Entries {
		uid, ok := habitUIDs[entry.HabitID]
		if !ok {
			continue
		}
		result.Entries = append(result.Entries, &v1pb.HabitVersionEntry{Habit: habitNamePrefix + uid, WeeklyGoal: entry.WeeklyGoal, Pinned: entry.Pinned})
	}
	return result
}

func convertHabitDraftFromStore(draft *store.PlannerHabitDraft, habitUIDs map[int32]string) *v1pb.HabitVersion {
	return convertHabitVersionFromStore(&store.PlannerHabitVersion{
		Entries: draft.Entries, MemoNames: draft.MemoNames, CreatedTs: draft.CreatedTs, UpdatedTs: draft.UpdatedTs,
	}, habitUIDs)
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
	draft, err := s.Store.GetPlannerHabitDraft(ctx, user.ID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get habit draft: %v", err)
	}
	if draft != nil {
		response.Draft = convertHabitDraftFromStore(draft, uids)
	}
	return response, nil
}

// planEntries checks a plan's habits and turns them into store entries: at most ten, each once, at most three
// pinned, goals within a week. It also returns the habits' UIDs for the response.
func (s *APIV1Service) planEntries(ctx context.Context, user *store.User, entries []*v1pb.HabitVersionEntry) ([]store.PlannerHabitVersionEntry, map[int32]string, error) {
	if len(entries) > store.PlannerMaxHabitsPerVersion {
		return nil, nil, status.Errorf(codes.InvalidArgument, "a plan has at most %d habits", store.PlannerMaxHabitsPerVersion)
	}
	result := []store.PlannerHabitVersionEntry{}
	pinned := 0
	uids := map[int32]string{}
	for _, entry := range entries {
		habit, err := s.getOwnHabit(ctx, user, entry.Habit)
		if err != nil {
			return nil, nil, err
		}
		if _, dup := uids[habit.ID]; dup {
			return nil, nil, status.Errorf(codes.InvalidArgument, "habit %s is in the plan twice", entry.Habit)
		}
		if entry.WeeklyGoal < 0 || entry.WeeklyGoal > plannerMaxWeeklyGoal {
			return nil, nil, status.Errorf(codes.InvalidArgument, "weekly_goal must be 0 to %d", plannerMaxWeeklyGoal)
		}
		if entry.Pinned {
			pinned++
		}
		uids[habit.ID] = habit.UID
		result = append(result, store.PlannerHabitVersionEntry{HabitID: habit.ID, WeeklyGoal: entry.WeeklyGoal, Pinned: entry.Pinned})
	}
	if pinned > store.PlannerMaxPinnedHabits {
		return nil, nil, status.Errorf(codes.InvalidArgument, "a plan pins at most %d habits", store.PlannerMaxPinnedHabits)
	}
	return result, uids, nil
}

// UpdateHabitDraft writes the caller's plan draft. Nothing takes effect until it is enabled.
func (s *APIV1Service) UpdateHabitDraft(ctx context.Context, request *v1pb.UpdateHabitDraftRequest) (*v1pb.HabitVersion, error) {
	user, err := s.plannerUser(ctx)
	if err != nil {
		return nil, err
	}
	if request.Draft == nil {
		return nil, status.Errorf(codes.InvalidArgument, "draft is required")
	}
	entries, uids, err := s.planEntries(ctx, user, request.Draft.Entries)
	if err != nil {
		return nil, err
	}
	memos, err := checkPlannerMemos(request.Draft.Memos)
	if err != nil {
		return nil, err
	}
	draft, err := s.Store.UpsertPlannerHabitDraft(ctx, &store.PlannerHabitDraft{CreatorID: user.ID, Entries: entries, MemoNames: memos})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to save habit draft: %v", err)
	}
	return convertHabitDraftFromStore(draft, uids), nil
}

func (s *APIV1Service) DeleteHabitDraft(ctx context.Context, _ *v1pb.DeleteHabitDraftRequest) (*emptypb.Empty, error) {
	user, err := s.plannerUser(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.Store.DeletePlannerHabitDraft(ctx, user.ID); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to delete habit draft: %v", err)
	}
	return &emptypb.Empty{}, nil
}

// EnableHabitDraft puts the draft in use from the caller's today: the plan before it stops there, and a plan
// enabled earlier the same day is replaced. Habit todos from today on whose habit the draft leaves out become
// plain todos, but only once the caller agrees.
func (s *APIV1Service) EnableHabitDraft(ctx context.Context, request *v1pb.EnableHabitDraftRequest) (*v1pb.HabitVersion, error) {
	user, err := s.plannerUser(ctx)
	if err != nil {
		return nil, err
	}
	local, err := parsePlannerDate(request.LocalDate, "local_date", false)
	if err != nil {
		return nil, err
	}
	draft, err := s.Store.GetPlannerHabitDraft(ctx, user.ID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get habit draft: %v", err)
	}
	if draft == nil {
		return nil, status.Errorf(codes.NotFound, "there is no habit draft to enable")
	}
	uids, err := s.habitUIDs(ctx, user)
	if err != nil {
		return nil, err
	}
	dropped, err := s.orphanedHabitTodos(ctx, user, &store.PlannerHabitVersion{Entries: draft.Entries}, local, "")
	if err != nil {
		return nil, err
	}
	if len(dropped) > 0 && !request.UnlinkTodos {
		return nil, status.Errorf(codes.FailedPrecondition, "%d habit todos lose their habit in this plan; set unlink_todos to make them plain todos", len(dropped))
	}
	enabled, err := s.Store.EnablePlannerHabitDraft(ctx, user.ID, local, dropped)
	if errors.Is(err, store.ErrPlannerNoDraft) {
		return nil, status.Errorf(codes.NotFound, "there is no habit draft to enable")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to enable habit draft: %v", err)
	}
	return convertHabitVersionFromStore(enabled, uids), nil
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
