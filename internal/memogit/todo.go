package memogit

import (
	"context"
	"os"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/pkg/errors"
	"google.golang.org/protobuf/types/known/timestamppb"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
)

// The user's todos in the app's plan, for agents that hand the user things only they can do (see the manual's
// "用户待办" section). memogit only lists, creates and reads them: a todo's status is the user's, changed in the
// app, never here.

// ListOpenTodos returns every open todo of the checkout's user, to check for an existing one before adding.
func (c *Client) ListOpenTodos(ctx context.Context) ([]*v1pb.Todo, error) {
	resp, err := c.planner.ListOpenTodos(ctx, connect.NewRequest(&v1pb.ListOpenTodosRequest{}))
	if err != nil {
		return nil, errors.Wrap(err, "list open todos")
	}
	return resp.Msg.Todos, nil
}

// CreateTodo adds a todo to the user's plan, marked as made by an agent. localDate is the caller's today.
func (c *Client) CreateTodo(ctx context.Context, todo *v1pb.Todo, localDate string) (*v1pb.Todo, error) {
	resp, err := c.planner.CreateTodo(ctx, connect.NewRequest(&v1pb.CreateTodoRequest{Todo: todo, LocalDate: localDate}))
	if err != nil {
		return nil, errors.Wrap(err, "create todo")
	}
	return resp.Msg, nil
}

// GetTodo returns one todo by its name (planner/todos/<id>) or bare id.
func (c *Client) GetTodo(ctx context.Context, name string) (*v1pb.Todo, error) {
	resp, err := c.planner.GetTodo(ctx, connect.NewRequest(&v1pb.GetTodoRequest{Name: TodoName(name)}))
	if err != nil {
		return nil, errors.Wrap(err, "get todo")
	}
	return resp.Msg, nil
}

// ListTodoChanges returns the todos created or changed since a time, closed ones included, and the ones deleted.
func (c *Client) ListTodoChanges(ctx context.Context, since time.Time) (*v1pb.ListTodoChangesResponse, error) {
	resp, err := c.planner.ListTodoChanges(ctx, connect.NewRequest(&v1pb.ListTodoChangesRequest{UpdatedSince: timestamppb.New(since)}))
	if err != nil {
		return nil, errors.Wrap(err, "list todo changes")
	}
	return resp.Msg, nil
}

// TodoName turns a bare todo id into its resource name; a full name is returned as is.
func TodoName(idOrName string) string {
	if strings.HasPrefix(idOrName, "planner/todos/") {
		return idOrName
	}
	return "planner/todos/" + idOrName
}

// DocMemoName returns the memo name (memos/<uid>) of a checked-out document file, read from its identity marker.
// A file without one (not pushed yet, or not a checkout document) is an error: push it first.
func DocMemoName(path string) (string, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return "", errors.Wrap(err, "read document")
	}
	uid := ParseLocalID(string(content))
	if uid == "" {
		return "", errors.Errorf("%s has no memogit-id marker: push it first, or it is not a document of this checkout", path)
	}
	return "memos/" + uid, nil
}
