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

// PlannerMaxHabitsPerVersion is how many habits a version holds.
const PlannerMaxHabitsPerVersion = 10

// PlannerMaxPinnedHabits is how many habits of a version are pinned: shown on the planner page and in the
// calendar's day cells, which have room for one row of three icons. The rest fold behind one button.
const PlannerMaxPinnedHabits = 3

// ErrPlannerNotEmpty is returned by ImportPlanner when the user already has
// planner data: an import is a one-time backfill and must not run twice.
var ErrPlannerNotEmpty = errors.New("planner already has data")

// ErrPlannerNoDraft is returned by EnablePlannerHabitDraft when the user has no draft to enable.
var ErrPlannerNoDraft = errors.New("no habit plan draft")

// ErrPlannerCheckInTaken is returned by UpdatePlannerTodo when the check-in it
// should add already exists: the habit was checked in that day.
var ErrPlannerCheckInTaken = errors.New("habit already checked in on that day")

// PlannerHabit is a long-running habit the user checks in against. Habits are never deleted: they
// form a pool, and PlannerHabitVersion decides which of them are in use on a day.
type PlannerHabit struct {
	ID        int32
	UID       string
	CreatorID int32
	Name      string
	// Position is the order habits were created in; versions carry the calendar order now.
	Position int32
	// Archived is no longer used: versions decide what is in use. Kept for old data and imports.
	Archived bool
	// Color is an index into the calendar palette. The habit keeps it on every day.
	Color     int32
	CreatedTs int64
	UpdatedTs int64
}

// PlannerHabitVersion is an enabled habit plan: the set of habits in use from EffectiveDate on, until the
// next version. It never changes once enabled.
type PlannerHabitVersion struct {
	ID        int32
	CreatorID int32
	// EffectiveDate is "YYYY-MM-DD", the day it was enabled, or "" for the very beginning.
	EffectiveDate string
	// Entries are the habits in calendar order, at most five.
	Entries []PlannerHabitVersionEntry
	// MemoNames are the linked documents, "memos/{uid}", in display order.
	MemoNames []string
	CreatedTs int64
	UpdatedTs int64
}

// PlannerHabitDraft is a user's one habit plan not yet enabled: a version without a date, free to change.
type PlannerHabitDraft struct {
	CreatorID int32
	Entries   []PlannerHabitVersionEntry
	MemoNames []string
	CreatedTs int64
	UpdatedTs int64
}

// PlannerHabitVersionEntry is one habit in a version.
type PlannerHabitVersionEntry struct {
	HabitID int32 `json:"habit_id"`
	// WeeklyGoal is how many check-ins a week the habit aims for; 0 for none.
	WeeklyGoal int32 `json:"weekly_goal"`
	// Pinned habits show on the planner page; the others fold away.
	Pinned bool `json:"pinned,omitempty"`
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
	Color    *int32
}

// Who made a check-in.
const (
	// PlannerCheckInManual is a check-in made in the app.
	PlannerCheckInManual = "MANUAL"
	// PlannerCheckInTodo is a check-in made by completing a habit todo in the app.
	PlannerCheckInTodo = "TODO"
	// PlannerCheckInAgent is a check-in made by an API caller with a personal access token, e.g. a bot.
	PlannerCheckInAgent = "AGENT"
)

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
	TodoUID string
	// Source is who made the check-in, one of the PlannerCheckIn* constants. Set when it is made, never changed.
	Source string
	// Workout is the workout the check-in stands for, or nil.
	Workout *PlannerWorkout
	// Rating is how the session went, 1 to 5, or 0 when not rated.
	Rating    int32
	CreatedTs int64
	UpdatedTs int64
}

// PlannerWorkout is the detail of a workout a check-in stands for: one session of the habit that day.
type PlannerWorkout struct {
	// DurationMinutes is the whole session's length, or nil when not recorded.
	DurationMinutes *float64 `json:"duration_minutes,omitempty"`
	// Exercises are in the order they were done.
	Exercises []PlannerExercise `json:"exercises"`
}

// PlannerExercise is one exercise of a workout. Every field but the name is optional.
type PlannerExercise struct {
	Name      string `json:"name"`
	Equipment string `json:"equipment,omitempty"`
	// WeightKg is in kilograms; callers convert from pounds.
	WeightKg *float64 `json:"weight_kg,omitempty"`
	// Reps are the repetitions of each set, in order.
	Reps            []int32  `json:"reps,omitempty"`
	DurationMinutes *float64 `json:"duration_minutes,omitempty"`
	// Settings are the machine's, e.g. "incline 10, 3.8-4 km/h".
	Settings string `json:"settings,omitempty"`
	Note     string `json:"note,omitempty"`
	// Intensity is how hard it was, in words, e.g. "moderate" or "RPE 7".
	Intensity string `json:"intensity,omitempty"`
	// DocUID is the memo UID of the exercise's guide in the exercise library, or "". It identifies the
	// exercise however the name is written.
	DocUID string `json:"doc,omitempty"`
}

// FindPlannerCheckIn filters one user's check-ins by an inclusive date range.
// An empty bound leaves that side open.
type FindPlannerCheckIn struct {
	CreatorID int32
	HabitID   *int32
	StartDate string
	EndDate   string
	// WithWorkout keeps only check-ins that carry a workout.
	WithWorkout bool
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
	// Source is who created the todo: PlannerCheckInManual (the app) or PlannerCheckInAgent (a personal
	// access token). Set on creation, never changed; "" is stored as manual.
	Source string
	// PlannedWorkout is the workout planned for a habit todo, or nil for none.
	PlannedWorkout *PlannerWorkout
	// PlannedWorkoutSource is who last set PlannedWorkout, like Source; "" when there is none.
	PlannedWorkoutSource string
	CreatedTs            int64
	UpdatedTs            int64
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
	// UpdatedSince, when non-zero, keeps the todos updated at or after it (unix seconds).
	UpdatedSince int64
}

// PlannerTodoDeletion records a deleted todo, so a client syncing todos can learn it is gone.
type PlannerTodoDeletion struct {
	UID       string
	CreatorID int32
	DeletedTs int64
}

// UpdatePlannerTodo changes the given fields of one todo. The API layer owns the
// status rules (a closed todo has a closed time, a cancelled one a reason); the
// store writes what it is given.
//
// CheckIn, when set, is added in the same transaction, made by this todo: it is
// how completing a todo checks in its habit. If the habit already has a check-in
// that day nothing is written and ErrPlannerCheckInTaken is returned.
//
// DropCheckIn removes the check-in the todo made, in the same transaction: it is
// how undoing an agent's check-in reopens the todo it completed.
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
	// SetPlannedWorkout writes PlannedWorkout (nil clears it) and PlannedWorkoutSource.
	SetPlannedWorkout    bool
	PlannedWorkout       *PlannerWorkout
	PlannedWorkoutSource string
	CheckIn              *PlannerCheckIn
	DropCheckIn          bool
}

// PlannerNote is a plain record of what happened on a day.
type PlannerNote struct {
	ID        int32
	UID       string
	CreatorID int32
	Date      string
	Content   string
	// Remark is a longer text shown only on the note's own page.
	Remark string
	// MemoNames are the linked documents, "memos/{uid}", in display order.
	MemoNames []string
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
	ID        int32
	Date      *string
	Content   *string
	Remark    *string
	MemoNames *[]string
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

// ListPlannerHabitVersions returns a user's habit versions by effective date, earliest first.
func (s *Store) ListPlannerHabitVersions(ctx context.Context, creatorID int32) ([]*PlannerHabitVersion, error) {
	return s.driver.ListPlannerHabitVersions(ctx, creatorID)
}

// UpsertPlannerHabitVersion writes the version for its effective date, replacing one already there, and in
// the same transaction unlinks the given todos from their habits (they become plain todos).
func (s *Store) UpsertPlannerHabitVersion(ctx context.Context, version *PlannerHabitVersion, unlinkTodoIDs []int32) (*PlannerHabitVersion, error) {
	return s.driver.UpsertPlannerHabitVersion(ctx, version, unlinkTodoIDs)
}

// GetPlannerHabitDraft returns a user's habit plan draft, or nil when there is none.
func (s *Store) GetPlannerHabitDraft(ctx context.Context, creatorID int32) (*PlannerHabitDraft, error) {
	return s.driver.GetPlannerHabitDraft(ctx, creatorID)
}

// UpsertPlannerHabitDraft writes a user's habit plan draft, replacing the one there.
func (s *Store) UpsertPlannerHabitDraft(ctx context.Context, draft *PlannerHabitDraft) (*PlannerHabitDraft, error) {
	return s.driver.UpsertPlannerHabitDraft(ctx, draft)
}

// DeletePlannerHabitDraft removes a user's habit plan draft, if any.
func (s *Store) DeletePlannerHabitDraft(ctx context.Context, creatorID int32) error {
	return s.driver.DeletePlannerHabitDraft(ctx, creatorID)
}

// EnablePlannerHabitDraft turns the user's draft into the version effective on effectiveDate, in one
// transaction: a version already on that date is replaced, any later one (set ahead of time before plans
// were drafted) is dropped, the given todos are unlinked from their habits, and the draft is gone. It returns
// ErrPlannerNoDraft when there is no draft.
func (s *Store) EnablePlannerHabitDraft(ctx context.Context, creatorID int32, effectiveDate string, unlinkTodoIDs []int32) (*PlannerHabitVersion, error) {
	return s.driver.EnablePlannerHabitDraft(ctx, creatorID, effectiveDate, unlinkTodoIDs)
}

// UpsertPlannerCheckIn records a check-in, replacing the note and workout of an
// existing one for the same habit and day. Source is written only when the
// check-in is made: an existing one keeps who made it.
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
// ListPlannerTodoDeletions lists the creator's todos deleted at or after since (unix seconds), oldest first.
func (s *Store) ListPlannerTodoDeletions(ctx context.Context, creatorID int32, since int64) ([]*PlannerTodoDeletion, error) {
	return s.driver.ListPlannerTodoDeletions(ctx, creatorID, since)
}

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
