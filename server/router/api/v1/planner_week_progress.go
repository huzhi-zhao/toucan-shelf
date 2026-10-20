package v1

import (
	"cmp"
	"context"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

// Week progress is the planner's read-only report for callers outside the app: a reminder bot, an agent asked
// "how did this week go". Weeks split on the caller's planner setting and each is measured against the plan in
// effect on its last day, the same rules the app's "2/3" follows, so the two never disagree. It reports facts;
// judging a week is the caller's business. See planner-and-check-in.md §2.4.3.

// plannerMaxProgressWeeks caps GetWeekProgress: enough for "eight weeks in a row".
const plannerMaxProgressWeeks = 12

func (s *APIV1Service) GetPlannerSettings(ctx context.Context, _ *v1pb.GetPlannerSettingsRequest) (*v1pb.PlannerSettings, error) {
	user, err := s.plannerUser(ctx)
	if err != nil {
		return nil, err
	}
	setting, err := s.plannerUserSetting(ctx, user)
	if err != nil {
		return nil, err
	}
	return &v1pb.PlannerSettings{WeekStartDay: setting.WeekStartDay}, nil
}

func (s *APIV1Service) UpdatePlannerSettings(ctx context.Context, request *v1pb.UpdatePlannerSettingsRequest) (*v1pb.PlannerSettings, error) {
	user, err := s.plannerUser(ctx)
	if err != nil {
		return nil, err
	}
	if request.Settings == nil {
		return nil, status.Errorf(codes.InvalidArgument, "settings is required")
	}
	weekStart := request.Settings.WeekStartDay
	if weekStart < 0 || weekStart > 7 {
		return nil, status.Errorf(codes.InvalidArgument, "week_start_day must be 0 to 7, got %d", weekStart)
	}
	if _, err := s.Store.UpsertUserSetting(ctx, &storepb.UserSetting{
		UserId: user.ID,
		Key:    storepb.UserSetting_PLANNER,
		Value:  &storepb.UserSetting_Planner{Planner: &storepb.PlannerUserSetting{WeekStartDay: weekStart}},
	}); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to save planner settings: %v", err)
	}
	return &v1pb.PlannerSettings{WeekStartDay: weekStart}, nil
}

func (s *APIV1Service) plannerUserSetting(ctx context.Context, user *store.User) (*storepb.PlannerUserSetting, error) {
	setting, err := s.Store.GetUserSetting(ctx, &store.FindUserSetting{UserID: &user.ID, Key: storepb.UserSetting_PLANNER})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get planner settings: %v", err)
	}
	if setting.GetPlanner() == nil {
		return &storepb.PlannerUserSetting{}, nil
	}
	return setting.GetPlanner(), nil
}

// plannerWeekStart is the day the caller's planner weeks start on, 1 = Monday … 7 = Sunday: their setting, or
// the instance's week start when the setting follows it.
func (s *APIV1Service) plannerWeekStart(ctx context.Context, user *store.User) (int32, error) {
	setting, err := s.plannerUserSetting(ctx, user)
	if err != nil {
		return 0, err
	}
	if setting.WeekStartDay != 0 {
		return setting.WeekStartDay, nil
	}
	general, err := s.Store.GetInstanceGeneralSetting(ctx)
	if err != nil {
		return 0, status.Errorf(codes.Internal, "failed to get instance setting: %v", err)
	}
	// The instance counts from Sunday = 0.
	offset := ((general.GetWeekStartDayOffset() % 7) + 7) % 7
	if offset == 0 {
		return 7, nil
	}
	return offset, nil
}

// plannerWeekOf is the week date falls in, weekStart being 1 = Monday … 7 = Sunday.
func plannerWeekOf(date time.Time, weekStart int32) (time.Time, time.Time) {
	back := (int(date.Weekday()) - int(weekStart%7) + 7) % 7
	start := date.AddDate(0, 0, -back)
	return start, start.AddDate(0, 0, 6)
}

func (s *APIV1Service) GetWeekProgress(ctx context.Context, request *v1pb.GetWeekProgressRequest) (*v1pb.GetWeekProgressResponse, error) {
	user, err := s.plannerUser(ctx)
	if err != nil {
		return nil, err
	}
	date, err := parsePlannerDate(request.Date, "date", false)
	if err != nil {
		return nil, err
	}
	weeks := request.Weeks
	if weeks == 0 {
		weeks = 1
	}
	if weeks < 1 || weeks > plannerMaxProgressWeeks {
		return nil, status.Errorf(codes.InvalidArgument, "weeks must be 1 to %d, got %d", plannerMaxProgressWeeks, weeks)
	}
	weekStart, err := s.plannerWeekStart(ctx, user)
	if err != nil {
		return nil, err
	}

	day, _ := time.Parse(time.DateOnly, date)
	currentStart, currentEnd := plannerWeekOf(day, weekStart)
	rangeStart := currentStart.AddDate(0, 0, -7*int(weeks-1)).Format(time.DateOnly)
	rangeEnd := currentEnd.Format(time.DateOnly)

	habits, err := s.Store.ListPlannerHabits(ctx, &store.FindPlannerHabit{CreatorID: &user.ID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list habits: %v", err)
	}
	habitByID := make(map[int32]*store.PlannerHabit, len(habits))
	for _, habit := range habits {
		habitByID[habit.ID] = habit
	}
	versions, err := s.listHabitVersions(ctx, user)
	if err != nil {
		return nil, err
	}
	checkIns, err := s.Store.ListPlannerCheckIns(ctx, &store.FindPlannerCheckIn{CreatorID: user.ID, StartDate: rangeStart, EndDate: rangeEnd})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list check-ins: %v", err)
	}
	slices.SortStableFunc(checkIns, func(a, b *store.PlannerCheckIn) int { return cmp.Compare(a.Date, b.Date) })
	todos, err := s.Store.ListPlannerTodos(ctx, &store.FindPlannerTodo{CreatorID: &user.ID, StartDate: rangeStart, EndDate: rangeEnd})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list todos: %v", err)
	}
	slices.SortStableFunc(todos, func(a, b *store.PlannerTodo) int { return cmp.Compare(a.Date, b.Date) })

	documents := map[string]*v1pb.WeekPlanDocument{}
	response := &v1pb.GetWeekProgressResponse{WeekStartDay: weekStart, Weeks: []*v1pb.WeekProgress{}}
	for i := range int(weeks) {
		start := currentStart.AddDate(0, 0, -7*i).Format(time.DateOnly)
		end := currentStart.AddDate(0, 0, -7*i+6).Format(time.DateOnly)
		week := &v1pb.WeekProgress{
			WeekStart:  start,
			WeekEnd:    end,
			Habits:     []*v1pb.WeekHabitProgress{},
			HabitTodos: []*v1pb.WeekHabitTodo{},
		}
		if i == 0 {
			week.ContainsDate = true
			week.DaysLeft = int32(currentEnd.Sub(day).Hours()/24) + 1
		}

		plan := habitVersionOn(versions, end)
		if plan != nil {
			week.Plan = s.weekPlan(ctx, plan, versions, start, documents)
		}

		progressByHabit := map[int32]*v1pb.WeekHabitProgress{}
		progress := func(habitID int32) *v1pb.WeekHabitProgress {
			if p, ok := progressByHabit[habitID]; ok {
				return p
			}
			habit := habitByID[habitID]
			if habit == nil {
				return nil
			}
			icon, label := splitHabitTitle(habit.Name)
			p := &v1pb.WeekHabitProgress{Habit: habitNamePrefix + habit.UID, Icon: icon, Label: label, CheckIns: []*v1pb.WeekCheckIn{}}
			progressByHabit[habitID] = p
			week.Habits = append(week.Habits, p)
			return p
		}
		if plan != nil {
			for _, entry := range plan.Entries {
				p := progress(entry.HabitID)
				if p == nil {
					continue
				}
				p.InPlan = true
				if entry.WeeklyGoal > 0 {
					goal := entry.WeeklyGoal
					p.WeeklyGoal = &goal
				}
			}
		}
		for _, checkIn := range checkIns {
			if checkIn.Date < start || checkIn.Date > end {
				continue
			}
			p := progress(checkIn.HabitID)
			if p == nil {
				continue
			}
			p.CheckInCount++
			p.CheckIns = append(p.CheckIns, &v1pb.WeekCheckIn{Date: checkIn.Date, Note: checkIn.Note, Todo: plannerName(todoNamePrefix, checkIn.TodoUID)})
		}
		for _, todo := range todos {
			if todo.HabitID == 0 || todo.Date < start || todo.Date > end {
				continue
			}
			week.HabitTodos = append(week.HabitTodos, &v1pb.WeekHabitTodo{
				Name:  todoNamePrefix + todo.UID,
				Date:  todo.Date,
				Title: todo.Title,
				Habit: plannerName(habitNamePrefix, todo.HabitUID),
				State: habitTodoState(todo, date),
			})
		}
		response.Weeks = append(response.Weeks, week)
	}
	return response, nil
}

// weekPlan describes the plan a week is measured against, naming the plans it replaced during the week.
// documents caches titles across weeks, which mostly share a plan.
func (s *APIV1Service) weekPlan(ctx context.Context, plan *store.PlannerHabitVersion, versions []*store.PlannerHabitVersion, weekStart string, documents map[string]*v1pb.WeekPlanDocument) *v1pb.WeekPlan {
	result := &v1pb.WeekPlan{EffectiveDate: plan.EffectiveDate, Replaced: []string{}, Documents: []*v1pb.WeekPlanDocument{}}
	if first := habitVersionOn(versions, weekStart); first != nil && first != plan {
		for _, version := range versions {
			if version == plan {
				break
			}
			if version == first || version.EffectiveDate > weekStart {
				result.Replaced = append(result.Replaced, version.EffectiveDate)
			}
		}
	}
	for _, name := range plan.MemoNames {
		document, ok := documents[name]
		if !ok {
			document = &v1pb.WeekPlanDocument{Name: name, Title: s.readableMemoTitle(ctx, name)}
			documents[name] = document
		}
		result.Documents = append(result.Documents, document)
	}
	return result
}

// readableMemoTitle is a linked document's title, or "" when it is gone or the caller cannot read it.
func (s *APIV1Service) readableMemoTitle(ctx context.Context, name string) string {
	uid, err := ExtractMemoUIDFromName(name)
	if err != nil {
		return ""
	}
	memo, err := s.Store.GetMemo(ctx, &store.FindMemo{UID: &uid})
	if err != nil || memo == nil {
		return ""
	}
	if err := s.checkMemoReadAccess(ctx, memo); err != nil {
		return ""
	}
	return memo.Title
}

// habitTodoState is a habit todo's state with today as given: past its day and not done, it has failed
// (requirement §2.4.2 §5), which is worked out, not stored.
func habitTodoState(todo *store.PlannerTodo, today string) v1pb.WeekHabitTodo_State {
	switch todo.Status {
	case store.PlannerTodoDone:
		return v1pb.WeekHabitTodo_DONE
	case store.PlannerTodoCancelled:
		return v1pb.WeekHabitTodo_CANCELLED
	case store.PlannerTodoActive:
		if todo.Date < today {
			return v1pb.WeekHabitTodo_FAILED
		}
		return v1pb.WeekHabitTodo_ACTIVE
	default:
		return v1pb.WeekHabitTodo_STATE_UNSPECIFIED
	}
}

// splitHabitTitle reads a habit's icon and label from its title, as the app does: a title starts with an emoji,
// the icon, and the rest is the label. A title that does not start with one uses its first character as the icon
// and the whole title as the label.
func splitHabitTitle(title string) (string, string) {
	title = strings.TrimSpace(title)
	if title == "" {
		return "", ""
	}
	n := emojiPrefixLength(title)
	if n == 0 {
		_, size := utf8.DecodeRuneInString(title)
		return title[:size], title
	}
	return title[:n], strings.TrimSpace(title[n:])
}

// emojiPrefixLength is the byte length of the emoji the value starts with, or 0: one pictograph with its
// variation selector, skin tone, keycap and tag marks, joined to more by zero-width joiners, or a flag's pair of
// regional indicators. It stands in for the grapheme segmentation the app gets from Intl.Segmenter.
func emojiPrefixLength(value string) int {
	r, size := utf8.DecodeRuneInString(value)
	if isRegionalIndicator(r) {
		if next, nextSize := utf8.DecodeRuneInString(value[size:]); isRegionalIndicator(next) {
			return size + nextSize
		}
		return size
	}
	if !isPictographic(r) {
		return 0
	}
	n := size
	for n < len(value) {
		r, size := utf8.DecodeRuneInString(value[n:])
		switch {
		case r == 0xFE0F || r == 0x20E3 || (r >= 0x1F3FB && r <= 0x1F3FF) || (r >= 0xE0020 && r <= 0xE007F):
			n += size
		case r == 0x200D:
			next, nextSize := utf8.DecodeRuneInString(value[n+size:])
			if !isPictographic(next) {
				return n
			}
			n += size + nextSize
		default:
			return n
		}
	}
	return n
}

func isRegionalIndicator(r rune) bool { return r >= 0x1F1E6 && r <= 0x1F1FF }

// isPictographic approximates Unicode's Extended_Pictographic, which Go's unicode tables lack.
func isPictographic(r rune) bool {
	switch {
	case r >= 0x1F000 && r <= 0x1FAFF, r >= 0x2600 && r <= 0x27BF, r >= 0x2300 && r <= 0x23FF, r >= 0x2B00 && r <= 0x2BFF:
		return true
	case r >= 0x2190 && r <= 0x21FF, r >= 0x25A0 && r <= 0x25FF, r >= 0x2934 && r <= 0x2935:
		return true
	}
	switch r {
	case 0x00A9, 0x00AE, 0x203C, 0x2049, 0x2122, 0x2139, 0x24C2, 0x3030, 0x303D, 0x3297, 0x3299:
		return true
	}
	return false
}
