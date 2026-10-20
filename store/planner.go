package store

import (
	"context"

	"github.com/pkg/errors"
)

// The planner keeps a user's habits, daily check-ins, todos and notes. It is
// personal data, unrelated to the knowledge base: every row belongs to its
// creator and nothing references documents or workspaces by key. See
// docs/dev/requirements/planner-and-check-in.md.
//
// Dates are "YYYY-MM-DD" in the user's phone-local calendar and are stored as
// given; the server never converts them.

// Todo statuses. "Overdue" is not one of them: it is an active todo whose date
// has passed, and only the client knows the user's local date.
const (
	PlannerTodoActive    = "active"
	PlannerTodoDone      = "done"
	PlannerTodoCancelled = "cancelled"
)

// ErrPlannerNotEmpty is returned by ImportPlanner when the user already has
// planner data: an import is a one-time backfill and must not run twice.
var ErrPlannerNotEmpty = errors.New("planner already has data")

// ErrPlannerCheckInTaken is returned by UpdatePlannerTodo when the check-in it
// should add already exists: the habit was checked in that day.
var ErrPlannerCheckInTaken = errors.New("habit already checked in on that day")

// PlannerHabit is a long-running habit the user checks in against.
type PlannerHabit struct {
	ID        int32
	UID       string
	CreatorID int32
	Name      string
	// Position orders habits; it also decides each habit's colour on the calendar.
	Position int32
	// Archived hides the habit from new check-ins; its history stays visible.
	Archived  bool
	CreatedTs int64
	UpdatedTs int64
}

// FindPlannerHabit filters habits. Callers always scope by CreatorID.
type FindPlannerHabit struct {
	ID        *int32
	UID       *string
	CreatorID *int32
}

// UpdatePlannerHabit changes the given fields of one habit.
type UpdatePlannerHabit struct {
	ID       int32
	Name     *string
	Position *int32
	Archived *bool
}

// PlannerCheckIn records that a habit was kept on a day. There is at most one
// per habit per day.
type PlannerCheckIn struct {
	ID        int32
	CreatorID int32
	HabitID   int32
	Date      string
	Note      string
	// TodoID is the todo whose completion made the check-in, or 0 for one checked in by hand.
	TodoID int32
	// TodoUID is that todo's UID, or "". Read-only.
	TodoUID   string
	CreatedTs int64
	UpdatedTs int64
}

// FindPlannerCheckIn filters one user's check-ins by an inclusive date range.
// An empty bound leaves that side open.
type FindPlannerCheckIn struct {
	CreatorID int32
	HabitID   *int32
	StartDate string
	EndDate   string
}

// PlannerTodo is a plan made ahead of time.
type PlannerTodo struct {
	ID        int32
	UID       string
	CreatorID int32
	Title     string
	// Date is the day the todo is planned for, or "" for none.
	Date   string
	Status string
	// ClosedOverdue records whether the todo was closed after its date had passed.
	ClosedOverdue bool
	// ClosedTs is when the todo was closed; 0 while active, or when unknown.
	ClosedTs     int64
	CancelReason string
	Important    bool
	Tag          string
	Note         string
	// MemoNames are "memos/{uid}" of the linked documents, in display order. Plain
	// references: deleting a document leaves it dangling rather than touching the todo.
	MemoNames []string
	URL       string
	// OriginalDate is the date before the todo's first postponement, or "" if it was never postponed.
	OriginalDate  string
	PostponeCount int32
	// HabitID is the habit to check in when the todo is done, or 0 for none.
	HabitID int32
	// HabitUID is that habit's UID, or "". Read-only.
	HabitUID string
	// CheckInDate is the day of the check-in the todo's completion made, or "" for none. Read-only.
	CheckInDate string
	CreatedTs   int64
	UpdatedTs   int64
}

// FindPlannerTodo filters todos. A date bound only matches todos that have a
// date; an empty bound leaves that side open.
type FindPlannerTodo struct {
	ID        *int32
	UID       *string
	CreatorID *int32
	Status    *string
	HabitID   *int32
	StartDate string
	EndDate   string
}

// UpdatePlannerTodo changes the given fields of one todo. The API layer owns the
// status rules (a closed todo has a closed time, a cancelled one a reason); the
// store writes what it is given.
//
// CheckIn, when set, is added in the same transaction, made by this todo: it is
// how completing a todo checks in its habit. If the habit already has a check-in
// that day nothing is written and ErrPlannerCheckInTaken is returned.
type UpdatePlannerTodo struct {
	ID            int32
	Title         *string
	Date          *string
	Status        *string
	ClosedOverdue *bool
	ClosedTs      *int64
	CancelReason  *string
	Important     *bool
	Tag           *string
	Note          *string
	MemoNames     *[]string
	URL           *string
	OriginalDate  *string
	PostponeCount *int32
	HabitID       *int32
	CheckIn       *PlannerCheckIn
}

// PlannerNote is a plain record of what happened on a day.
type PlannerNote struct {
	ID        int32
	UID       string
	CreatorID int32
	Date      string
	Content   string
	CreatedTs int64
	UpdatedTs int64
}

// FindPlannerNote filters notes, like FindPlannerTodo.
type FindPlannerNote struct {
	ID        *int32
	UID       *string
	CreatorID *int32
	StartDate string
	EndDate   string
}

// UpdatePlannerNote changes the given fields of one note.
type UpdatePlannerNote struct {
	ID      int32
	Date    *string
	Content *string
}

// PlannerImport is a whole planner written in one transaction. Check-ins name
// their habit by index into Habits, since the habits have no IDs yet.
type PlannerImport struct {
	CreatorID int32
	Habits    []*PlannerHabit
	CheckIns  []*PlannerImportCheckIn
	Todos     []*PlannerTodo
	Notes     []*PlannerNote
}

// PlannerImportCheckIn is a check-in inside a PlannerImport.
type PlannerImportCheckIn struct {
	HabitIndex int
	Date       string
	Note       string
}

// CreatePlannerHabit creates a habit.
func (s *Store) CreatePlannerHabit(ctx context.Context, create *PlannerHabit) (*PlannerHabit, error) {
	return s.driver.CreatePlannerHabit(ctx, create)
}

// ListPlannerHabits returns matching habits ordered by position, then creation.
func (s *Store) ListPlannerHabits(ctx context.Context, find *FindPlannerHabit) ([]*PlannerHabit, error) {
	return s.driver.ListPlannerHabits(ctx, find)
}

// GetPlannerHabit returns the first matching habit, or nil.
func (s *Store) GetPlannerHabit(ctx context.Context, find *FindPlannerHabit) (*PlannerHabit, error) {
	list, err := s.driver.ListPlannerHabits(ctx, find)
	if err != nil || len(list) == 0 {
		return nil, err
	}
	return list[0], nil
}

// UpdatePlannerHabit changes a habit and returns it.
func (s *Store) UpdatePlannerHabit(ctx context.Context, update *UpdatePlannerHabit) (*PlannerHabit, error) {
	return s.driver.UpdatePlannerHabit(ctx, update)
}

// UpsertPlannerCheckIn records a check-in, replacing the note of an existing one
// for the same habit and day.
func (s *Store) UpsertPlannerCheckIn(ctx context.Context, upsert *PlannerCheckIn) (*PlannerCheckIn, error) {
	return s.driver.UpsertPlannerCheckIn(ctx, upsert)
}

// ListPlannerCheckIns returns matching check-ins ordered by date.
func (s *Store) ListPlannerCheckIns(ctx context.Context, find *FindPlannerCheckIn) ([]*PlannerCheckIn, error) {
	return s.driver.ListPlannerCheckIns(ctx, find)
}

// DeletePlannerCheckIn removes a habit's check-in on a day, if any.
func (s *Store) DeletePlannerCheckIn(ctx context.Context, habitID int32, date string) error {
	return s.driver.DeletePlannerCheckIn(ctx, habitID, date)
}

// CreatePlannerTodo creates a todo.
func (s *Store) CreatePlannerTodo(ctx context.Context, create *PlannerTodo) (*PlannerTodo, error) {
	return s.driver.CreatePlannerTodo(ctx, create)
}

// ListPlannerTodos returns matching todos ordered by date (undated last), then creation.
func (s *Store) ListPlannerTodos(ctx context.Context, find *FindPlannerTodo) ([]*PlannerTodo, error) {
	return s.driver.ListPlannerTodos(ctx, find)
}

// GetPlannerTodo returns the first matching todo, or nil.
func (s *Store) GetPlannerTodo(ctx context.Context, find *FindPlannerTodo) (*PlannerTodo, error) {
	list, err := s.driver.ListPlannerTodos(ctx, find)
	if err != nil || len(list) == 0 {
		return nil, err
	}
	return list[0], nil
}

// UpdatePlannerTodo changes a todo and returns it.
func (s *Store) UpdatePlannerTodo(ctx context.Context, update *UpdatePlannerTodo) (*PlannerTodo, error) {
	return s.driver.UpdatePlannerTodo(ctx, update)
}

// DeletePlannerTodo deletes a todo, and the check-in its completion made, if any.
func (s *Store) DeletePlannerTodo(ctx context.Context, id int32) error {
	return s.driver.DeletePlannerTodo(ctx, id)
}

// ListPlannerTodoTags returns the distinct tags on a user's todos, most recently used first.
func (s *Store) ListPlannerTodoTags(ctx context.Context, creatorID int32) ([]string, error) {
	return s.driver.ListPlannerTodoTags(ctx, creatorID)
}

// CreatePlannerNote creates a note.
func (s *Store) CreatePlannerNote(ctx context.Context, create *PlannerNote) (*PlannerNote, error) {
	return s.driver.CreatePlannerNote(ctx, create)
}

// ListPlannerNotes returns matching notes ordered by date, then creation.
func (s *Store) ListPlannerNotes(ctx context.Context, find *FindPlannerNote) ([]*PlannerNote, error) {
	return s.driver.ListPlannerNotes(ctx, find)
}

// GetPlannerNote returns the first matching note, or nil.
func (s *Store) GetPlannerNote(ctx context.Context, find *FindPlannerNote) (*PlannerNote, error) {
	list, err := s.driver.ListPlannerNotes(ctx, find)
	if err != nil || len(list) == 0 {
		return nil, err
	}
	return list[0], nil
}

// UpdatePlannerNote changes a note and returns it.
func (s *Store) UpdatePlannerNote(ctx context.Context, update *UpdatePlannerNote) (*PlannerNote, error) {
	return s.driver.UpdatePlannerNote(ctx, update)
}

// DeletePlannerNote deletes a note.
func (s *Store) DeletePlannerNote(ctx context.Context, id int32) error {
	return s.driver.DeletePlannerNote(ctx, id)
}

// ImportPlanner writes a whole planner in one transaction. It refuses with
// ErrPlannerNotEmpty when the user already has any planner data.
func (s *Store) ImportPlanner(ctx context.Context, data *PlannerImport) error {
	return s.driver.ImportPlanner(ctx, data)
}
