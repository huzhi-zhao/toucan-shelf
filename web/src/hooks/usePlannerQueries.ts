import { create } from "@bufbuild/protobuf";
import { FieldMaskSchema } from "@bufbuild/protobuf/wkt";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { memoServiceClient, plannerServiceClient } from "@/connect";
import { buildMemoCreatorFilter } from "@/helpers/resource-names";
import { State } from "@/types/proto/api/v1/common_pb";
import {
  CheckInSchema,
  HabitSchema,
  HabitVersionSchema,
  type ImportPlannerRequest,
  type PlannerNote,
  PlannerNoteSchema,
  type PlannerSettings,
  PlannerSettingsSchema,
  type Todo,
  TodoSchema,
  type Workout,
} from "@/types/proto/api/v1/planner_service_pb";
import { EXERCISE_KIND_FILTER, guideOf } from "@/utils/exerciseLibrary";

// The planner is personal data (habits, check-ins, todos, notes); see
// docs/dev/requirements/planner-and-check-in.md. Every write invalidates the
// whole `planner` key: the queries are small, and a check-in or a closed todo
// shows up in several of them at once (the month, the open list, a detail page).
export const plannerKeys = {
  all: ["planner"] as const,
  habits: () => [...plannerKeys.all, "habits"] as const,
  habitVersions: () => [...plannerKeys.all, "habitVersions"] as const,
  entries: (startDate: string, endDate: string) => [...plannerKeys.all, "entries", startDate, endDate] as const,
  openTodos: () => [...plannerKeys.all, "openTodos"] as const,
  todo: (name?: string) => [...plannerKeys.all, "todo", name] as const,
  note: (name?: string) => [...plannerKeys.all, "note", name] as const,
  todoTags: () => [...plannerKeys.all, "todoTags"] as const,
  settings: () => [...plannerKeys.all, "settings"] as const,
  exerciseLibrary: (creator: string) => [...plannerKeys.all, "exerciseLibrary", creator] as const,
};

export function useHabits() {
  return useQuery({
    queryKey: plannerKeys.habits(),
    queryFn: async () => (await plannerServiceClient.listHabits({})).habits,
  });
}

const listHabitPlans = () => plannerServiceClient.listHabitVersions({});

/** Which habits are in use when (requirement §2.4.2): the enabled versions, earliest first. */
export function useHabitVersions() {
  return useQuery({ queryKey: plannerKeys.habitVersions(), queryFn: listHabitPlans, select: (response) => response.versions });
}

/** The enabled versions and the draft not yet enabled (undefined when there is none). */
export function useHabitPlans() {
  return useQuery({ queryKey: plannerKeys.habitVersions(), queryFn: listHabitPlans });
}

/** Everything dated within an inclusive range: one calendar month plus its spill-over days. */
export function usePlannerEntries(startDate: string, endDate: string) {
  return useQuery({
    queryKey: plannerKeys.entries(startDate, endDate),
    queryFn: () => plannerServiceClient.listPlannerEntries({ startDate, endDate }),
    placeholderData: (previous) => previous,
  });
}

export function useOpenTodos() {
  return useQuery({
    queryKey: plannerKeys.openTodos(),
    queryFn: async () => (await plannerServiceClient.listOpenTodos({})).todos,
  });
}

/** Tags already used on todos, most recent first: the history to pick a tag from. */
export function useTodoTags() {
  return useQuery({
    queryKey: plannerKeys.todoTags(),
    queryFn: async () => (await plannerServiceClient.listTodoTags({})).tags,
  });
}

export function useTodo(name: string | undefined) {
  return useQuery({
    queryKey: plannerKeys.todo(name),
    queryFn: () => plannerServiceClient.getTodo({ name: name! }),
    enabled: !!name,
  });
}

export function usePlannerNote(name: string | undefined) {
  return useQuery({
    queryKey: plannerKeys.note(name),
    queryFn: () => plannerServiceClient.getPlannerNote({ name: name! }),
    enabled: !!name,
  });
}

function usePlannerMutation<TArgs, TResult>(mutationFn: (args: TArgs) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: plannerKeys.all }),
  });
}

/** The planner settings kept on the server, shared by every device and API caller: today, the week start. */
export function usePlannerSettings() {
  return useQuery({ queryKey: plannerKeys.settings(), queryFn: () => plannerServiceClient.getPlannerSettings({}) });
}

/** Saves the week start (1 = Monday … 7 = Sunday, 0 to follow the instance), showing it at once. */
export function useUpdatePlannerSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (weekStartDay: number) =>
      plannerServiceClient.updatePlannerSettings({ settings: create(PlannerSettingsSchema, { weekStartDay }) }),
    onMutate: (weekStartDay) => {
      const previous = queryClient.getQueryData<PlannerSettings>(plannerKeys.settings());
      queryClient.setQueryData(plannerKeys.settings(), create(PlannerSettingsSchema, { weekStartDay }));
      return { previous };
    },
    onError: (_error, _weekStartDay, context) => queryClient.setQueryData(plannerKeys.settings(), context?.previous),
    onSettled: () => queryClient.invalidateQueries({ queryKey: plannerKeys.settings() }),
  });
}

export function useCreateHabit() {
  return usePlannerMutation((title: string) => plannerServiceClient.createHabit({ habit: create(HabitSchema, { title }) }));
}

export function useUpdateHabit() {
  return usePlannerMutation(({ name, title, color }: { name: string; title?: string; color?: number }) => {
    const paths = [title !== undefined && "title", color !== undefined && "color"].filter((path): path is string => Boolean(path));
    return plannerServiceClient.updateHabit({
      habit: create(HabitSchema, { name, title, color }),
      updateMask: create(FieldMaskSchema, { paths }),
    });
  });
}

/** Saves the plan draft, creating it or replacing the one there. A draft takes no effect. */
export function useSaveHabitDraft() {
  return usePlannerMutation(({ entries, memos }: { entries: { habit: string; weeklyGoal: number; pinned: boolean }[]; memos: string[] }) =>
    plannerServiceClient.updateHabitDraft({ draft: create(HabitVersionSchema, { entries, memos }) }),
  );
}

export function useDeleteHabitDraft() {
  return usePlannerMutation(() => plannerServiceClient.deleteHabitDraft({}));
}

/**
 * Enables the draft from `localDate` (the phone's today) on. With `unlinkTodos`, habit todos it leaves
 * without their habit become plain todos; without it the server refuses (FailedPrecondition) so the user
 * can be asked first.
 */
export function useEnableHabitDraft() {
  return usePlannerMutation(({ localDate, unlinkTodos }: { localDate: string; unlinkTodos: boolean }) =>
    plannerServiceClient.enableHabitDraft({ localDate, unlinkTodos }),
  );
}

/** Checks in, or with `checked: false` removes the check-in. `note` replaces the remark. */
export function useSetCheckIn() {
  return usePlannerMutation(
    async ({
      habit,
      date,
      note,
      checked,
      workout,
    }: {
      habit: string;
      date: string;
      note?: string;
      checked: boolean;
      workout?: Workout;
    }) => {
      if (!checked) {
        await plannerServiceClient.deleteCheckIn({ habit, date });
        return;
      }
      // Without a workout the server keeps the one there; an empty one removes it.
      await plannerServiceClient.setCheckIn({ checkIn: create(CheckInSchema, { habit, date, note: note ?? "", workout }) });
    },
  );
}

/** Creates a todo; with `habit`, a habit todo for `date`, which then needs the phone's today as `localDate`. */
export function useCreateTodo() {
  return usePlannerMutation(({ title, date, habit, localDate }: { title: string; date: string; habit?: string; localDate?: string }) =>
    plannerServiceClient.createTodo({ todo: create(TodoSchema, { title, date, habit: habit ?? "" }), localDate: localDate ?? "" }),
  );
}

type TodoField = "title" | "date" | "status" | "cancelReason" | "important" | "tag" | "note" | "memos" | "url" | "plannedWorkout";

const TODO_MASK_PATHS: Record<TodoField, string> = {
  title: "title",
  date: "date",
  status: "status",
  cancelReason: "cancel_reason",
  important: "important",
  tag: "tag",
  note: "note",
  memos: "memos",
  url: "url",
  plannedWorkout: "planned_workout",
};

/**
 * Changes the given fields of a todo. `localDate` is the phone's today: the server
 * needs it when a change closes the todo, to record whether it was closed overdue,
 * and to refuse completing a habit todo ahead of its day.
 */
export function useUpdateTodo() {
  return usePlannerMutation(
    ({ name, changes, localDate }: { name: string; changes: Partial<Pick<Todo, TodoField>>; localDate: string }) => {
      const paths = (Object.keys(changes) as TodoField[]).map((field) => TODO_MASK_PATHS[field]);
      return plannerServiceClient.updateTodo({
        todo: create(TodoSchema, { name, ...changes }),
        updateMask: create(FieldMaskSchema, { paths }),
        localDate,
      });
    },
  );
}

export function usePostponeTodo() {
  return usePlannerMutation(({ name, date, localDate }: { name: string; date: string; localDate: string }) =>
    plannerServiceClient.postponeTodo({ name, date, localDate }),
  );
}

export function useDeleteTodo() {
  return usePlannerMutation((name: string) => plannerServiceClient.deleteTodo({ name }));
}

export function useCreatePlannerNote() {
  return usePlannerMutation(({ date, content }: { date: string; content: string }) =>
    plannerServiceClient.createPlannerNote({ note: create(PlannerNoteSchema, { date, content }) }),
  );
}

type NoteField = "content" | "remark" | "memos";

/** Changes the given fields of a note. */
export function useUpdatePlannerNote() {
  return usePlannerMutation(({ name, changes }: { name: string; changes: Partial<Pick<PlannerNote, NoteField>> }) =>
    plannerServiceClient.updatePlannerNote({
      note: create(PlannerNoteSchema, { name, ...changes }),
      updateMask: create(FieldMaskSchema, { paths: Object.keys(changes) }),
    }),
  );
}

export function useDeletePlannerNote() {
  return usePlannerMutation((name: string) => plannerServiceClient.deletePlannerNote({ name }));
}

export function useImportPlanner() {
  return usePlannerMutation((request: ImportPlannerRequest) => plannerServiceClient.importPlanner(request));
}

/**
 * The exercise library (requirement §2.4.4): the creator's unarchived documents with `kind: exercise` in their
 * frontmatter. Loaded only when `enabled`, i.e. while picking an exercise.
 */
export function useExerciseLibrary(creator: string, enabled: boolean) {
  return useQuery({
    queryKey: plannerKeys.exerciseLibrary(creator),
    queryFn: async () => {
      const filter = [buildMemoCreatorFilter(creator), EXERCISE_KIND_FILTER].filter(Boolean).join(" && ");
      const response = await memoServiceClient.listMemos({ pageSize: 1000, state: State.NORMAL, filter });
      return response.memos.flatMap((memo) => guideOf(memo) ?? []);
    },
    enabled: enabled && Boolean(creator),
    staleTime: 60_000,
  });
}
