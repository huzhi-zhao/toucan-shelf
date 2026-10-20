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
		Archived:   h.Archived,
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
		Name:          todoNamePrefix + t.UID,
		Title:         t.Title,
		Date:          t.Date,
		Status:        todoStatusFromStore(t.Status),
		ClosedOverdue: t.ClosedOverdue,
		CloseTime:     optionalTimestamp(t.ClosedTs),
		CancelReason:  t.CancelReason,
		Important:     t.Important,
		Tag:           t.Tag,
		Note:          t.Note,
		Memo:          firstMemo(t.MemoNames), //nolint:staticcheck // still filled for clients that only know it
		Memos:         t.MemoNames,
		Url:           t.URL,
		OriginalDate:  t.OriginalDate,
		PostponeCount: t.PostponeCount,
		Habit:         plannerName(habitNamePrefix, t.HabitUID),
		CheckInDate:   t.CheckInDate,
		CreateTime:    optionalTimestamp(t.CreatedTs),
		UpdateTime:    optionalTimestamp(t.UpdatedTs),
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
		Habit: habitNamePrefix + habitUID,
		Date:  c.Date,
		Note:  c.Note,
		Todo:  plannerName(todoNamePrefix, c.TodoUID),
	}
}

func convertPlannerNoteFromStore(n *store.PlannerNote) *v1pb.PlannerNote {
	return &v1pb.PlannerNote{
		Name:       plannerNoteNamePrefix + n.UID,
		Date:       n.Date,
		Content:    n.Content,
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
	habit, err := s.Store.CreatePlannerHabit(ctx, &store.PlannerHabit{
		UID:       shortuuid.New(),
		CreatorID: user.ID,
		Name:      title,
		Position:  position,
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
		case "position":
			update.Position = &request.Habit.Position
		case "archived":
			update.Archived = &request.Habit.Archived
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
	if habit.Archived {
		return nil, status.Errorf(codes.FailedPrecondition, "an archived habit takes no new check-ins")
	}
	date, err := parsePlannerDate(request.CheckIn.Date, "date", false)
	if err != nil {
		return nil, err
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
	if err := s.refuseTodoCheckIn(ctx, user, habit, date); err != nil {
		return nil, err
	}
	checkIn, err := s.Store.UpsertPlannerCheckIn(ctx, &store.PlannerCheckIn{CreatorID: user.ID, HabitID: habit.ID, Date: date, Note: note})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to set check-in: %v", err)
	}
	return convertCheckInFromStore(checkIn, habit.UID), nil
}

// refuseTodoCheckIn fails when the habit's check-in on date was made by a todo: that one belongs to the
// todo, and changes or goes only with it.
func (s *APIV1Service) refuseTodoCheckIn(ctx context.Context, user *store.User, habit *store.PlannerHabit, date string) error {
	existing, err := s.Store.ListPlannerCheckIns(ctx, &store.FindPlannerCheckIn{CreatorID: user.ID, HabitID: &habit.ID, StartDate: date, EndDate: date})
	if err != nil {
		return status.Errorf(codes.Internal, "failed to get check-in: %v", err)
	}
	if len(existing) > 0 && existing[0].TodoID != 0 {
		return status.Errorf(codes.FailedPrecondition, "this check-in was made by completing a todo; delete the todo to remove it")
	}
	return nil
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
	if err := s.refuseTodoCheckIn(ctx, user, habit, date); err != nil {
		return nil, err
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
	todo, err := s.Store.CreatePlannerTodo(ctx, create)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to create todo: %v", err)
	}
	return convertTodoFromStore(todo), nil
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
	habitID := todo.HabitID
	for _, path := range request.UpdateMask.Paths {
		switch path {
		case "title":
			if title, err = checkPlannerText(request.Todo.Title, "title", plannerMaxTitleLength, true); err != nil {
				return nil, err
			}
			update.Title = &title
		case "date":
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
		case "habit":
			habitID = 0
			if request.Todo.Habit != "" {
				habit, err := s.getOwnHabit(ctx, user, request.Todo.Habit)
				if err != nil {
					return nil, err
				}
				habitID = habit.ID
			}
			update.HabitID = &habitID
		default:
			return nil, status.Errorf(codes.InvalidArgument, "unsupported update_mask path: %s", path)
		}
	}

	// A todo that has checked in its habit is settled: only deleting it, check-in and all, undoes that.
	if todo.CheckInDate != "" && (nextStatus != todo.Status || habitID != todo.HabitID) {
		return nil, status.Errorf(codes.FailedPrecondition, "this todo checked in its habit; it can only be deleted now")
	}
	if habitID != todo.HabitID && habitID != 0 {
		if err := s.checkTodoHabitLink(ctx, user, todo, habitID, request.LocalDate); err != nil {
			return nil, err
		}
	}
	if err := s.applyTodoStatus(update, todo, nextStatus, reason, reasonInMask, date, request.LocalDate); err != nil {
		return nil, err
	}
	// Completing checks in the linked habit on the caller's day, noted with the todo's title. An archived
	// habit takes no new check-ins, so the todo then just closes.
	if nextStatus == store.PlannerTodoDone && todo.Status != store.PlannerTodoDone && habitID != 0 {
		habit, err := s.Store.GetPlannerHabit(ctx, &store.FindPlannerHabit{ID: &habitID, CreatorID: &user.ID})
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to get habit: %v", err)
		}
		if habit != nil && !habit.Archived {
			update.CheckIn = &store.PlannerCheckIn{CreatorID: user.ID, HabitID: habit.ID, Date: request.LocalDate, Note: title}
		}
	}
	updated, err := s.Store.UpdatePlannerTodo(ctx, update)
	if errors.Is(err, store.ErrPlannerCheckInTaken) {
		return nil, status.Errorf(codes.FailedPrecondition, "the linked habit is already checked in on %s", request.LocalDate)
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to update todo: %v", err)
	}
	return convertTodoFromStore(updated), nil
}

// checkTodoHabitLink enforces who may link a habit: an open todo, to an active habit that no other open
// todo holds and that is not checked in on the caller's day yet. Otherwise completing the todo could not
// check the habit in.
func (s *APIV1Service) checkTodoHabitLink(ctx context.Context, user *store.User, todo *store.PlannerTodo, habitID int32, localDate string) error {
	if todo.Status != store.PlannerTodoActive {
		return status.Errorf(codes.FailedPrecondition, "only an open todo can link a habit")
	}
	local, err := parsePlannerDate(localDate, "local_date", false)
	if err != nil {
		return status.Errorf(codes.InvalidArgument, "linking a habit needs the caller's local_date in YYYY-MM-DD form")
	}
	habit, err := s.Store.GetPlannerHabit(ctx, &store.FindPlannerHabit{ID: &habitID, CreatorID: &user.ID})
	if err != nil {
		return status.Errorf(codes.Internal, "failed to get habit: %v", err)
	}
	if habit == nil {
		return status.Errorf(codes.NotFound, "habit not found")
	}
	if habit.Archived {
		return status.Errorf(codes.FailedPrecondition, "an archived habit cannot be linked")
	}
	active := store.PlannerTodoActive
	holders, err := s.Store.ListPlannerTodos(ctx, &store.FindPlannerTodo{CreatorID: &user.ID, HabitID: &habitID, Status: &active})
	if err != nil {
		return status.Errorf(codes.Internal, "failed to list todos: %v", err)
	}
	for _, holder := range holders {
		if holder.ID != todo.ID {
			return status.Errorf(codes.FailedPrecondition, "the habit is already linked to another open todo: %s", holder.Title)
		}
	}
	checkIns, err := s.Store.ListPlannerCheckIns(ctx, &store.FindPlannerCheckIn{CreatorID: user.ID, HabitID: &habitID, StartDate: local, EndDate: local})
	if err != nil {
		return status.Errorf(codes.Internal, "failed to get check-in: %v", err)
	}
	if len(checkIns) > 0 {
		return status.Errorf(codes.FailedPrecondition, "the habit is already checked in on %s", local)
	}
	return nil
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
	if err := s.Store.DeletePlannerTodo(ctx, todo.ID); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to delete todo: %v", err)
	}
	return &emptypb.Empty{}, nil
}

// Notes.

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
	note, err := s.Store.CreatePlannerNote(ctx, &store.PlannerNote{UID: shortuuid.New(), CreatorID: user.ID, Date: date, Content: content})
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
		data.Habits = append(data.Habits, &store.PlannerHabit{UID: shortuuid.New(), Name: title, Position: int32(i), Archived: habit.GetArchived()})
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
