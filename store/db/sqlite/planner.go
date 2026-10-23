package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"

	"github.com/pkg/errors"

	"github.com/usememos/memos/store"
)

// plannerQuerier is what the planner inserts need, so ImportPlanner can run them
// inside its transaction.
type plannerQuerier interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// withPlannerTx runs fn in a transaction, committing only if it succeeds.
func (d *DB) withPlannerTx(ctx context.Context, fn func(tx *sql.Tx) error) error {
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return errors.Wrap(err, "failed to begin transaction")
	}
	defer func() {
		_ = tx.Rollback()
	}()
	if err := fn(tx); err != nil {
		return err
	}
	return errors.Wrap(tx.Commit(), "failed to commit transaction")
}

// dateRange appends inclusive bounds on a `date` column. A bounded query never
// matches the empty date of an undated todo.
func dateRange(where []string, args []any, start, end string) ([]string, []any) {
	if start != "" {
		where, args = append(where, "`date` >= ?"), append(args, start)
	}
	if end != "" {
		where, args = append(where, "`date` <= ?"), append(args, end)
	}
	if start != "" || end != "" {
		where = append(where, "`date` != ''")
	}
	return where, args
}

// Habits.

const plannerHabitColumns = "`id`, `uid`, `creator_id`, `name`, `position`, `archived`, `color`, `created_ts`, `updated_ts`"

func scanPlannerHabit(row interface{ Scan(...any) error }) (*store.PlannerHabit, error) {
	h := &store.PlannerHabit{}
	if err := row.Scan(&h.ID, &h.UID, &h.CreatorID, &h.Name, &h.Position, &h.Archived, &h.Color, &h.CreatedTs, &h.UpdatedTs); err != nil {
		return nil, err
	}
	return h, nil
}

func insertPlannerHabit(ctx context.Context, q plannerQuerier, create *store.PlannerHabit) (*store.PlannerHabit, error) {
	stmt := "INSERT INTO `planner_habit` (`uid`, `creator_id`, `name`, `position`, `archived`, `color`) VALUES (?, ?, ?, ?, ?, ?) RETURNING " +
		plannerHabitColumns
	return scanPlannerHabit(q.QueryRowContext(ctx, stmt, create.UID, create.CreatorID, create.Name, create.Position, create.Archived, create.Color))
}

func (d *DB) CreatePlannerHabit(ctx context.Context, create *store.PlannerHabit) (*store.PlannerHabit, error) {
	return insertPlannerHabit(ctx, d.db, create)
}

func (d *DB) ListPlannerHabits(ctx context.Context, find *store.FindPlannerHabit) ([]*store.PlannerHabit, error) {
	where, args := []string{"1 = 1"}, []any{}
	if find.ID != nil {
		where, args = append(where, "`id` = ?"), append(args, *find.ID)
	}
	if find.UID != nil {
		where, args = append(where, "`uid` = ?"), append(args, *find.UID)
	}
	if find.CreatorID != nil {
		where, args = append(where, "`creator_id` = ?"), append(args, *find.CreatorID)
	}
	rows, err := d.db.QueryContext(ctx,
		"SELECT "+plannerHabitColumns+" FROM `planner_habit` WHERE "+strings.Join(where, " AND ")+" ORDER BY `position`, `id`",
		args...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := []*store.PlannerHabit{}
	for rows.Next() {
		h, err := scanPlannerHabit(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, h)
	}
	return list, rows.Err()
}

func (d *DB) UpdatePlannerHabit(ctx context.Context, update *store.UpdatePlannerHabit) (*store.PlannerHabit, error) {
	set, args := []string{"`updated_ts` = strftime('%s', 'now')"}, []any{}
	if update.Name != nil {
		set, args = append(set, "`name` = ?"), append(args, *update.Name)
	}
	if update.Position != nil {
		set, args = append(set, "`position` = ?"), append(args, *update.Position)
	}
	if update.Archived != nil {
		set, args = append(set, "`archived` = ?"), append(args, *update.Archived)
	}
	if update.Color != nil {
		set, args = append(set, "`color` = ?"), append(args, *update.Color)
	}
	args = append(args, update.ID)
	stmt := "UPDATE `planner_habit` SET " + strings.Join(set, ", ") + " WHERE `id` = ? RETURNING " + plannerHabitColumns
	return scanPlannerHabit(d.db.QueryRowContext(ctx, stmt, args...))
}

// Habit versions.

const plannerHabitVersionColumns = "`id`, `creator_id`, `effective_date`, `entries`, `memo_names`, `created_ts`, `updated_ts`"

// decodePlanEntries reads a plan's `entries` and `memo_names` JSON.
func decodePlanEntries(entries, memoNames string) ([]store.PlannerHabitVersionEntry, []string, error) {
	decodedEntries := []store.PlannerHabitVersionEntry{}
	if err := json.Unmarshal([]byte(entries), &decodedEntries); err != nil {
		return nil, nil, errors.Wrap(err, "failed to read the habit plan's entries")
	}
	decodedMemos := []string{}
	if err := json.Unmarshal([]byte(memoNames), &decodedMemos); err != nil {
		return nil, nil, errors.Wrap(err, "failed to read the habit plan's documents")
	}
	return decodedEntries, decodedMemos, nil
}

func encodePlanEntries(entries []store.PlannerHabitVersionEntry) (string, error) {
	if entries == nil {
		entries = []store.PlannerHabitVersionEntry{}
	}
	encoded, err := json.Marshal(entries)
	if err != nil {
		return "", errors.Wrap(err, "failed to encode the habit plan's entries")
	}
	return string(encoded), nil
}

func scanPlannerHabitVersion(row interface{ Scan(...any) error }) (*store.PlannerHabitVersion, error) {
	v := &store.PlannerHabitVersion{}
	var entries, memoNames string
	if err := row.Scan(&v.ID, &v.CreatorID, &v.EffectiveDate, &entries, &memoNames, &v.CreatedTs, &v.UpdatedTs); err != nil {
		return nil, err
	}
	var err error
	v.Entries, v.MemoNames, err = decodePlanEntries(entries, memoNames)
	return v, err
}

func upsertPlannerHabitVersion(ctx context.Context, q plannerQuerier, version *store.PlannerHabitVersion) (*store.PlannerHabitVersion, error) {
	entries, err := encodePlanEntries(version.Entries)
	if err != nil {
		return nil, err
	}
	stmt := "INSERT INTO `planner_habit_version` (`creator_id`, `effective_date`, `entries`, `memo_names`) VALUES (?, ?, ?, ?) " +
		"ON CONFLICT(`creator_id`, `effective_date`) DO UPDATE SET `entries` = excluded.`entries`, " +
		"`memo_names` = excluded.`memo_names`, `updated_ts` = strftime('%s', 'now') " +
		"RETURNING " + plannerHabitVersionColumns
	return scanPlannerHabitVersion(q.QueryRowContext(ctx, stmt, version.CreatorID, version.EffectiveDate, entries, encodeMemoNames(version.MemoNames)))
}

func (d *DB) ListPlannerHabitVersions(ctx context.Context, creatorID int32) ([]*store.PlannerHabitVersion, error) {
	rows, err := d.db.QueryContext(ctx,
		"SELECT "+plannerHabitVersionColumns+" FROM `planner_habit_version` WHERE `creator_id` = ? ORDER BY `effective_date`",
		creatorID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := []*store.PlannerHabitVersion{}
	for rows.Next() {
		v, err := scanPlannerHabitVersion(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, v)
	}
	return list, rows.Err()
}

func unlinkPlannerTodos(ctx context.Context, tx *sql.Tx, creatorID int32, todoIDs []int32) error {
	for _, id := range todoIDs {
		if _, err := tx.ExecContext(ctx,
			"UPDATE `planner_todo` SET `habit_id` = 0, `updated_ts` = strftime('%s', 'now') WHERE `id` = ? AND `creator_id` = ?",
			id, creatorID,
		); err != nil {
			return errors.Wrap(err, "failed to unlink todo")
		}
	}
	return nil
}

func (d *DB) UpsertPlannerHabitVersion(ctx context.Context, version *store.PlannerHabitVersion, unlinkTodoIDs []int32) (*store.PlannerHabitVersion, error) {
	var written *store.PlannerHabitVersion
	err := d.withPlannerTx(ctx, func(tx *sql.Tx) error {
		if err := unlinkPlannerTodos(ctx, tx, version.CreatorID, unlinkTodoIDs); err != nil {
			return err
		}
		var err error
		written, err = upsertPlannerHabitVersion(ctx, tx, version)
		return err
	})
	return written, err
}

// Habit plan drafts.

const plannerHabitDraftColumns = "`creator_id`, `entries`, `memo_names`, `created_ts`, `updated_ts`"

func scanPlannerHabitDraft(row interface{ Scan(...any) error }) (*store.PlannerHabitDraft, error) {
	draft := &store.PlannerHabitDraft{}
	var entries, memoNames string
	if err := row.Scan(&draft.CreatorID, &entries, &memoNames, &draft.CreatedTs, &draft.UpdatedTs); err != nil {
		return nil, err
	}
	var err error
	draft.Entries, draft.MemoNames, err = decodePlanEntries(entries, memoNames)
	return draft, err
}

func getPlannerHabitDraft(ctx context.Context, q plannerQuerier, creatorID int32) (*store.PlannerHabitDraft, error) {
	draft, err := scanPlannerHabitDraft(q.QueryRowContext(ctx,
		"SELECT "+plannerHabitDraftColumns+" FROM `planner_habit_draft` WHERE `creator_id` = ?", creatorID))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return draft, err
}

func (d *DB) GetPlannerHabitDraft(ctx context.Context, creatorID int32) (*store.PlannerHabitDraft, error) {
	return getPlannerHabitDraft(ctx, d.db, creatorID)
}

func (d *DB) UpsertPlannerHabitDraft(ctx context.Context, draft *store.PlannerHabitDraft) (*store.PlannerHabitDraft, error) {
	entries, err := encodePlanEntries(draft.Entries)
	if err != nil {
		return nil, err
	}
	stmt := "INSERT INTO `planner_habit_draft` (`creator_id`, `entries`, `memo_names`) VALUES (?, ?, ?) " +
		"ON CONFLICT(`creator_id`) DO UPDATE SET `entries` = excluded.`entries`, `memo_names` = excluded.`memo_names`, " +
		"`updated_ts` = strftime('%s', 'now') RETURNING " + plannerHabitDraftColumns
	return scanPlannerHabitDraft(d.db.QueryRowContext(ctx, stmt, draft.CreatorID, entries, encodeMemoNames(draft.MemoNames)))
}

func (d *DB) DeletePlannerHabitDraft(ctx context.Context, creatorID int32) error {
	_, err := d.db.ExecContext(ctx, "DELETE FROM `planner_habit_draft` WHERE `creator_id` = ?", creatorID)
	return err
}

func (d *DB) EnablePlannerHabitDraft(ctx context.Context, creatorID int32, effectiveDate string, unlinkTodoIDs []int32) (*store.PlannerHabitVersion, error) {
	var enabled *store.PlannerHabitVersion
	err := d.withPlannerTx(ctx, func(tx *sql.Tx) error {
		draft, err := getPlannerHabitDraft(ctx, tx, creatorID)
		if err != nil {
			return err
		}
		if draft == nil {
			return store.ErrPlannerNoDraft
		}
		if _, err := tx.ExecContext(ctx,
			"DELETE FROM `planner_habit_version` WHERE `creator_id` = ? AND `effective_date` > ?", creatorID, effectiveDate,
		); err != nil {
			return errors.Wrap(err, "failed to drop later habit versions")
		}
		if err := unlinkPlannerTodos(ctx, tx, creatorID, unlinkTodoIDs); err != nil {
			return err
		}
		enabled, err = upsertPlannerHabitVersion(ctx, tx, &store.PlannerHabitVersion{
			CreatorID: creatorID, EffectiveDate: effectiveDate, Entries: draft.Entries, MemoNames: draft.MemoNames,
		})
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, "DELETE FROM `planner_habit_draft` WHERE `creator_id` = ?", creatorID)
		return err
	})
	return enabled, err
}

// Check-ins.

// plannerCheckInColumns reads a check-in, with the UID of the todo that made it looked up alongside.
const plannerCheckInColumns = "`id`, `creator_id`, `habit_id`, `date`, `note`, `todo_id`, " +
	"COALESCE((SELECT `planner_todo`.`uid` FROM `planner_todo` WHERE `planner_todo`.`id` = `planner_check_in`.`todo_id`), ''), " +
	"`source`, `workout`, `created_ts`, `updated_ts`"

func scanPlannerCheckIn(row interface{ Scan(...any) error }) (*store.PlannerCheckIn, error) {
	c := &store.PlannerCheckIn{}
	var workout string
	if err := row.Scan(&c.ID, &c.CreatorID, &c.HabitID, &c.Date, &c.Note, &c.TodoID, &c.TodoUID, &c.Source, &workout, &c.CreatedTs, &c.UpdatedTs); err != nil {
		return nil, err
	}
	var err error
	c.Workout, err = decodePlannerWorkout(workout)
	return c, err
}

// encodePlannerWorkout is a check-in's workout as stored: JSON, or "" for none.
func encodePlannerWorkout(workout *store.PlannerWorkout) (string, error) {
	if workout == nil {
		return "", nil
	}
	encoded, err := json.Marshal(workout)
	if err != nil {
		return "", errors.Wrap(err, "failed to encode the workout")
	}
	return string(encoded), nil
}

func decodePlannerWorkout(value string) (*store.PlannerWorkout, error) {
	if value == "" {
		return nil, nil
	}
	workout := &store.PlannerWorkout{}
	if err := json.Unmarshal([]byte(value), workout); err != nil {
		return nil, errors.Wrap(err, "failed to decode the workout")
	}
	return workout, nil
}

// plannerCheckInSource defaults a check-in made without a stated source to one made by hand.
func plannerCheckInSource(source string) string {
	if source == "" {
		return store.PlannerCheckInManual
	}
	return source
}

// upsertPlannerCheckIn records a check-in by hand or by an agent: it never sets, or clears, the todo that made
// one, and an existing check-in keeps its source.
func upsertPlannerCheckIn(ctx context.Context, q plannerQuerier, upsert *store.PlannerCheckIn) (*store.PlannerCheckIn, error) {
	workout, err := encodePlannerWorkout(upsert.Workout)
	if err != nil {
		return nil, err
	}
	stmt := "INSERT INTO `planner_check_in` (`creator_id`, `habit_id`, `date`, `note`, `source`, `workout`) VALUES (?, ?, ?, ?, ?, ?) " +
		"ON CONFLICT(`habit_id`, `date`) DO UPDATE SET `note` = excluded.`note`, `workout` = excluded.`workout`, " +
		"`updated_ts` = strftime('%s', 'now') " +
		"RETURNING " + plannerCheckInColumns
	return scanPlannerCheckIn(q.QueryRowContext(ctx, stmt,
		upsert.CreatorID, upsert.HabitID, upsert.Date, upsert.Note, plannerCheckInSource(upsert.Source), workout,
	))
}

func (d *DB) UpsertPlannerCheckIn(ctx context.Context, upsert *store.PlannerCheckIn) (*store.PlannerCheckIn, error) {
	return upsertPlannerCheckIn(ctx, d.db, upsert)
}

func (d *DB) ListPlannerCheckIns(ctx context.Context, find *store.FindPlannerCheckIn) ([]*store.PlannerCheckIn, error) {
	where, args := []string{"`creator_id` = ?"}, []any{find.CreatorID}
	if find.HabitID != nil {
		where, args = append(where, "`habit_id` = ?"), append(args, *find.HabitID)
	}
	where, args = dateRange(where, args, find.StartDate, find.EndDate)
	if find.WithWorkout {
		where = append(where, "`workout` != ''")
	}
	rows, err := d.db.QueryContext(ctx,
		"SELECT "+plannerCheckInColumns+" FROM `planner_check_in` WHERE "+strings.Join(where, " AND ")+" ORDER BY `date`, `id`",
		args...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := []*store.PlannerCheckIn{}
	for rows.Next() {
		c, err := scanPlannerCheckIn(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, c)
	}
	return list, rows.Err()
}

func (d *DB) DeletePlannerCheckIn(ctx context.Context, habitID int32, date string) error {
	_, err := d.db.ExecContext(ctx, "DELETE FROM `planner_check_in` WHERE `habit_id` = ? AND `date` = ?", habitID, date)
	return err
}

// Todos.

// plannerTodoColumns reads a todo. Two columns are looked up rather than stored on the todo, so every
// read carries them: its habit's UID, and the day of the check-in its completion made.
const plannerTodoColumns = "`id`, `uid`, `creator_id`, `title`, `date`, `status`, `closed_overdue`, `closed_ts`, `cancel_reason`, " +
	"`important`, `tag`, `note`, `memo_names`, `url`, `original_date`, `postpone_count`, `habit_id`, " +
	"COALESCE((SELECT `planner_habit`.`uid` FROM `planner_habit` WHERE `planner_habit`.`id` = `planner_todo`.`habit_id`), ''), " +
	"COALESCE((SELECT `planner_check_in`.`date` FROM `planner_check_in` WHERE `planner_check_in`.`todo_id` = `planner_todo`.`id` LIMIT 1), ''), " +
	"`created_ts`, `updated_ts`"

func scanPlannerTodo(row interface{ Scan(...any) error }) (*store.PlannerTodo, error) {
	t := &store.PlannerTodo{}
	var memoNames string
	if err := row.Scan(
		&t.ID, &t.UID, &t.CreatorID, &t.Title, &t.Date, &t.Status, &t.ClosedOverdue, &t.ClosedTs, &t.CancelReason,
		&t.Important, &t.Tag, &t.Note, &memoNames, &t.URL, &t.OriginalDate, &t.PostponeCount, &t.HabitID, &t.HabitUID, &t.CheckInDate,
		&t.CreatedTs, &t.UpdatedTs,
	); err != nil {
		return nil, err
	}
	t.MemoNames = []string{}
	if err := json.Unmarshal([]byte(memoNames), &t.MemoNames); err != nil {
		return nil, errors.Wrap(err, "failed to read the todo's linked documents")
	}
	return t, nil
}

// encodeMemoNames is how `memo_names` stores a todo's linked documents: a JSON array, "[]" for none.
func encodeMemoNames(names []string) string {
	if len(names) == 0 {
		return "[]"
	}
	bytes, _ := json.Marshal(names)
	return string(bytes)
}

func insertPlannerTodo(ctx context.Context, q plannerQuerier, create *store.PlannerTodo) (*store.PlannerTodo, error) {
	stmt := "INSERT INTO `planner_todo` (`uid`, `creator_id`, `title`, `date`, `status`, `closed_overdue`, `closed_ts`, `cancel_reason`, " +
		"`important`, `tag`, `note`, `memo_names`, `url`, `habit_id`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING " + plannerTodoColumns
	return scanPlannerTodo(q.QueryRowContext(ctx, stmt,
		create.UID, create.CreatorID, create.Title, create.Date, create.Status, create.ClosedOverdue, create.ClosedTs, create.CancelReason,
		create.Important, create.Tag, create.Note, encodeMemoNames(create.MemoNames), create.URL, create.HabitID,
	))
}

func (d *DB) CreatePlannerTodo(ctx context.Context, create *store.PlannerTodo) (*store.PlannerTodo, error) {
	return insertPlannerTodo(ctx, d.db, create)
}

func (d *DB) ListPlannerTodos(ctx context.Context, find *store.FindPlannerTodo) ([]*store.PlannerTodo, error) {
	where, args := []string{"1 = 1"}, []any{}
	if find.ID != nil {
		where, args = append(where, "`id` = ?"), append(args, *find.ID)
	}
	if find.UID != nil {
		where, args = append(where, "`uid` = ?"), append(args, *find.UID)
	}
	if find.CreatorID != nil {
		where, args = append(where, "`creator_id` = ?"), append(args, *find.CreatorID)
	}
	if find.Status != nil {
		where, args = append(where, "`status` = ?"), append(args, *find.Status)
	}
	if find.HabitID != nil {
		where, args = append(where, "`habit_id` = ?"), append(args, *find.HabitID)
	}
	where, args = dateRange(where, args, find.StartDate, find.EndDate)
	// Undated todos sort after every dated one.
	rows, err := d.db.QueryContext(ctx,
		"SELECT "+plannerTodoColumns+" FROM `planner_todo` WHERE "+strings.Join(where, " AND ")+" ORDER BY `date` = '', `date`, `id`",
		args...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := []*store.PlannerTodo{}
	for rows.Next() {
		t, err := scanPlannerTodo(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, t)
	}
	return list, rows.Err()
}

func (d *DB) UpdatePlannerTodo(ctx context.Context, update *store.UpdatePlannerTodo) (*store.PlannerTodo, error) {
	set, args := []string{"`updated_ts` = strftime('%s', 'now')"}, []any{}
	var memoNames *string
	if update.MemoNames != nil {
		encoded := encodeMemoNames(*update.MemoNames)
		memoNames = &encoded
	}
	fields := []struct {
		column string
		value  any
		ok     bool
	}{
		{"title", update.Title, update.Title != nil},
		{"date", update.Date, update.Date != nil},
		{"status", update.Status, update.Status != nil},
		{"closed_overdue", update.ClosedOverdue, update.ClosedOverdue != nil},
		{"closed_ts", update.ClosedTs, update.ClosedTs != nil},
		{"cancel_reason", update.CancelReason, update.CancelReason != nil},
		{"important", update.Important, update.Important != nil},
		{"tag", update.Tag, update.Tag != nil},
		{"note", update.Note, update.Note != nil},
		{"memo_names", memoNames, memoNames != nil},
		{"url", update.URL, update.URL != nil},
		{"original_date", update.OriginalDate, update.OriginalDate != nil},
		{"postpone_count", update.PostponeCount, update.PostponeCount != nil},
		{"habit_id", update.HabitID, update.HabitID != nil},
	}
	for _, f := range fields {
		if f.ok {
			set, args = append(set, "`"+f.column+"` = ?"), append(args, derefPlannerValue(f.value))
		}
	}
	args = append(args, update.ID)
	stmt := "UPDATE `planner_todo` SET " + strings.Join(set, ", ") + " WHERE `id` = ? RETURNING " + plannerTodoColumns
	if update.CheckIn == nil && !update.DropCheckIn {
		return scanPlannerTodo(d.db.QueryRowContext(ctx, stmt, args...))
	}

	var todo *store.PlannerTodo
	err := d.withPlannerTx(ctx, func(tx *sql.Tx) error {
		if update.DropCheckIn {
			if _, err := tx.ExecContext(ctx, "DELETE FROM `planner_check_in` WHERE `todo_id` = ?", update.ID); err != nil {
				return errors.Wrap(err, "failed to drop the todo's check-in")
			}
		}
		if update.CheckIn == nil {
			var err error
			todo, err = scanPlannerTodo(tx.QueryRowContext(ctx, stmt, args...))
			return err
		}
		checkIn := update.CheckIn
		var taken int
		if err := tx.QueryRowContext(ctx,
			"SELECT COUNT(*) FROM `planner_check_in` WHERE `habit_id` = ? AND `date` = ?", checkIn.HabitID, checkIn.Date,
		).Scan(&taken); err != nil {
			return errors.Wrap(err, "failed to check the habit's check-in")
		}
		if taken > 0 {
			return store.ErrPlannerCheckInTaken
		}
		workout, err := encodePlannerWorkout(checkIn.Workout)
		if err != nil {
			return err
		}
		source := checkIn.Source
		if source == "" {
			source = store.PlannerCheckInTodo
		}
		// The check-in goes in first, so the todo read back below already carries its date.
		if _, err := tx.ExecContext(ctx,
			"INSERT INTO `planner_check_in` (`creator_id`, `habit_id`, `date`, `note`, `todo_id`, `source`, `workout`) VALUES (?, ?, ?, ?, ?, ?, ?)",
			checkIn.CreatorID, checkIn.HabitID, checkIn.Date, checkIn.Note, update.ID, source, workout,
		); err != nil {
			return errors.Wrap(err, "failed to check in")
		}
		todo, err = scanPlannerTodo(tx.QueryRowContext(ctx, stmt, args...))
		return err
	})
	return todo, err
}

// derefPlannerValue unwraps the pointer fields of an update.
func derefPlannerValue(v any) any {
	switch p := v.(type) {
	case *string:
		return *p
	case *bool:
		return *p
	case *int64:
		return *p
	case *int32:
		return *p
	default:
		return v
	}
}

func (d *DB) DeletePlannerTodo(ctx context.Context, id int32) error {
	return d.withPlannerTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, "DELETE FROM `planner_check_in` WHERE `todo_id` = ?", id); err != nil {
			return errors.Wrap(err, "failed to delete the todo's check-in")
		}
		_, err := tx.ExecContext(ctx, "DELETE FROM `planner_todo` WHERE `id` = ?", id)
		return err
	})
}

// plannerTodoTagLimit caps the tag history: enough to choose from, small enough to show at once.
const plannerTodoTagLimit = 50

// ListPlannerTodoTags returns the distinct tags on a user's todos. "Most recently used" is the latest
// update of any todo carrying the tag, close enough to when it was last set.
func (d *DB) ListPlannerTodoTags(ctx context.Context, creatorID int32) ([]string, error) {
	rows, err := d.db.QueryContext(ctx,
		"SELECT `tag` FROM `planner_todo` WHERE `creator_id` = ? AND `tag` != '' GROUP BY `tag` ORDER BY MAX(`updated_ts`) DESC, `tag` LIMIT ?",
		creatorID, plannerTodoTagLimit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tags := []string{}
	for rows.Next() {
		var tag string
		if err := rows.Scan(&tag); err != nil {
			return nil, err
		}
		tags = append(tags, tag)
	}
	return tags, rows.Err()
}

// Notes.

const plannerNoteColumns = "`id`, `uid`, `creator_id`, `date`, `content`, `remark`, `memo_names`, `created_ts`, `updated_ts`"

func scanPlannerNote(row interface{ Scan(...any) error }) (*store.PlannerNote, error) {
	n := &store.PlannerNote{}
	var memoNames string
	if err := row.Scan(&n.ID, &n.UID, &n.CreatorID, &n.Date, &n.Content, &n.Remark, &memoNames, &n.CreatedTs, &n.UpdatedTs); err != nil {
		return nil, err
	}
	n.MemoNames = []string{}
	if err := json.Unmarshal([]byte(memoNames), &n.MemoNames); err != nil {
		return nil, errors.Wrap(err, "failed to read the note's linked documents")
	}
	return n, nil
}

func insertPlannerNote(ctx context.Context, q plannerQuerier, create *store.PlannerNote) (*store.PlannerNote, error) {
	stmt := "INSERT INTO `planner_note` (`uid`, `creator_id`, `date`, `content`, `remark`, `memo_names`) VALUES (?, ?, ?, ?, ?, ?) RETURNING " +
		plannerNoteColumns
	return scanPlannerNote(q.QueryRowContext(ctx, stmt, create.UID, create.CreatorID, create.Date, create.Content, create.Remark,
		encodeMemoNames(create.MemoNames)))
}

func (d *DB) CreatePlannerNote(ctx context.Context, create *store.PlannerNote) (*store.PlannerNote, error) {
	return insertPlannerNote(ctx, d.db, create)
}

func (d *DB) ListPlannerNotes(ctx context.Context, find *store.FindPlannerNote) ([]*store.PlannerNote, error) {
	where, args := []string{"1 = 1"}, []any{}
	if find.ID != nil {
		where, args = append(where, "`id` = ?"), append(args, *find.ID)
	}
	if find.UID != nil {
		where, args = append(where, "`uid` = ?"), append(args, *find.UID)
	}
	if find.CreatorID != nil {
		where, args = append(where, "`creator_id` = ?"), append(args, *find.CreatorID)
	}
	where, args = dateRange(where, args, find.StartDate, find.EndDate)
	rows, err := d.db.QueryContext(ctx,
		"SELECT "+plannerNoteColumns+" FROM `planner_note` WHERE "+strings.Join(where, " AND ")+" ORDER BY `date`, `id`",
		args...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := []*store.PlannerNote{}
	for rows.Next() {
		n, err := scanPlannerNote(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, n)
	}
	return list, rows.Err()
}

func (d *DB) UpdatePlannerNote(ctx context.Context, update *store.UpdatePlannerNote) (*store.PlannerNote, error) {
	set, args := []string{"`updated_ts` = strftime('%s', 'now')"}, []any{}
	if update.Date != nil {
		set, args = append(set, "`date` = ?"), append(args, *update.Date)
	}
	if update.Content != nil {
		set, args = append(set, "`content` = ?"), append(args, *update.Content)
	}
	if update.Remark != nil {
		set, args = append(set, "`remark` = ?"), append(args, *update.Remark)
	}
	if update.MemoNames != nil {
		set, args = append(set, "`memo_names` = ?"), append(args, encodeMemoNames(*update.MemoNames))
	}
	args = append(args, update.ID)
	stmt := "UPDATE `planner_note` SET " + strings.Join(set, ", ") + " WHERE `id` = ? RETURNING " + plannerNoteColumns
	return scanPlannerNote(d.db.QueryRowContext(ctx, stmt, args...))
}

func (d *DB) DeletePlannerNote(ctx context.Context, id int32) error {
	_, err := d.db.ExecContext(ctx, "DELETE FROM `planner_note` WHERE `id` = ?", id)
	return err
}

// Import.

func (d *DB) ImportPlanner(ctx context.Context, data *store.PlannerImport) error {
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return errors.Wrap(err, "failed to begin planner import")
	}
	defer func() {
		_ = tx.Rollback()
	}()

	// Checked inside the transaction so two concurrent imports cannot both pass.
	var existing int
	if err := tx.QueryRowContext(ctx,
		"SELECT (SELECT COUNT(*) FROM `planner_habit` WHERE `creator_id` = ?) + "+
			"(SELECT COUNT(*) FROM `planner_todo` WHERE `creator_id` = ?) + "+
			"(SELECT COUNT(*) FROM `planner_note` WHERE `creator_id` = ?)",
		data.CreatorID, data.CreatorID, data.CreatorID,
	).Scan(&existing); err != nil {
		return errors.Wrap(err, "failed to check existing planner data")
	}
	if existing > 0 {
		return store.ErrPlannerNotEmpty
	}

	habitIDs := make([]int32, len(data.Habits))
	// The imported habits still in use become the version in force from the very beginning.
	first := &store.PlannerHabitVersion{CreatorID: data.CreatorID, EffectiveDate: ""}
	for i, habit := range data.Habits {
		habit.CreatorID = data.CreatorID
		created, err := insertPlannerHabit(ctx, tx, habit)
		if err != nil {
			return errors.Wrap(err, "failed to import habit")
		}
		habitIDs[i] = created.ID
		if !habit.Archived && len(first.Entries) < store.PlannerMaxHabitsPerVersion {
			pinned := len(first.Entries) < store.PlannerMaxPinnedHabits
			first.Entries = append(first.Entries, store.PlannerHabitVersionEntry{HabitID: created.ID, Pinned: pinned})
		}
	}
	if len(data.Habits) > 0 {
		if _, err := upsertPlannerHabitVersion(ctx, tx, first); err != nil {
			return errors.Wrap(err, "failed to import habit version")
		}
	}
	for _, checkIn := range data.CheckIns {
		if checkIn.HabitIndex < 0 || checkIn.HabitIndex >= len(habitIDs) {
			return errors.Errorf("check-in on %s names habit %d, which is not in the import", checkIn.Date, checkIn.HabitIndex)
		}
		if _, err := upsertPlannerCheckIn(ctx, tx, &store.PlannerCheckIn{
			CreatorID: data.CreatorID,
			HabitID:   habitIDs[checkIn.HabitIndex],
			Date:      checkIn.Date,
			Note:      checkIn.Note,
		}); err != nil {
			return errors.Wrap(err, "failed to import check-in")
		}
	}
	for _, todo := range data.Todos {
		todo.CreatorID = data.CreatorID
		if _, err := insertPlannerTodo(ctx, tx, todo); err != nil {
			return errors.Wrap(err, "failed to import todo")
		}
	}
	for _, note := range data.Notes {
		note.CreatorID = data.CreatorID
		if _, err := insertPlannerNote(ctx, tx, note); err != nil {
			return errors.Wrap(err, "failed to import note")
		}
	}
	return errors.Wrap(tx.Commit(), "failed to commit planner import")
}

// deletePlannerDataTx removes all of a user's planner data. It is personal, so
// unlike documents it is never transferred to another account.
func deletePlannerDataTx(ctx context.Context, tx *sql.Tx, userID int32) error {
	for _, table := range []string{"planner_check_in", "planner_habit", "planner_habit_version", "planner_habit_draft", "planner_todo", "planner_note"} {
		if _, err := tx.ExecContext(ctx, "DELETE FROM `"+table+"` WHERE `creator_id` = ?", userID); err != nil {
			return errors.Wrapf(err, "failed to delete %s", table)
		}
	}
	return nil
}
