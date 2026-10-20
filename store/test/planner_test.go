package test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/store"
)

func TestPlannerHabitsAndCheckIns(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	user, err := createTestingHostUser(ctx, ts)
	require.NoError(t, err)

	run, err := ts.CreatePlannerHabit(ctx, &store.PlannerHabit{UID: "h-run", CreatorID: user.ID, Name: "跑步", Position: 1})
	require.NoError(t, err)
	_, err = ts.CreatePlannerHabit(ctx, &store.PlannerHabit{UID: "h-read", CreatorID: user.ID, Name: "阅读", Position: 0})
	require.NoError(t, err)

	habits, err := ts.ListPlannerHabits(ctx, &store.FindPlannerHabit{CreatorID: &user.ID})
	require.NoError(t, err)
	require.Len(t, habits, 2)
	require.Equal(t, "阅读", habits[0].Name, "ordered by position")

	archived := true
	updated, err := ts.UpdatePlannerHabit(ctx, &store.UpdatePlannerHabit{ID: run.ID, Archived: &archived})
	require.NoError(t, err)
	require.True(t, updated.Archived)
	require.Equal(t, "跑步", updated.Name)

	// One check-in per habit per day: a second write replaces the note.
	_, err = ts.UpsertPlannerCheckIn(ctx, &store.PlannerCheckIn{CreatorID: user.ID, HabitID: run.ID, Date: "2026-10-16", Note: "5km"})
	require.NoError(t, err)
	again, err := ts.UpsertPlannerCheckIn(ctx, &store.PlannerCheckIn{CreatorID: user.ID, HabitID: run.ID, Date: "2026-10-16", Note: "7km"})
	require.NoError(t, err)
	require.Equal(t, "7km", again.Note)
	_, err = ts.UpsertPlannerCheckIn(ctx, &store.PlannerCheckIn{CreatorID: user.ID, HabitID: run.ID, Date: "2026-11-01"})
	require.NoError(t, err)

	october, err := ts.ListPlannerCheckIns(ctx, &store.FindPlannerCheckIn{CreatorID: user.ID, StartDate: "2026-10-01", EndDate: "2026-10-31"})
	require.NoError(t, err)
	require.Len(t, october, 1)
	require.Equal(t, "7km", october[0].Note)

	require.NoError(t, ts.DeletePlannerCheckIn(ctx, run.ID, "2026-10-16"))
	october, err = ts.ListPlannerCheckIns(ctx, &store.FindPlannerCheckIn{CreatorID: user.ID, StartDate: "2026-10-01", EndDate: "2026-10-31"})
	require.NoError(t, err)
	require.Empty(t, october)
}

func TestPlannerTodosAndNotes(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	user, err := createTestingHostUser(ctx, ts)
	require.NoError(t, err)

	newTodo := func(uid, date string) *store.PlannerTodo {
		todo, err := ts.CreatePlannerTodo(ctx, &store.PlannerTodo{UID: uid, CreatorID: user.ID, Title: uid, Date: date, Status: store.PlannerTodoActive})
		require.NoError(t, err)
		return todo
	}
	newTodo("undated", "")
	later := newTodo("later", "2026-10-20")
	newTodo("earlier", "2026-10-02")

	// Dated todos first by date, undated last.
	active := store.PlannerTodoActive
	open, err := ts.ListPlannerTodos(ctx, &store.FindPlannerTodo{CreatorID: &user.ID, Status: &active})
	require.NoError(t, err)
	require.Equal(t, []string{"earlier", "later", "undated"}, []string{open[0].UID, open[1].UID, open[2].UID})

	// A date range never matches an undated todo.
	ranged, err := ts.ListPlannerTodos(ctx, &store.FindPlannerTodo{CreatorID: &user.ID, StartDate: "2026-10-01", EndDate: "2026-10-31"})
	require.NoError(t, err)
	require.Len(t, ranged, 2)

	// Postponing keeps the original date and counts.
	require.Empty(t, later.OriginalDate)
	require.Zero(t, later.PostponeCount)
	newDate, originalDate, count := "2026-10-25", "2026-10-20", int32(1)
	postponed, err := ts.UpdatePlannerTodo(ctx, &store.UpdatePlannerTodo{ID: later.ID, Date: &newDate, OriginalDate: &originalDate, PostponeCount: &count})
	require.NoError(t, err)
	require.Equal(t, "2026-10-25", postponed.Date)
	require.Equal(t, "2026-10-20", postponed.OriginalDate)
	require.Equal(t, int32(1), postponed.PostponeCount)

	cancelled, reason, overdue, closedTs := store.PlannerTodoCancelled, "不做了", true, int64(1760000000)
	updated, err := ts.UpdatePlannerTodo(ctx, &store.UpdatePlannerTodo{
		ID: later.ID, Status: &cancelled, CancelReason: &reason, ClosedOverdue: &overdue, ClosedTs: &closedTs,
	})
	require.NoError(t, err)
	require.Equal(t, store.PlannerTodoCancelled, updated.Status)
	require.Equal(t, "不做了", updated.CancelReason)
	require.True(t, updated.ClosedOverdue)
	require.Equal(t, closedTs, updated.ClosedTs)
	require.Equal(t, "later", updated.Title, "untouched fields stay")

	open, err = ts.ListPlannerTodos(ctx, &store.FindPlannerTodo{CreatorID: &user.ID, Status: &active})
	require.NoError(t, err)
	require.Len(t, open, 2)

	require.NoError(t, ts.DeletePlannerTodo(ctx, later.ID))
	gone, err := ts.GetPlannerTodo(ctx, &store.FindPlannerTodo{ID: &later.ID})
	require.NoError(t, err)
	require.Nil(t, gone)

	note, err := ts.CreatePlannerNote(ctx, &store.PlannerNote{UID: "n1", CreatorID: user.ID, Date: "2026-10-01", Content: "走路 7 公里"})
	require.NoError(t, err)
	content := "走路 8 公里"
	note, err = ts.UpdatePlannerNote(ctx, &store.UpdatePlannerNote{ID: note.ID, Content: &content})
	require.NoError(t, err)
	require.Equal(t, "走路 8 公里", note.Content)
	notes, err := ts.ListPlannerNotes(ctx, &store.FindPlannerNote{CreatorID: &user.ID, StartDate: "2026-10-01", EndDate: "2026-10-01"})
	require.NoError(t, err)
	require.Len(t, notes, 1)
	require.NoError(t, ts.DeletePlannerNote(ctx, note.ID))
}

func TestPlannerImport(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	user, err := createTestingHostUser(ctx, ts)
	require.NoError(t, err)

	data := &store.PlannerImport{
		CreatorID: user.ID,
		Habits: []*store.PlannerHabit{
			{UID: "h1", Name: "冥想", Position: 0},
			{UID: "h2", Name: "运动", Position: 1},
		},
		CheckIns: []*store.PlannerImportCheckIn{
			{HabitIndex: 0, Date: "2026-10-16", Note: "15"},
			{HabitIndex: 1, Date: "2026-10-16"},
		},
		Todos: []*store.PlannerTodo{{UID: "t1", Title: "作业", Date: "2026-10-17", Status: store.PlannerTodoActive}},
		Notes: []*store.PlannerNote{{UID: "n1", Date: "2026-10-02", Content: "记一笔"}},
	}
	require.NoError(t, ts.ImportPlanner(ctx, data))

	checkIns, err := ts.ListPlannerCheckIns(ctx, &store.FindPlannerCheckIn{CreatorID: user.ID})
	require.NoError(t, err)
	require.Len(t, checkIns, 2)
	habits, err := ts.ListPlannerHabits(ctx, &store.FindPlannerHabit{CreatorID: &user.ID})
	require.NoError(t, err)
	require.Equal(t, habits[0].ID, checkIns[0].HabitID)
	require.Equal(t, "15", checkIns[0].Note)

	// A second import is refused and writes nothing.
	again := &store.PlannerImport{CreatorID: user.ID, Notes: []*store.PlannerNote{{UID: "n2", Date: "2026-10-03", Content: "x"}}}
	require.ErrorIs(t, ts.ImportPlanner(ctx, again), store.ErrPlannerNotEmpty)
	notes, err := ts.ListPlannerNotes(ctx, &store.FindPlannerNote{CreatorID: &user.ID})
	require.NoError(t, err)
	require.Len(t, notes, 1)

	// A bad habit index rolls the whole import back.
	other, err := createTestingUserWithRole(ctx, ts, "other-user", store.RoleUser)
	require.NoError(t, err)
	bad := &store.PlannerImport{
		CreatorID: other.ID,
		Habits:    []*store.PlannerHabit{{UID: "h3", Name: "x"}},
		CheckIns:  []*store.PlannerImportCheckIn{{HabitIndex: 5, Date: "2026-10-01"}},
	}
	require.Error(t, ts.ImportPlanner(ctx, bad))
	otherHabits, err := ts.ListPlannerHabits(ctx, &store.FindPlannerHabit{CreatorID: &other.ID})
	require.NoError(t, err)
	require.Empty(t, otherHabits)
}

func TestPlannerDataDeletedWithUser(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	_, err := createTestingHostUser(ctx, ts)
	require.NoError(t, err)
	member, err := createTestingUserWithRole(ctx, ts, "member", store.RoleUser)
	require.NoError(t, err)

	require.NoError(t, ts.ImportPlanner(ctx, &store.PlannerImport{
		CreatorID: member.ID,
		Habits:    []*store.PlannerHabit{{UID: "h1", Name: "冥想"}},
		CheckIns:  []*store.PlannerImportCheckIn{{HabitIndex: 0, Date: "2026-10-16"}},
		Todos:     []*store.PlannerTodo{{UID: "t1", Title: "作业", Status: store.PlannerTodoActive}},
		Notes:     []*store.PlannerNote{{UID: "n1", Date: "2026-10-02", Content: "记一笔"}},
	}))

	_, err = ts.DeleteUser(ctx, &store.DeleteUser{ID: member.ID})
	require.NoError(t, err)

	habits, err := ts.ListPlannerHabits(ctx, &store.FindPlannerHabit{CreatorID: &member.ID})
	require.NoError(t, err)
	require.Empty(t, habits)
	checkIns, err := ts.ListPlannerCheckIns(ctx, &store.FindPlannerCheckIn{CreatorID: member.ID})
	require.NoError(t, err)
	require.Empty(t, checkIns)
	todos, err := ts.ListPlannerTodos(ctx, &store.FindPlannerTodo{CreatorID: &member.ID})
	require.NoError(t, err)
	require.Empty(t, todos)
	notes, err := ts.ListPlannerNotes(ctx, &store.FindPlannerNote{CreatorID: &member.ID})
	require.NoError(t, err)
	require.Empty(t, notes)
}

func TestPlannerTodoTags(t *testing.T) {
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	defer ts.Close()
	user, err := createTestingHostUser(ctx, ts)
	require.NoError(t, err)

	tags, err := ts.ListPlannerTodoTags(ctx, user.ID)
	require.NoError(t, err)
	require.Empty(t, tags)

	newTodo := func(uid, tag string) *store.PlannerTodo {
		todo, err := ts.CreatePlannerTodo(ctx, &store.PlannerTodo{UID: uid, CreatorID: user.ID, Title: uid, Status: store.PlannerTodoActive, Tag: tag})
		require.NoError(t, err)
		return todo
	}
	newTodo("a", "学业")
	work := newTodo("b", "工作")
	newTodo("c", "学业")
	newTodo("d", "")

	// Distinct, untagged left out, most recently used first.
	_, err = ts.GetDriver().GetDB().ExecContext(ctx, "UPDATE `planner_todo` SET `updated_ts` = 100")
	require.NoError(t, err)
	_, err = ts.GetDriver().GetDB().ExecContext(ctx, "UPDATE `planner_todo` SET `updated_ts` = 200 WHERE `id` = ?", work.ID)
	require.NoError(t, err)
	tags, err = ts.ListPlannerTodoTags(ctx, user.ID)
	require.NoError(t, err)
	require.Equal(t, []string{"工作", "学业"}, tags)

	other := user.ID + 1000
	tags, err = ts.ListPlannerTodoTags(ctx, other)
	require.NoError(t, err)
	require.Empty(t, tags, "another user's tags are not listed")
}

func TestPlannerTodoChecksInItsHabit(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	user, err := createTestingHostUser(ctx, ts)
	require.NoError(t, err)

	run, err := ts.CreatePlannerHabit(ctx, &store.PlannerHabit{UID: "h-run", CreatorID: user.ID, Name: "跑步"})
	require.NoError(t, err)
	todo, err := ts.CreatePlannerTodo(ctx, &store.PlannerTodo{UID: "t-10k", CreatorID: user.ID, Title: "跑 10 公里", Status: store.PlannerTodoActive})
	require.NoError(t, err)
	require.Empty(t, todo.CheckInDate)

	linked, err := ts.UpdatePlannerTodo(ctx, &store.UpdatePlannerTodo{ID: todo.ID, HabitID: &run.ID})
	require.NoError(t, err)
	require.Equal(t, run.ID, linked.HabitID)
	byHabit, err := ts.ListPlannerTodos(ctx, &store.FindPlannerTodo{CreatorID: &user.ID, HabitID: &run.ID})
	require.NoError(t, err)
	require.Len(t, byHabit, 1)

	// Completing writes the check-in in the same step, and the todo read back carries its day.
	done := store.PlannerTodoDone
	completed, err := ts.UpdatePlannerTodo(ctx, &store.UpdatePlannerTodo{
		ID: todo.ID, Status: &done,
		CheckIn: &store.PlannerCheckIn{CreatorID: user.ID, HabitID: run.ID, Date: "2026-10-19", Note: "跑 10 公里"},
	})
	require.NoError(t, err)
	require.Equal(t, "2026-10-19", completed.CheckInDate)
	checkIns, err := ts.ListPlannerCheckIns(ctx, &store.FindPlannerCheckIn{CreatorID: user.ID})
	require.NoError(t, err)
	require.Len(t, checkIns, 1)
	require.Equal(t, todo.ID, checkIns[0].TodoID)
	require.Equal(t, "跑 10 公里", checkIns[0].Note)

	// A day already checked in is refused, and nothing of the update is written.
	other, err := ts.CreatePlannerTodo(ctx, &store.PlannerTodo{UID: "t-5k", CreatorID: user.ID, Title: "跑 5 公里", Status: store.PlannerTodoActive})
	require.NoError(t, err)
	_, err = ts.UpdatePlannerTodo(ctx, &store.UpdatePlannerTodo{
		ID: other.ID, Status: &done,
		CheckIn: &store.PlannerCheckIn{CreatorID: user.ID, HabitID: run.ID, Date: "2026-10-19", Note: "跑 5 公里"},
	})
	require.ErrorIs(t, err, store.ErrPlannerCheckInTaken)
	unchanged, err := ts.GetPlannerTodo(ctx, &store.FindPlannerTodo{ID: &other.ID})
	require.NoError(t, err)
	require.Equal(t, store.PlannerTodoActive, unchanged.Status)

	// Deleting the todo takes its check-in with it.
	require.NoError(t, ts.DeletePlannerTodo(ctx, todo.ID))
	checkIns, err = ts.ListPlannerCheckIns(ctx, &store.FindPlannerCheckIn{CreatorID: user.ID})
	require.NoError(t, err)
	require.Empty(t, checkIns)
}

func TestPlannerHabitVersions(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	user, err := createTestingHostUser(ctx, ts)
	require.NoError(t, err)

	walk, err := ts.CreatePlannerHabit(ctx, &store.PlannerHabit{UID: "h-walk", CreatorID: user.ID, Name: "🚶", Color: 3})
	require.NoError(t, err)
	require.Equal(t, int32(3), walk.Color)
	pray, err := ts.CreatePlannerHabit(ctx, &store.PlannerHabit{UID: "h-pray", CreatorID: user.ID, Name: "🙏"})
	require.NoError(t, err)

	_, err = ts.UpsertPlannerHabitVersion(ctx, &store.PlannerHabitVersion{
		CreatorID: user.ID, EffectiveDate: "2026-10-27",
		Entries: []store.PlannerHabitVersionEntry{{HabitID: pray.ID}},
	}, nil)
	require.NoError(t, err)
	_, err = ts.UpsertPlannerHabitVersion(ctx, &store.PlannerHabitVersion{
		CreatorID: user.ID, EffectiveDate: "",
		Entries: []store.PlannerHabitVersionEntry{{HabitID: walk.ID, WeeklyGoal: 3}, {HabitID: pray.ID}},
	}, nil)
	require.NoError(t, err)

	// Same date again replaces that day's version; a todo can be unlinked in the same step.
	todo, err := ts.CreatePlannerTodo(ctx, &store.PlannerTodo{
		UID: "t-walk", CreatorID: user.ID, Title: "🚶", Date: "2026-10-28", Status: store.PlannerTodoActive, HabitID: walk.ID,
	})
	require.NoError(t, err)
	require.Equal(t, walk.ID, todo.HabitID)
	replaced, err := ts.UpsertPlannerHabitVersion(ctx, &store.PlannerHabitVersion{
		CreatorID: user.ID, EffectiveDate: "2026-10-27",
		Entries: []store.PlannerHabitVersionEntry{{HabitID: pray.ID, WeeklyGoal: 7}},
	}, []int32{todo.ID})
	require.NoError(t, err)
	require.Equal(t, int32(7), replaced.Entries[0].WeeklyGoal)
	unlinked, err := ts.GetPlannerTodo(ctx, &store.FindPlannerTodo{ID: &todo.ID})
	require.NoError(t, err)
	require.Zero(t, unlinked.HabitID)

	versions, err := ts.ListPlannerHabitVersions(ctx, user.ID)
	require.NoError(t, err)
	require.Len(t, versions, 2)
	require.Equal(t, "", versions[0].EffectiveDate, "the beginning sorts first")
	require.Equal(t, []store.PlannerHabitVersionEntry{{HabitID: walk.ID, WeeklyGoal: 3}, {HabitID: pray.ID}}, versions[0].Entries)


	// A draft is enabled on a day: it replaces that day's version, drops later ones, and is gone.
	_, err = ts.EnablePlannerHabitDraft(ctx, user.ID, "2026-10-20", nil)
	require.ErrorIs(t, err, store.ErrPlannerNoDraft)
	none, err := ts.GetPlannerHabitDraft(ctx, user.ID)
	require.NoError(t, err)
	require.Nil(t, none)
	_, err = ts.UpsertPlannerHabitDraft(ctx, &store.PlannerHabitDraft{CreatorID: user.ID, Entries: []store.PlannerHabitVersionEntry{{HabitID: pray.ID}}})
	require.NoError(t, err)
	draft, err := ts.UpsertPlannerHabitDraft(ctx, &store.PlannerHabitDraft{
		CreatorID: user.ID, Entries: []store.PlannerHabitVersionEntry{{HabitID: walk.ID, WeeklyGoal: 2}}, MemoNames: []string{"memos/plan"},
	})
	require.NoError(t, err)
	require.Equal(t, []string{"memos/plan"}, draft.MemoNames)
	enabled, err := ts.EnablePlannerHabitDraft(ctx, user.ID, "2026-10-20", nil)
	require.NoError(t, err)
	require.Equal(t, "2026-10-20", enabled.EffectiveDate)
	require.Equal(t, []string{"memos/plan"}, enabled.MemoNames)
	versions, err = ts.ListPlannerHabitVersions(ctx, user.ID)
	require.NoError(t, err)
	require.Len(t, versions, 2, "the version set for the 27th is dropped")
	require.Equal(t, "2026-10-20", versions[1].EffectiveDate)
	require.Empty(t, versions[0].MemoNames)
	gone, err := ts.GetPlannerHabitDraft(ctx, user.ID)
	require.NoError(t, err)
	require.Nil(t, gone)

	require.NoError(t, ts.DeletePlannerHabitDraft(ctx, user.ID))
}
