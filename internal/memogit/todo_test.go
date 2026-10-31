package memogit

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/proto/gen/api/v1/apiv1connect"
)

// fakePlanner records the todo it was asked to create, with the token it came with.
type fakePlanner struct {
	apiv1connect.UnimplementedPlannerServiceHandler
	created *v1pb.CreateTodoRequest
	auth    string
}

func (f *fakePlanner) CreateTodo(_ context.Context, req *connect.Request[v1pb.CreateTodoRequest]) (*connect.Response[v1pb.Todo], error) {
	f.created, f.auth = req.Msg, req.Header().Get("Authorization")
	todo := req.Msg.Todo
	todo.Name = "planner/todos/t1"
	return connect.NewResponse(todo), nil
}

func (f *fakePlanner) GetTodo(_ context.Context, req *connect.Request[v1pb.GetTodoRequest]) (*connect.Response[v1pb.Todo], error) {
	if req.Msg.Name != "planner/todos/t1" {
		return nil, connect.NewError(connect.CodeNotFound, nil)
	}
	return connect.NewResponse(&v1pb.Todo{Name: req.Msg.Name, Status: v1pb.Todo_DONE}), nil
}

func (f *fakePlanner) ListTodoChanges(_ context.Context, req *connect.Request[v1pb.ListTodoChangesRequest]) (*connect.Response[v1pb.ListTodoChangesResponse], error) {
	return connect.NewResponse(&v1pb.ListTodoChangesResponse{
		DeletedTodos:     []*v1pb.DeletedTodo{{Name: "planner/todos/gone"}},
		NextUpdatedSince: timestamppb.New(req.Msg.UpdatedSince.AsTime().Add(time.Hour)),
	}), nil
}

func TestTodoClient(t *testing.T) {
	planner := &fakePlanner{}
	mux := http.NewServeMux()
	mux.Handle(apiv1connect.NewPlannerServiceHandler(planner))
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	client := NewClient(&Config{Server: srv.URL, Token: "memos_pat_x"})
	ctx := context.Background()

	doc := filepath.Join(t.TempDir(), "plan.md")
	if err := os.WriteFile(doc, []byte("# Plan\n\n<!-- memogit-id: memos/abc -->\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	memo, err := DocMemoName(doc)
	if err != nil || memo != "memos/abc" {
		t.Fatalf("DocMemoName = %q, %v", memo, err)
	}
	bare := filepath.Join(t.TempDir(), "new.md")
	if err := os.WriteFile(bare, []byte("# New\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := DocMemoName(bare); err == nil {
		t.Error("a file without a marker should be refused")
	}

	created, err := client.CreateTodo(ctx, &v1pb.Todo{Title: "Renew passport", Memos: []string{memo}}, "2026-10-31")
	if err != nil {
		t.Fatal(err)
	}
	if created.Name != "planner/todos/t1" || planner.created.LocalDate != "2026-10-31" || planner.auth != "Bearer memos_pat_x" {
		t.Errorf("created %q with %+v, auth %q", created.Name, planner.created, planner.auth)
	}

	got, err := client.GetTodo(ctx, "t1")
	if err != nil || got.Status != v1pb.Todo_DONE {
		t.Errorf("GetTodo(t1) = %v, %v", got, err)
	}
	if _, err := client.GetTodo(ctx, "missing"); connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("GetTodo(missing) error = %v", err)
	}

	changes, err := client.ListTodoChanges(ctx, time.Unix(1_700_000_000, 0))
	if err != nil || len(changes.DeletedTodos) != 1 || changes.NextUpdatedSince.AsTime().Unix() != 1_700_003_600 {
		t.Errorf("ListTodoChanges = %v, %v", changes, err)
	}
}
