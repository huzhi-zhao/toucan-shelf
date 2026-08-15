package test

import (
	"context"
	"testing"

	"github.com/usememos/memos/internal/markdown"
	"github.com/usememos/memos/internal/profile"
	"github.com/usememos/memos/server/auth"
	apiv1 "github.com/usememos/memos/server/router/api/v1"
	"github.com/usememos/memos/store"
	teststore "github.com/usememos/memos/store/test"
)

// TestService holds the test service setup for API v1 services.
type TestService struct {
	Service *apiv1.APIV1Service
	Store   *store.Store
	Profile *profile.Profile
	Secret  string
}

// NewTestService creates a new test service with SQLite database.
func NewTestService(t *testing.T) *TestService {
	ctx := context.Background()

	// Create a test store with SQLite
	testStore := teststore.NewTestingStore(ctx, t)

	// Align the profile data directory with the test store so attachment files and
	// derived caches resolve against the same location as DeleteAttachmentStorage.
	testProfile := &profile.Profile{
		Demo:        true,
		Version:     "test-1.0.0",
		Commit:      "test-commit",
		InstanceURL: "http://localhost:8080",
		Driver:      "sqlite",
		DSN:         ":memory:",
		Data:        testStore.GetDataDir(),
	}

	// Create APIV1Service with nil grpcServer since we're testing direct calls
	secret := "test-secret"
	markdownService := markdown.NewService(
		markdown.WithTagExtension(),
		markdown.WithMentionExtension(),
	)
	service := &apiv1.APIV1Service{
		Secret:          secret,
		Profile:         testProfile,
		Store:           testStore,
		MarkdownService: markdownService,
		SSEHub:          apiv1.NewSSEHub(),
	}

	return &TestService{
		Service: service,
		Store:   testStore,
		Profile: testProfile,
		Secret:  secret,
	}
}

// Cleanup closes resources after test.
func (ts *TestService) Cleanup() {
	ts.Store.Close()
}

// CreateHostUser creates an admin user for testing.
func (ts *TestService) CreateHostUser(ctx context.Context, username string) (*store.User, error) {
	return ts.Store.CreateUser(ctx, &store.User{
		Username: username,
		Role:     store.RoleAdmin,
		Email:    username + "@example.com",
	})
}

// CreateRegularUser creates a regular member for testing, with one knowledge base
// assigned to them as EDITOR.
//
// A member with no grant at all cannot create or read a single document, so tests
// about anything other than authorization would otherwise all have to set an
// assignment up by hand. Tests that specifically exercise "member without access"
// use CreateUnassignedUser instead.
func (ts *TestService) CreateRegularUser(ctx context.Context, username string) (*store.User, error) {
	user, _, err := ts.CreateRegularUserWithWorkspace(ctx, username)
	return user, err
}

// CreateRegularUserWithWorkspace is CreateRegularUser plus the knowledge base it
// assigned, for tests that need to put a second member into the same one.
func (ts *TestService) CreateRegularUserWithWorkspace(ctx context.Context, username string) (*store.User, *store.Workspace, error) {
	user, err := ts.CreateUnassignedUser(ctx, username)
	if err != nil {
		return nil, nil, err
	}
	workspace, err := ts.CreateWorkspaceForUser(ctx, user, username+"'s workspace", store.WorkspaceGrantRoleEditor)
	if err != nil {
		return nil, nil, err
	}
	return user, workspace, nil
}

// GrantWorkspace gives the user the given role in an existing knowledge base.
func (ts *TestService) GrantWorkspace(ctx context.Context, workspaceID int32, user *store.User, role store.WorkspaceGrantRole) error {
	_, err := ts.Store.CreateWorkspaceGrant(ctx, &store.WorkspaceGrant{
		WorkspaceID: workspaceID,
		SubjectType: store.WorkspaceGrantSubjectUser,
		SubjectID:   user.ID,
		Role:        role,
		GrantedBy:   user.ID,
	})
	return err
}

// CreateUnassignedUser creates a regular member with no knowledge base assigned.
func (ts *TestService) CreateUnassignedUser(ctx context.Context, username string) (*store.User, error) {
	return ts.Store.CreateUser(ctx, &store.User{
		Username: username,
		Role:     store.RoleUser,
		Email:    username + "@example.com",
	})
}

// CreateWorkspaceForUser creates a knowledge base and grants the user the given role
// in it.
func (ts *TestService) CreateWorkspaceForUser(ctx context.Context, user *store.User, title string, role store.WorkspaceGrantRole) (*store.Workspace, error) {
	uid, err := apiv1.ValidateAndGenerateUID("")
	if err != nil {
		return nil, err
	}
	slug, err := ts.Store.GenerateStorageSlug(ctx, uid, title)
	if err != nil {
		return nil, err
	}
	workspace, err := ts.Store.CreateWorkspace(ctx, &store.Workspace{
		UID:         uid,
		CreatorID:   user.ID,
		Title:       title,
		StorageSlug: slug,
	})
	if err != nil {
		return nil, err
	}
	if _, err := ts.Store.CreateWorkspaceGrant(ctx, &store.WorkspaceGrant{
		WorkspaceID: workspace.ID,
		SubjectType: store.WorkspaceGrantSubjectUser,
		SubjectID:   user.ID,
		Role:        role,
		GrantedBy:   user.ID,
	}); err != nil {
		return nil, err
	}
	return workspace, nil
}

// CreateUserContext creates a context with the given user's ID for authentication.
func (*TestService) CreateUserContext(ctx context.Context, userID int32) context.Context {
	// Use the context key from the auth package
	return context.WithValue(ctx, auth.UserIDContextKey, userID)
}
