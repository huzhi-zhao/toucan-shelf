package test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/fieldmaskpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
)

// ListTodoChanges returns the todos changed since a time, closed ones too, and the ones deleted since then,
// only the caller's; a deleted todo is gone from GetTodo.
func TestListTodoChanges(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()
	user, err := ts.CreateRegularUser(ctx, "planner")
	require.NoError(t, err)
	app := ts.CreateUserContext(ctx, user.ID)
	other, err := ts.CreateRegularUser(ctx, "other")
	require.NoError(t, err)
	otherApp := ts.CreateUserContext(ctx, other.ID)

	since := timestamppb.New(time.Now().Add(-time.Minute))
	newTodo := func(ctx context.Context, title string) *v1pb.Todo {
		todo, err := ts.Service.CreateTodo(ctx, &v1pb.CreateTodoRequest{Todo: &v1pb.Todo{Title: title, Date: "2026-11-02"}})
		require.NoError(t, err)
		require.NotEmpty(t, todo.Name)
		return todo
	}
	kept, done, gone := newTodo(app, "kept"), newTodo(app, "done"), newTodo(app, "gone")
	newTodo(otherApp, "not mine")

	done.Status = v1pb.Todo_DONE
	_, err = ts.Service.UpdateTodo(app, &v1pb.UpdateTodoRequest{Todo: done, UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"status"}}, LocalDate: "2026-11-01"})
	require.NoError(t, err)
	_, err = ts.Service.DeleteTodo(app, &v1pb.DeleteTodoRequest{Name: gone.Name})
	require.NoError(t, err)

	changes, err := ts.Service.ListTodoChanges(app, &v1pb.ListTodoChangesRequest{UpdatedSince: since})
	require.NoError(t, err)
	statuses := map[string]v1pb.Todo_Status{}
	for _, todo := range changes.Todos {
		statuses[todo.Name] = todo.Status
	}
	require.Equal(t, map[string]v1pb.Todo_Status{kept.Name: v1pb.Todo_ACTIVE, done.Name: v1pb.Todo_DONE}, statuses)
	require.Len(t, changes.DeletedTodos, 1)
	require.Equal(t, gone.Name, changes.DeletedTodos[0].Name)
	require.NotNil(t, changes.NextUpdatedSince)

	got, err := ts.Service.GetTodo(app, &v1pb.GetTodoRequest{Name: done.Name})
	require.NoError(t, err)
	require.Equal(t, v1pb.Todo_DONE, got.Status)
	_, err = ts.Service.GetTodo(app, &v1pb.GetTodoRequest{Name: gone.Name})
	requireCode(t, err, codes.NotFound)

	later, err := ts.Service.ListTodoChanges(app, &v1pb.ListTodoChangesRequest{UpdatedSince: timestamppb.New(time.Now().Add(time.Hour))})
	require.NoError(t, err)
	require.Empty(t, later.Todos)
	require.Empty(t, later.DeletedTodos)

	_, err = ts.Service.ListTodoChanges(app, &v1pb.ListTodoChangesRequest{})
	requireCode(t, err, codes.InvalidArgument)
}
