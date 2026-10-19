import { create } from "@bufbuild/protobuf";
import { FieldMaskSchema } from "@bufbuild/protobuf/wkt";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { plannerServiceClient } from "@/connect";
import {
  CheckInSchema,
  HabitSchema,
  type ImportPlannerRequest,
  PlannerNoteSchema,
  type Todo,
  TodoSchema,
} from "@/types/proto/api/v1/planner_service_pb";

// The planner is personal data (habits, check-ins, todos, notes); see
// docs/dev/requirements/planner-and-check-in.md. Every write invalidates the
// whole `planner` key: the queries are small, and a check-in or a closed todo
// shows up in several of them at once (the month, the open list, a detail page).
export const plannerKeys = {
  all: ["planner"] as const,
  habits: () => [...plannerKeys.all, "habits"] as const,
  entries: (startDate: string, endDate: string) => [...plannerKeys.all, "entries", startDate, endDate] as const,
  openTodos: () => [...plannerKeys.all, "openTodos"] as const,
  todo: (name?: string) => [...plannerKeys.all, "todo", name] as const,
  todoTags: () => [...plannerKeys.all, "todoTags"] as const,
};

export function useHabits() {
  return useQuery({
    queryKey: plannerKeys.habits(),
    queryFn: async () => (await plannerServiceClient.listHabits({})).habits,
  });
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

function usePlannerMutation<TArgs, TResult>(mutationFn: (args: TArgs) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: plannerKeys.all }),
  });
}

export function useCreateHabit() {
  return usePlannerMutation((title: string) => plannerServiceClient.createHabit({ habit: create(HabitSchema, { title }) }));
}

export function useUpdateHabit() {
  return usePlannerMutation(
    ({ name, title, archived, position }: { name: string; title?: string; archived?: boolean; position?: number }) => {
      const paths = [title !== undefined && "title", archived !== undefined && "archived", position !== undefined && "position"].filter(
        (path): path is string => Boolean(path),
      );
      return plannerServiceClient.updateHabit({
        habit: create(HabitSchema, { name, title, archived, position }),
        updateMask: create(FieldMaskSchema, { paths }),
      });
    },
  );
}

/** Checks in, or with `checked: false` removes the check-in. `note` replaces the remark. */
export function useSetCheckIn() {
  return usePlannerMutation(async ({ habit, date, note, checked }: { habit: string; date: string; note?: string; checked: boolean }) => {
    if (!checked) {
      await plannerServiceClient.deleteCheckIn({ habit, date });
      return;
    }
    await plannerServiceClient.setCheckIn({ checkIn: create(CheckInSchema, { habit, date, note: note ?? "" }) });
  });
}

export function useCreateTodo() {
  return usePlannerMutation(({ title, date }: { title: string; date: string }) =>
    plannerServiceClient.createTodo({ todo: create(TodoSchema, { title, date }) }),
  );
}

type TodoField = "title" | "date" | "status" | "cancelReason" | "important" | "tag" | "note" | "memos" | "url";

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
};

/**
 * Changes the given fields of a todo. `localDate` is the phone's today: the server
 * needs it when a change closes the todo, to record whether it was closed overdue.
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

export function useUpdatePlannerNote() {
  return usePlannerMutation(({ name, content }: { name: string; content: string }) =>
    plannerServiceClient.updatePlannerNote({
      note: create(PlannerNoteSchema, { name, content }),
      updateMask: create(FieldMaskSchema, { paths: ["content"] }),
    }),
  );
}

export function useDeletePlannerNote() {
  return usePlannerMutation((name: string) => plannerServiceClient.deletePlannerNote({ name }));
}

export function useImportPlanner() {
  return usePlannerMutation((request: ImportPlannerRequest) => plannerServiceClient.importPlanner(request));
}
