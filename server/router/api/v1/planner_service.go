package v1

import (
	"context"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/lithammer/shortuuid/v4"
	"github.com/pkg/errors"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/store"
)

// The planner is personal data: every handler here scopes to the authenticated
// user and never reaches into the knowledge base. Dates are the user's
// phone-local "YYYY-MM-DD", stored as given. See
// docs/dev/requirements/planner-and-check-in.md.

const (
	habitNamePrefix       = "planner/habits/"
	todoNamePrefix        = "planner/todos/"
	plannerNoteNamePrefix = "planner/notes/"
)

// Generous caps that reject junk without constraining real use.
const (
	plannerMaxTitleLength  = 500
	plannerMaxTextLength   = 20_000
	plannerMaxTagLength    = 100
	plannerMaxURLLength    = 2_000
	plannerMaxRangeDays    = 400
	plannerMaxImportedRows = 50_000
)

// plannerMaxRating is the top of a check-in's rating scale, 1 to 5.
const plannerMaxRating = 5

func (s *APIV1Service) plannerUser(ctx context.Context) (*store.User, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "authentication required")
	}
	return user, nil
}

func extractPlannerUID(name, prefix, kind string) (string, error) {
	uid := strings.TrimPrefix(name, prefix)
	if uid == name || uid == "" || strings.Contains(uid, "/") {
		return "", status.Errorf(codes.InvalidArgument, "invalid %s name: %s", kind, name)
	}
	return uid, nil
}

// parsePlannerDate checks a "YYYY-MM-DD" date. An empty date is allowed only
// where allowEmpty says so (a todo without a day).
func parsePlannerDate(date, field string, allowEmpty bool) (string, error) {
	if date == "" && allowEmpty {
		return "", nil
	}
	if _, err := time.Parse(time.DateOnly, date); err != nil || len(date) != len(time.DateOnly) {
		return "", status.Errorf(codes.InvalidArgument, "%s must be a date in YYYY-MM-DD form, got %q", field, date)
	}
	return date, nil
}

func checkPlannerText(value, field string, maxLength int, required bool) (string, error) {
	value = strings.TrimSpace(value)
	if required && value == "" {
		return "", status.Errorf(codes.InvalidArgument, "%s is required", field)
	}
	if utf8.RuneCountInString(value) > maxLength {
		return "", status.Errorf(codes.InvalidArgument, "%s is longer than %d characters", field, maxLength)
	}
	return value, nil
}

// checkPlannerURL accepts only http and https links: the client renders the URL
// as a link, and a javascript: one would run on tap.
func checkPlannerURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", nil
	}
	if len(raw) > plannerMaxURLLength {
		return "", status.Errorf(codes.InvalidArgument, "url is longer than %d characters", plannerMaxURLLength)
	}
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return "", status.Errorf(codes.InvalidArgument, "url must be an http or https link")
	}
	return raw, nil
}

// checkPlannerMemo accepts a document reference, which is all it is: the reader
// enforces access when the link is followed.
func checkPlannerMemo(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", nil
	}
	if _, err := ExtractMemoUIDFromName(name); err != nil {
		return "", status.Errorf(codes.InvalidArgument, "memo must be a document name like memos/{uid}")
	}
	return name, nil
}

// plannerMaxMemos caps a todo's linked documents; a todo needing more is a document of its own.
const plannerMaxMemos = 20

// checkPlannerMemos accepts the linked documents in order, dropping blanks and repeats.
func checkPlannerMemos(names []string) ([]string, error) {
	memos := []string{}
	seen := map[string]bool{}
	for _, name := range names {
		memo, err := checkPlannerMemo(name)
		if err != nil {
			return nil, err
		}
		if memo == "" || seen[memo] {
			continue
		}
		seen[memo] = true
		memos = append(memos, memo)
	}
	if len(memos) > plannerMaxMemos {
		return nil, status.Errorf(codes.InvalidArgument, "at most %d linked documents", plannerMaxMemos)
	}
	return memos, nil
}

// todoMemos is what a todo in a request links: memos, or for a client that only knows the deprecated memo,
// that one document.
func todoMemos(todo *v1pb.Todo) ([]string, error) {
	if len(todo.Memos) == 0 && todo.Memo != "" { //nolint:staticcheck // the deprecated field is still accepted
		return checkPlannerMemos([]string{todo.Memo}) //nolint:staticcheck
	}
	return checkPlannerMemos(todo.Memos)
}

// firstMemo is what the deprecated single-document fields read: the first linked document, or "".
func firstMemo(memos []string) string {
	if len(memos) == 0 {
		return ""
	}
	return memos[0]
}

// optionalTimestamp converts Unix seconds, leaving 0 (never, or unknown) unset.
func optionalTimestamp(ts int64) *timestamppb.Timestamp {
	if ts == 0 {
		return nil
	}
	return timestamppb.New(time.Unix(ts, 0))
}

func convertHabitFromStore(h *store.PlannerHabit) *v1pb.Habit {
	return &v1pb.Habit{
		Name:       habitNamePrefix + h.UID,
		Title:      h.Name,
		Position:   h.Position,
		Color:      h.Color,
		CreateTime: optionalTimestamp(h.CreatedTs),
		UpdateTime: optionalTimestamp(h.UpdatedTs),
	}
}

var todoStatusToStore = map[v1pb.Todo_Status]string{
	v1pb.Todo_ACTIVE:    store.PlannerTodoActive,
	v1pb.Todo_DONE:      store.PlannerTodoDone,
	v1pb.Todo_CANCELLED: store.PlannerTodoCancelled,
}

func todoStatusFromStore(value string) v1pb.Todo_Status {
	for pb, stored := range todoStatusToStore {
		if stored == value {
			return pb
		}
	}
	return v1pb.Todo_STATUS_UNSPECIFIED
}

func convertTodoFromStore(t *store.PlannerTodo) *v1pb.Todo {
	return &v1pb.Todo{
		Name:                 todoNamePrefix + t.UID,
		Title:                t.Title,
		Date:                 t.Date,
		Status:               todoStatusFromStore(t.Status),
		ClosedOverdue:        t.ClosedOverdue,
		CloseTime:            optionalTimestamp(t.ClosedTs),
		CancelReason:         t.CancelReason,
		Important:            t.Important,
		Tag:                  t.Tag,
		Note:                 t.Note,
		Memo:                 firstMemo(t.MemoNames), //nolint:staticcheck // still filled for clients that only know it
		Memos:                t.MemoNames,
		Url:                  t.URL,
		OriginalDate:         t.OriginalDate,
		PostponeCount:        t.PostponeCount,
		Habit:                plannerName(habitNamePrefix, t.HabitUID),
		CheckInDate:          t.CheckInDate,
		CreateTime:           optionalTimestamp(t.CreatedTs),
		UpdateTime:           optionalTimestamp(t.UpdatedTs),
		Source:               todoSourceFromStore[t.Source],
		PlannedWorkout:       convertWorkoutFromStore(t.PlannedWorkout),
		PlannedWorkoutSource: todoSourceFromStore[t.PlannedWorkoutSource],
	}
}

// plannerName is a resource name, or "" when there is no UID to name.
func plannerName(prefix, uid string) string {
	if uid == "" {
		return ""
	}
	return prefix + uid
}

func convertCheckInFromStore(c *store.PlannerCheckIn, habitUID string) *v1pb.CheckIn {
	return &v1pb.CheckIn{
		Habit:   habitNamePrefix + habitUID,
		Date:    c.Date,
		Note:    c.Note,
		Todo:    plannerName(todoNamePrefix, c.TodoUID),
		Source:  checkInSourceFromStore[c.Source],
		Workout: convertWorkoutFromStore(c.Workout),
		Rating:  &c.Rating,
	}
}

func convertPlannerNoteFromStore(n *store.PlannerNote) *v1pb.PlannerNote {
	return &v1pb.PlannerNote{
		Name:       plannerNoteNamePrefix + n.UID,
		Date:       n.Date,
		Content:    n.Content,
		Remark:     n.Remark,
		Memos:      n.MemoNames,
		CreateTime: optionalTimestamp(n.CreatedTs),
		UpdateTime: optionalTimestamp(n.UpdatedTs),
	}
}

func (s *APIV1Service) getOwnHabit(ctx context.Context, user *store.User, name string) (*store.PlannerHabit, error) {
	uid, err := extractPlannerUID(name, habitNamePrefix, "habit")
	if err != nil {
		return nil, err
	}
	habit, err := s.Store.GetPlannerHabit(ctx, &store.FindPlannerHabit{UID: &uid, CreatorID: &user.ID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get habit: %v", err)
	}
	if habit == nil {
		return nil, status.Errorf(codes.NotFound, "habit not found")
	}
	return habit, nil
}

func (s *APIV1Service) getOwnTodo(ctx context.Context, user *store.User, name string) (*store.PlannerTodo, error) {
	uid, err := extractPlannerUID(name, todoNamePrefix, "todo")
	if err != nil {
		return nil, err
	}
	todo, err := s.Store.GetPlannerTodo(ctx, &store.FindPlannerTodo{UID: &uid, CreatorID: &user.ID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get todo: %v", err)
	}
	if todo == nil {
		return nil, status.Errorf(codes.NotFound, "todo not found")
	}
	return todo, nil
}

func (s *APIV1Service) getOwnPlannerNote(ctx context.Context, user *store.User, name string) (*store.PlannerNote, error) {
	uid, err := extractPlannerUID(name, plannerNoteNamePrefix, "note")
	if err != nil {
		return nil, err
	}
	note, err := s.Store.GetPlannerNote(ctx, &store.FindPlannerNote{UID: &uid, CreatorID: &user.ID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get note: %v", err)
	}
	if note == nil {
		return nil, status.Errorf(codes.NotFound, "note not found")
	}
	return note, nil
}

// Habits.

func (s *APIV1Service) ListHabits(ctx context.Context, _ *v1pb.ListHabitsRequest) (*v1pb.ListHabitsResponse, error) {
	user, err := s.plannerUser(ctx)
	if err != nil {
		return nil, err
	}
	habits, err := s.Store.ListPlannerHabits(ctx, &store.FindPlannerHabit{CreatorID: &user.ID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list habits: %v", err)
	}
	response := &v1pb.ListHabitsResponse{Habits: []*v1pb.Habit{}}
	for _, habit := range habits {
		response.Habits = append(response.Habits, convertHabitFromStore(habit))
	}
	return response, nil
}

func (s *APIV1Service) CreateHabit(ctx context.Context, request *v1pb.CreateHabitRequest) (*v1pb.Habit, error) {
	user, err := s.plannerUser(ctx)
	if err != nil {
		return nil, err
	}
	if request.Habit == nil {
		return nil, status.Errorf(codes.InvalidArgument, "habit is required")
	}
	title, err := checkPlannerText(request.Habit.Title, "title", plannerMaxTitleLength, true)
	if err != nil {
		return nil, err
	}
	existing, err := s.Store.ListPlannerHabits(ctx, &store.FindPlannerHabit{CreatorID: &user.ID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list habits: %v", err)
	}
	position := int32(0)
	for _, habit := range existing {
		position = max(position, habit.Position+1)
	}
	versions, err := s.listHabitVersions(ctx, user)
	if err != nil {
		return nil, err
	}
	habit, err := s.Store.CreatePlannerHabit(ctx, &store.PlannerHabit{
		UID:       shortuuid.New(),
		CreatorID: user.ID,
		Name:      title,
		Position:  position,
		Color:     newHabitColor(existing, versions),
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to create habit: %v", err)
	}
	return convertHabitFromStore(habit), nil
}

func (s *APIV1Service) UpdateHabit(ctx context.Context, request *v1pb.UpdateHabitRequest) (*v1pb.Habit, error) {
	user, err := s.plannerUser(ctx)
	if err != nil {
		return nil, err
	}
	if request.Habit == nil || request.UpdateMask == nil || len(request.UpdateMask.Paths) == 0 {
		return nil, status.Errorf(codes.InvalidArgument, "habit and update_mask are required")
	}
	habit, err := s.getOwnHabit(ctx, user, request.Habit.Name)
	if err != nil {
		return nil, err
	}
	update := &store.UpdatePlannerHabit{ID: habit.ID}
	for _, path := range request.UpdateMask.Paths {
		switch path {
		case "title":
			title, err := checkPlannerText(request.Habit.Title, "title", plannerMaxTitleLength, true)
			if err != nil {
				return nil, err
			}
			update.Name = &title
		case "color":
			if err := checkHabitColor(request.Habit.Color); err != nil {
				return nil, err
			}
			update.Color = &request.Habit.Color
		case "position":
			update.Position = &request.Habit.Position
		default:
			return nil, status.Errorf(codes.InvalidArgument, "unsupported update_mask path: %s", path)
		}
	}
	updated, err := s.Store.UpdatePlannerHabit(ctx, update)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to update habit: %v", err)
	}
	return convertHabitFromStore(updated), nil
}

// newHabitColor picks a color for a new habit: the first one no habit has, else the first the latest
// version does not use, else the next one round.
func newHabitColor(habits []*store.PlannerHabit, versions []*store.PlannerHabitVersion) int32 {
	colorOf := map[int32]int32{}
	used := map[int32]bool{}
	for _, habit := range habits {
		colorOf[habit.ID] = habit.Color
		used[habit.Color] = true
	}
	inLatest := map[int32]bool{}
	if len(versions) > 0 {
		for _, entry := range versions[len(versions)-1].Entries {
			inLatest[colorOf[entry.HabitID]] = true
		}
	}
	for _, taken := range []map[int32]bool{used, inLatest} {
		for color := int32(0); color < plannerHabitColors; color++ {
			if !taken[color] {
				return color
			}
		}
	}
	return int32(len(habits) % plannerHabitColors)
}

// checkHabitColor refuses a color out of the palette. Habits of one plan may share a color: the planner shows
// them by icon.
func checkHabitColor(color int32) error {
	if color < 0 || color >= plannerHabitColors {
		return status.Errorf(codes.InvalidArgument, "color must be 0 to %d", plannerHabitColors-1)
	}
	return nil
}

// Entries.

func (s *APIV1Service) ListPlannerEntries(ctx context.Context, request *v1pb.ListPlannerEntriesRequest) (*v1pb.ListPlannerEntriesResponse, error) {
	user, err := s.plannerUser(ctx)
	if err != nil {
		return nil, err
	}
	start, err := parsePlannerDate(request.StartDate, "start_date", false)
	if err != nil {
		return nil, err
	}
	end, err := parsePlannerDate(request.EndDate, "end_date", false)
	if err != nil {
		return nil, err
	}
	startTime, _ := time.Parse(time.DateOnly, start)
	endTime, _ := time.Parse(time.DateOnly, end)
	if endTime.Before(startTime) || endTime.Sub(startTime) > plannerMaxRangeDays*24*time.Hour {
		return nil, status.Errorf(codes.InvalidArgument, "the range must run forwards and span at most %d days", plannerMaxRangeDays)
	}

	habits, err := s.Store.ListPlannerHabits(ctx, &store.FindPlannerHabit{CreatorID: &user.ID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list habits: %v", err)
	}
	habitUIDs := make(map[int32]string, len(habits))
	for _, habit := range habits {
		habitUIDs[habit.ID] = habit.UID
	}
	checkIns, err := s.Store.ListPlannerCheckIns(ctx, &store.FindPlannerCheckIn{CreatorID: user.ID, StartDate: start, EndDate: end})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list check-ins: %v", err)
	}
	todos, err := s.Store.ListPlannerTodos(ctx, &store.FindPlannerTodo{CreatorID: &user.ID, StartDate: start, EndDate: end})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list todos: %v", err)
	}
	notes, err := s.Store.ListPlannerNotes(ctx, &store.FindPlannerNote{CreatorID: &user.ID, StartDate: start, EndDate: end})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list notes: %v", err)
	}

	response := &v1pb.ListPlannerEntriesResponse{CheckIns: []*v1pb.CheckIn{}, Todos: []*v1pb.Todo{}, Notes: []*v1pb.PlannerNote{}}
	for _, checkIn := range checkIns {
		response.CheckIns = append(response.CheckIns, convertCheckInFromStore(checkIn, habitUIDs[checkIn.HabitID]))
	}
	for _, todo := range todos {
		response.Todos = append(response.Todos, convertTodoFromStore(todo))
	}
	for _, note := range notes {
		response.Notes = append(response.Notes, convertPlannerNoteFromStore(note))
	}
	return response, nil
}

func (s *APIV1Service) ListOpenTodos(ctx context.Context, _ *v1pb.ListOpenTodosRequest) (*v1pb.ListOpenTodosResponse, error) {
	user, err := s.plannerUser(ctx)
	if err != nil {
		return nil, err
	}
	active := store.PlannerTodoActive
	todos, err := s.Store.ListPlannerTodos(ctx, &store.FindPlannerTodo{CreatorID: &user.ID, Status: &active})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list todos: %v", err)
	}
	response := &v1pb.ListOpenTodosResponse{Todos: []*v1pb.Todo{}}
	for _, todo := range todos {
		response.Todos = append(response.Todos, convertTodoFromStore(todo))
	}
	return response, nil
}

func (s *APIV1Service) ListTodoChanges(ctx context.Context, request *v1pb.ListTodoChangesRequest) (*v1pb.ListTodoChangesResponse, error) {
	user, err := s.plannerUser(ctx)
	if err != nil {
		return nil, err
	}
	if request.UpdatedSince == nil || !request.UpdatedSince.IsValid() {
		return nil, status.Errorf(codes.InvalidArgument, "updated_since is required")
	}
	// Read the clock before the changes, so one made while they are read comes again next time rather than never.
	now := s.now()
	// 0 would mean "no bound" to the store; the epoch itself is just as complete.
	since := max(request.UpdatedSince.AsTime().Unix(), 1)
	todos, err := s.Store.ListPlannerTodos(ctx, &store.FindPlannerTodo{CreatorID: &user.ID, UpdatedSince: since})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list todos: %v", err)
	}
	deletions, err := s.Store.ListPlannerTodoDeletions(ctx, user.ID, since)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list deleted todos: %v", err)
	}
	response := &v1pb.ListTodoChangesResponse{
		Todos:            make([]*v1pb.Todo, 0, len(todos)),
		DeletedTodos:     make([]*v1pb.DeletedTodo, 0, len(deletions)),
		NextUpdatedSince: timestamppb.New(now),
	}
	for _, todo := range todos {
		response.Todos = append(response.Todos, convertTodoFromStore(todo))
	}
	for _, deletion := range deletions {
		response.DeletedTodos = append(response.DeletedTodos, &v1pb.DeletedTodo{
			Name: todoNamePrefix + deletion.UID, DeleteTime: timestamppb.New(time.Unix(deletion.DeletedTs, 0)),
		})
	}
	return response, nil
}

func (s *APIV1Service) ListTodoTags(ctx context.Context, _ *v1pb.ListTodoTagsRequest) (*v1pb.ListTodoTagsResponse, error) {
	user, err := s.plannerUser(ctx)
	if err != nil {
		return nil, err
	}
	tags, err := s.Store.ListPlannerTodoTags(ctx, user.ID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list todo tags: %v", err)
	}
	return &v1pb.ListTodoTagsResponse{Tags: tags}, nil
}

// Check-ins.

func (s *APIV1Service) SetCheckIn(ctx context.Context, request *v1pb.SetCheckInRequest) (*v1pb.CheckIn, error) {
	user, err := s.plannerUser(ctx)
	if err != nil {
		return nil, err
	}
	if request.CheckIn == nil {
		return nil, status.Errorf(codes.InvalidArgument, "check_in is required")
	}
	habit, err := s.getOwnHabit(ctx, user, request.CheckIn.Habit)
	if err != nil {
		return nil, err
	}
	date, err := parsePlannerDate(request.CheckIn.Date, "date", false)
	if err != nil {
		return nil, err
	}
	inUse, err := s.habitInUse(ctx, user, habit.ID, date)
	if err != nil {
		return nil, err
	}
	if !inUse {
		return nil, status.Errorf(codes.FailedPrecondition, "the habit is not in use on %s", date)
	}
	// A check-in records what has happened, so it cannot be for a day still ahead. The caller's day is
	// unknown here; no time zone is past UTC+14, so a later date is in the future everywhere.
	if latest := s.now().UTC().Add(14 * time.Hour).Format(time.DateOnly); date > latest {
		return nil, status.Errorf(codes.InvalidArgument, "cannot check in for a future day: %s", date)
	}
	note, err := checkPlannerText(request.CheckIn.Note, "note", plannerMaxTitleLength, false)
	if err != nil {
		return nil, err
	}
	if r := request.CheckIn.Rating; r != nil && (*r < 0 || *r > plannerMaxRating) {
		return nil, status.Errorf(codes.InvalidArgument, "rating must be between 0 and %d", plannerMaxRating)
	}
	agent := plannerAgent(ctx)

	existing, err := s.checkInOn(ctx, user, habit.ID, date)
	if err != nil {
		return nil, err
	}
	var kept *store.PlannerWorkout
	if existing != nil {
		kept = existing.Workout
	}
	setWorkout := request.CheckIn.Workout != nil
	workout, err := s.plannerWorkoutFromRequest(ctx, user, request.CheckIn.Workout, kept)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		// The note is the maker's: a todo's check-in carries the todo's, and an agent changes only its own. The
		// workout is detail anyone may add, so a request that sets one keeps the note it cannot change.
		if reason := checkInNoteLocked(existing, agent); reason != "" && note != existing.Note {
			if !setWorkout {
				return nil, status.Errorf(codes.FailedPrecondition, "%s", reason)
			}
			note = existing.Note
		}
		if !setWorkout {
			workout = existing.Workout
		}
		existing.Note, existing.Workout = note, workout
		if request.CheckIn.Rating != nil {
			existing.Rating = *request.CheckIn.Rating
		}
		checkIn, err := s.Store.UpsertPlannerCheckIn(ctx, existing)
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to set check-in: %v", err)
		}
		return convertCheckInFromStore(checkIn, habit.UID), nil
	}

	// An open habit todo that day is how the habit gets checked in: completing it does that. In the app the
	// user ticks the todo; an agent reporting the session completes it on their behalf.
	todo, err := s.habitTodoOn(ctx, user, habit.ID, date)
	if err != nil {
		return nil, err
	}
	if todo != nil && todo.Status == store.PlannerTodoActive {
		if !agent {
			return nil, status.Errorf(codes.FailedPrecondition, "the habit has a todo on %s; complete it to check in", date)
		}
		return s.completeHabitTodoAsAgent(ctx, user, habit, todo, note, workout, request.CheckIn.GetRating())
	}
	checkIn, err := s.Store.UpsertPlannerCheckIn(ctx, &store.PlannerCheckIn{
		CreatorID: user.ID, HabitID: habit.ID, Date: date, Note: note, Source: plannerCheckInSourceFor(ctx), Workout: workout,
		Rating: request.CheckIn.GetRating(),
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to set check-in: %v", err)
	}
	return convertCheckInFromStore(checkIn, habit.UID), nil
}

// checkInNoteLocked says why the caller cannot change an existing check-in's note, or "" when it can.
func checkInNoteLocked(existing *store.PlannerCheckIn, agent bool) string {
	if agent && existing.Source != store.PlannerCheckInAgent {
		return "this check-in was made in the app; an agent can only set its workout"
	}
	if !agent && existing.TodoID != 0 && existing.Source != store.PlannerCheckInAgent {
		return "this check-in was made by completing a todo; delete the todo to remove it"
	}
	return ""
}

// completeHabitTodoAsAgent completes the habit todo due that day with an agent's check-in, which carries the
// workout and, without a note of its own, the todo's title.
func (s *APIV1Service) completeHabitTodoAsAgent(ctx context.Context, user *store.User, habit *store.PlannerHabit, todo *store.PlannerTodo, note string, workout *store.PlannerWorkout, rating int32) (*v1pb.CheckIn, error) {
	if note == "" {
		note = todo.Title
	}
	done, closedSec, overdue, reason := store.PlannerTodoDone, s.now().Unix(), false, ""
	_, err := s.Store.UpdatePlannerTodo(ctx, &store.UpdatePlannerTodo{
		ID: todo.ID, Status: &done, ClosedTs: &closedSec, ClosedOverdue: &overdue, CancelReason: &reason,
		CheckIn: &store.PlannerCheckIn{
			CreatorID: user.ID, HabitID: habit.ID, Date: todo.Date, Note: note, Source: store.PlannerCheckInAgent, Workout: workout, Rating: rating,
		},
	})
	if errors.Is(err, store.ErrPlannerCheckInTaken) {
		return nil, status.Errorf(codes.FailedPrecondition, "the habit is already checked in on %s", todo.Date)
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to complete the habit todo: %v", err)
	}
	checkIn, err := s.checkInOn(ctx, user, habit.ID, todo.Date)
	if err != nil {
		return nil, err
	}
	return convertCheckInFromStore(checkIn, habit.UID), nil
}

func (s *APIV1Service) DeleteCheckIn(ctx context.Context, request *v1pb.DeleteCheckInRequest) (*emptypb.Empty, error) {
	user, err := s.plannerUser(ctx)
	if err != nil {
		return nil, err
	}
	habit, err := s.getOwnHabit(ctx, user, request.Habit)
	if err != nil {
		return nil, err
	}
	date, err := parsePlannerDate(request.Date, "date", false)
	if err != nil {
		return nil, err
	}
	existing, err := s.checkInOn(ctx, user, habit.ID, date)
	if err != nil || existing == nil {
		return &emptypb.Empty{}, err
	}
	if plannerAgent(ctx) && existing.Source != store.PlannerCheckInAgent {
		return nil, status.Errorf(codes.PermissionDenied, "an agent can only remove check-ins an agent made")
	}
	if existing.TodoID != 0 {
		if existing.Source != store.PlannerCheckInAgent {
			return nil, status.Errorf(codes.FailedPrecondition, "this check-in was made by completing a todo; delete the todo to remove it")
		}
		// An agent completed the todo with this check-in: undoing it reopens the todo.
		active, closedTs, overdue, reason := store.PlannerTodoActive, int64(0), false, ""
		if _, err := s.Store.UpdatePlannerTodo(ctx, &store.UpdatePlannerTodo{
			ID: existing.TodoID, Status: &active, ClosedTs: &closedTs, ClosedOverdue: &overdue, CancelReason: &reason, DropCheckIn: true,
		}); err != nil {
			return nil, status.Errorf(codes.Internal, "failed to reopen the habit todo: %v", err)
		}
		return &emptypb.Empty{}, nil
	}
	if err := s.Store.DeletePlannerCheckIn(ctx, habit.ID, date); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to delete check-in: %v", err)
	}
	return &emptypb.Empty{}, nil
}

// Todos.

func (s *APIV1Service) GetTodo(ctx context.Context, request *v1pb.GetTodoRequest) (*v1pb.Todo, error) {
	user, err := s.plannerUser(ctx)
	if err != nil {
		return nil, err
	}
	todo, err := s.getOwnTodo(ctx, user, request.Name)
	if err != nil {
		return nil, err
	}
	return convertTodoFromStore(todo), nil
}

// plannerTodoFields checks the user-editable fields shared by create and import.
func plannerTodoFields(todo *v1pb.Todo) (*store.PlannerTodo, error) {
	title, err := checkPlannerText(todo.Title, "title", plannerMaxTitleLength, true)
	if err != nil {
		return nil, err
	}
	date, err := parsePlannerDate(todo.Date, "date", true)
	if err != nil {
		return nil, err
	}
	tag, err := checkPlannerText(todo.Tag, "tag", plannerMaxTagLength, false)
	if err != nil {
		return nil, err
	}
	note, err := checkPlannerText(todo.Note, "note", plannerMaxTextLength, false)
	if err != nil {
		return nil, err
	}
	memos, err := todoMemos(todo)
	if err != nil {
		return nil, err
	}
	link, err := checkPlannerURL(todo.Url)
	if err != nil {
		return nil, err
	}
	return &store.PlannerTodo{
		Title:     title,
		Date:      date,
		Status:    store.PlannerTodoActive,
		Important: todo.Important,
		Tag:       tag,
		Note:      note,
		MemoNames: memos,
		URL:       link,
	}, nil
}

func (s *APIV1Service) CreateTodo(ctx context.Context, request *v1pb.CreateTodoRequest) (*v1pb.Todo, error) {
	user, err := s.plannerUser(ctx)
	if err != nil {
		return nil, err
	}
	if request.Todo == nil {
		return nil, status.Errorf(codes.InvalidArgument, "todo is required")
	}
	// A new todo is always active, whatever status the request carries.
	create, err := plannerTodoFields(request.Todo)
	if err != nil {
		return nil, err
	}
	create.UID = shortuuid.New()
	create.CreatorID = user.ID
	create.Source = plannerTodoSourceFor(ctx)
	if request.Todo.Habit != "" {
		if create.HabitID, err = s.checkNewHabitTodo(ctx, user, request.Todo.Habit, create.Date, request.LocalDate); err != nil {
			return nil, err
		}
	}
	todo, err := s.Store.CreatePlannerTodo(ctx, create)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to create todo: %v", err)
	}
	return convertTodoFromStore(todo), nil
}

// checkNewHabitTodo enforces the habit todo rules on creation and returns the habit's ID: it is for a day
// from today on when the habit is in use, one per habit per day, and none once the habit is checked in.
func (s *APIV1Service) checkNewHabitTodo(ctx context.Context, user *store.User, habitName, date, localDate string) (int32, error) {
	local, err := parsePlannerDate(localDate, "local_date", false)
	if err != nil {
		return 0, err
	}
	if date == "" || date < local {
		return 0, status.Errorf(codes.InvalidArgument, "a habit todo is for a date from today on")
	}
	habit, err := s.getOwnHabit(ctx, user, habitName)
	if err != nil {
		return 0, err
	}
	if err := s.checkHabitTodoDay(ctx, user, habit.ID, date); err != nil {
		return 0, err
	}
	return habit.ID, nil
}

// checkHabitTodoDay says whether a habit todo can be on a date, made there or postponed to it: the habit is in
// use that day, has no todo there yet and is not checked in.
func (s *APIV1Service) checkHabitTodoDay(ctx context.Context, user *store.User, habitID int32, date string) error {
	inUse, err := s.habitInUse(ctx, user, habitID, date)
	if err != nil {
		return err
	}
	if !inUse {
		return status.Errorf(codes.FailedPrecondition, "the habit is not in use on %s", date)
	}
	existing, err := s.habitTodoOn(ctx, user, habitID, date)
	if err != nil {
		return err
	}
	if existing != nil {
		return status.Errorf(codes.AlreadyExists, "the habit already has a todo on %s", date)
	}
	checkIns, err := s.Store.ListPlannerCheckIns(ctx, &store.FindPlannerCheckIn{CreatorID: user.ID, HabitID: &habitID, StartDate: date, EndDate: date})
	if err != nil {
		return status.Errorf(codes.Internal, "failed to get check-in: %v", err)
	}
	if len(checkIns) > 0 {
		return status.Errorf(codes.FailedPrecondition, "the habit is already checked in on %s", date)
	}
	return nil
}

func (s *APIV1Service) UpdateTodo(ctx context.Context, request *v1pb.UpdateTodoRequest) (*v1pb.Todo, error) {
	user, err := s.plannerUser(ctx)
	if err != nil {
		return nil, err
	}
	if request.Todo == nil || request.UpdateMask == nil || len(request.UpdateMask.Paths) == 0 {
		return nil, status.Errorf(codes.InvalidArgument, "todo and update_mask are required")
	}
	todo, err := s.getOwnTodo(ctx, user, request.Todo.Name)
	if err != nil {
		return nil, err
	}

	update := &store.UpdatePlannerTodo{ID: todo.ID}
	title := todo.Title
	date := todo.Date
	nextStatus := todo.Status
	reason := todo.CancelReason
	reasonInMask := false
	for _, path := range request.UpdateMask.Paths {
		switch path {
		case "title":
			if title, err = checkPlannerText(request.Todo.Title, "title", plannerMaxTitleLength, true); err != nil {
				return nil, err
			}
			update.Title = &title
		case "date":
			// A habit todo changes day only by postponing, which checks the new day and keeps the original.
			if todo.HabitID != 0 {
				return nil, status.Errorf(codes.FailedPrecondition, "a habit todo keeps its date; postpone it instead")
			}
			if date, err = parsePlannerDate(request.Todo.Date, "date", true); err != nil {
				return nil, err
			}
			update.Date = &date
		case "status":
			stored, ok := todoStatusToStore[request.Todo.Status]
			if !ok {
				return nil, status.Errorf(codes.InvalidArgument, "status must be ACTIVE, DONE or CANCELLED")
			}
			nextStatus = stored
		case "cancel_reason":
			if reason, err = checkPlannerText(request.Todo.CancelReason, "cancel_reason", plannerMaxTextLength, false); err != nil {
				return nil, err
			}
			reasonInMask = true
		case "important":
			update.Important = &request.Todo.Important
		case "tag":
			tag, err := checkPlannerText(request.Todo.Tag, "tag", plannerMaxTagLength, false)
			if err != nil {
				return nil, err
			}
			update.Tag = &tag
		case "note":
			note, err := checkPlannerText(request.Todo.Note, "note", plannerMaxTextLength, false)
			if err != nil {
				return nil, err
			}
			update.Note = &note
		case "memos":
			memos, err := checkPlannerMemos(request.Todo.Memos)
			if err != nil {
				return nil, err
			}
			update.MemoNames = &memos
		case "memo":
			// The deprecated path: the one document becomes the whole list.
			memos, err := checkPlannerMemos([]string{request.Todo.Memo}) //nolint:staticcheck
			if err != nil {
				return nil, err
			}
			update.MemoNames = &memos
		case "url":
			link, err := checkPlannerURL(request.Todo.Url)
			if err != nil {
				return nil, err
			}
			update.URL = &link
		case "planned_workout":
			if err := checkPlannableTodo(todo, request.LocalDate); err != nil {
				return nil, err
			}
			if err := s.setPlannedWorkout(ctx, user, update, todo, request.Todo.PlannedWorkout); err != nil {
				return nil, err
			}
		default:
			return nil, status.Errorf(codes.InvalidArgument, "unsupported update_mask path: %s", path)
		}
	}

	// A todo that has checked in its habit is settled: only deleting it, check-in and all, undoes that.
	if todo.CheckInDate != "" && nextStatus != todo.Status {
		return nil, status.Errorf(codes.FailedPrecondition, "this todo checked in its habit; it can only be deleted now")
	}
	if err := s.applyTodoStatus(update, todo, nextStatus, reason, reasonInMask, date, request.LocalDate); err != nil {
		return nil, err
	}
	if nextStatus == store.PlannerTodoDone && todo.Status != store.PlannerTodoDone && todo.HabitID != 0 {
		if update.CheckIn, err = s.habitTodoCheckIn(ctx, user, todo, title, request.LocalDate); err != nil {
			return nil, err
		}
		if update.CheckIn != nil && plannerAgent(ctx) {
			update.CheckIn.Source = store.PlannerCheckInAgent
		}
	}
	updated, err := s.Store.UpdatePlannerTodo(ctx, update)
	if errors.Is(err, store.ErrPlannerCheckInTaken) {
		return nil, status.Errorf(codes.FailedPrecondition, "the habit is already checked in on %s", update.CheckIn.Date)
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to update todo: %v", err)
	}
	return convertTodoFromStore(updated), nil
}

// applyTodoStatus enforces the todo rules on an update:
//   - closing (to done or cancelled) records the close time and whether the
//     todo's date had already passed on the caller's local date;
//   - a cancelled todo always has a reason;
//   - reopening clears the close time, the overdue mark and the reason.
func (s *APIV1Service) applyTodoStatus(update *store.UpdatePlannerTodo, todo *store.PlannerTodo, next, reason string, reasonInMask bool, date, localDate string) error {
	if next == store.PlannerTodoCancelled && reason == "" {
		return status.Errorf(codes.InvalidArgument, "cancelling a todo needs a cancel_reason")
	}
	if next == todo.Status {
		if reasonInMask {
			if next != store.PlannerTodoCancelled {
				return status.Errorf(codes.InvalidArgument, "only a cancelled todo has a cancel_reason")
			}
			update.CancelReason = &reason
		}
		return nil
	}

	update.Status = &next
	if next == store.PlannerTodoActive {
		closedTs, overdue, empty := int64(0), false, ""
		update.ClosedTs, update.ClosedOverdue, update.CancelReason = &closedTs, &overdue, &empty
		return nil
	}

	local, err := parsePlannerDate(localDate, "local_date", false)
	if err != nil {
		return status.Errorf(codes.InvalidArgument, "closing a todo needs the caller's local_date in YYYY-MM-DD form")
	}
	closedTs := s.now().Unix()
	overdue := date != "" && date < local
	if next == store.PlannerTodoDone {
		reason = ""
	}
	update.ClosedTs, update.ClosedOverdue, update.CancelReason = &closedTs, &overdue, &reason
	return nil
}

func (s *APIV1Service) PostponeTodo(ctx context.Context, request *v1pb.PostponeTodoRequest) (*v1pb.Todo, error) {
	user, err := s.plannerUser(ctx)
	if err != nil {
		return nil, err
	}
	todo, err := s.getOwnTodo(ctx, user, request.Name)
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
	if todo.Status != store.PlannerTodoActive || todo.Date == "" {
		return nil, status.Errorf(codes.FailedPrecondition, "only an active todo with a date can be postponed")
	}
	if date == todo.Date || date < local {
		return nil, status.Errorf(codes.InvalidArgument, "date must differ from the current one and not be before local_date")
	}
	// A habit todo moves to a day that could take a new one; a missed one can still move, which saves it from failing.
	if todo.HabitID != 0 {
		if err := s.checkHabitTodoDay(ctx, user, todo.HabitID, date); err != nil {
			return nil, err
		}
	}

	originalDate := todo.OriginalDate
	if originalDate == "" {
		originalDate = todo.Date
	}
	count := todo.PostponeCount + 1
	updated, err := s.Store.UpdatePlannerTodo(ctx, &store.UpdatePlannerTodo{
		ID: todo.ID, Date: &date, OriginalDate: &originalDate, PostponeCount: &count,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to postpone todo: %v", err)
	}
	return convertTodoFromStore(updated), nil
}

func (s *APIV1Service) DeleteTodo(ctx context.Context, request *v1pb.DeleteTodoRequest) (*emptypb.Empty, error) {
	user, err := s.plannerUser(ctx)
	if err != nil {
		return nil, err
	}
	todo, err := s.getOwnTodo(ctx, user, request.Name)
	if err != nil {
		return nil, err
	}
	// A bot may take back a todo it made (the user changed their mind), never one the user made.
	if plannerAgent(ctx) && todo.Source != store.PlannerCheckInAgent {
		return nil, status.Errorf(codes.PermissionDenied, "an agent can only delete the todos an agent created")
	}
	if err := s.Store.DeletePlannerTodo(ctx, todo.ID); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to delete todo: %v", err)
	}
	return &emptypb.Empty{}, nil
}

// Notes.

func (s *APIV1Service) GetPlannerNote(ctx context.Context, request *v1pb.GetPlannerNoteRequest) (*v1pb.PlannerNote, error) {
	user, err := s.plannerUser(ctx)
	if err != nil {
		return nil, err
	}
	note, err := s.getOwnPlannerNote(ctx, user, request.Name)
	if err != nil {
		return nil, err
	}
	return convertPlannerNoteFromStore(note), nil
}

func (s *APIV1Service) CreatePlannerNote(ctx context.Context, request *v1pb.CreatePlannerNoteRequest) (*v1pb.PlannerNote, error) {
	user, err := s.plannerUser(ctx)
	if err != nil {
		return nil, err
	}
	if request.Note == nil {
		return nil, status.Errorf(codes.InvalidArgument, "note is required")
	}
	date, err := parsePlannerDate(request.Note.Date, "date", false)
	if err != nil {
		return nil, err
	}
	content, err := checkPlannerText(request.Note.Content, "content", plannerMaxTextLength, true)
	if err != nil {
		return nil, err
	}
	remark, err := checkPlannerText(request.Note.Remark, "remark", plannerMaxTextLength, false)
	if err != nil {
		return nil, err
	}
	memos, err := checkPlannerMemos(request.Note.Memos)
	if err != nil {
		return nil, err
	}
	note, err := s.Store.CreatePlannerNote(ctx, &store.PlannerNote{
		UID: shortuuid.New(), CreatorID: user.ID, Date: date, Content: content, Remark: remark, MemoNames: memos,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to create note: %v", err)
	}
	return convertPlannerNoteFromStore(note), nil
}

func (s *APIV1Service) UpdatePlannerNote(ctx context.Context, request *v1pb.UpdatePlannerNoteRequest) (*v1pb.PlannerNote, error) {
	user, err := s.plannerUser(ctx)
	if err != nil {
		return nil, err
	}
	if request.Note == nil || request.UpdateMask == nil || len(request.UpdateMask.Paths) == 0 {
		return nil, status.Errorf(codes.InvalidArgument, "note and update_mask are required")
	}
	note, err := s.getOwnPlannerNote(ctx, user, request.Note.Name)
	if err != nil {
		return nil, err
	}
	update := &store.UpdatePlannerNote{ID: note.ID}
	for _, path := range request.UpdateMask.Paths {
		switch path {
		case "date":
			date, err := parsePlannerDate(request.Note.Date, "date", false)
			if err != nil {
				return nil, err
			}
			update.Date = &date
		case "content":
			content, err := checkPlannerText(request.Note.Content, "content", plannerMaxTextLength, true)
			if err != nil {
				return nil, err
			}
			update.Content = &content
		case "remark":
			remark, err := checkPlannerText(request.Note.Remark, "remark", plannerMaxTextLength, false)
			if err != nil {
				return nil, err
			}
			update.Remark = &remark
		case "memos":
			memos, err := checkPlannerMemos(request.Note.Memos)
			if err != nil {
				return nil, err
			}
			update.MemoNames = &memos
		default:
			return nil, status.Errorf(codes.InvalidArgument, "unsupported update_mask path: %s", path)
		}
	}
	updated, err := s.Store.UpdatePlannerNote(ctx, update)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to update note: %v", err)
	}
	return convertPlannerNoteFromStore(updated), nil
}

func (s *APIV1Service) DeletePlannerNote(ctx context.Context, request *v1pb.DeletePlannerNoteRequest) (*emptypb.Empty, error) {
	user, err := s.plannerUser(ctx)
	if err != nil {
		return nil, err
	}
	note, err := s.getOwnPlannerNote(ctx, user, request.Name)
	if err != nil {
		return nil, err
	}
	if err := s.Store.DeletePlannerNote(ctx, note.ID); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to delete note: %v", err)
	}
	return &emptypb.Empty{}, nil
}

// Import.

func (s *APIV1Service) ImportPlanner(ctx context.Context, request *v1pb.ImportPlannerRequest) (*v1pb.ImportPlannerResponse, error) {
	user, err := s.plannerUser(ctx)
	if err != nil {
		return nil, err
	}
	if len(request.Habits)+len(request.CheckIns)+len(request.Todos)+len(request.Notes) > plannerMaxImportedRows {
		return nil, status.Errorf(codes.InvalidArgument, "an import holds at most %d records", plannerMaxImportedRows)
	}

	data := &store.PlannerImport{CreatorID: user.ID}
	for i, habit := range request.Habits {
		title, err := checkPlannerText(habit.GetTitle(), "habit title", plannerMaxTitleLength, true)
		if err != nil {
			return nil, err
		}
		data.Habits = append(data.Habits, &store.PlannerHabit{
			UID: shortuuid.New(), Name: title, Position: int32(i), Color: int32(i % plannerHabitColors),
			Archived: habit.GetArchived(), //nolint:staticcheck // an import still says which habits were archived
		})
	}
	seen := map[string]bool{}
	for _, checkIn := range request.CheckIns {
		if checkIn.HabitIndex < 0 || int(checkIn.HabitIndex) >= len(data.Habits) {
			return nil, status.Errorf(codes.InvalidArgument, "check-in on %s names habit %d, which is not in the import", checkIn.Date, checkIn.HabitIndex)
		}
		date, err := parsePlannerDate(checkIn.Date, "check-in date", false)
		if err != nil {
			return nil, err
		}
		note, err := checkPlannerText(checkIn.Note, "check-in note", plannerMaxTitleLength, false)
		if err != nil {
			return nil, err
		}
		key := date + "/" + data.Habits[checkIn.HabitIndex].UID
		if seen[key] {
			return nil, status.Errorf(codes.InvalidArgument, "habit %d is checked in twice on %s", checkIn.HabitIndex, date)
		}
		seen[key] = true
		data.CheckIns = append(data.CheckIns, &store.PlannerImportCheckIn{HabitIndex: int(checkIn.HabitIndex), Date: date, Note: note})
	}
	for _, imported := range request.Todos {
		if imported.GetTodo() == nil {
			return nil, status.Errorf(codes.InvalidArgument, "an imported todo is empty")
		}
		todo, err := plannerTodoFields(imported.Todo)
		if err != nil {
			return nil, err
		}
		if imported.Todo.Status != v1pb.Todo_STATUS_UNSPECIFIED {
			stored, ok := todoStatusToStore[imported.Todo.Status]
			if !ok {
				return nil, status.Errorf(codes.InvalidArgument, "status must be ACTIVE, DONE or CANCELLED")
			}
			todo.Status = stored
		}
		if todo.Status == store.PlannerTodoCancelled {
			if todo.CancelReason, err = checkPlannerText(imported.Todo.CancelReason, "cancel_reason", plannerMaxTextLength, true); err != nil {
				return nil, err
			}
		}
		// The close time of an imported todo is unknown; only the overdue mark carries over.
		todo.ClosedOverdue = todo.Status != store.PlannerTodoActive && imported.ClosedOverdue
		todo.UID = shortuuid.New()
		data.Todos = append(data.Todos, todo)
	}
	for _, note := range request.Notes {
		date, err := parsePlannerDate(note.GetDate(), "note date", false)
		if err != nil {
			return nil, err
		}
		content, err := checkPlannerText(note.GetContent(), "note content", plannerMaxTextLength, true)
		if err != nil {
			return nil, err
		}
		data.Notes = append(data.Notes, &store.PlannerNote{UID: shortuuid.New(), Date: date, Content: content})
	}

	if err := s.Store.ImportPlanner(ctx, data); err != nil {
		if errors.Is(err, store.ErrPlannerNotEmpty) {
			return nil, status.Errorf(codes.FailedPrecondition, "the planner already has data; an import only runs into an empty planner")
		}
		return nil, status.Errorf(codes.Internal, "failed to import planner: %v", err)
	}
	return &v1pb.ImportPlannerResponse{
		HabitCount:   int32(len(data.Habits)),
		CheckInCount: int32(len(data.CheckIns)),
		TodoCount:    int32(len(data.Todos)),
		NoteCount:    int32(len(data.Notes)),
	}, nil
}
