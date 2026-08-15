package v1

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/store"
)

// accessibleMemoIDs is the candidate set every search — keyword and vector alike —
// is narrowed to before ranking. It used to ask only about visibility, which made
// every PROTECTED document on the instance searchable by every account; this test
// pins the knowledge-base gate that now sits in front of it.
func TestAccessibleMemoIDsStopsAtTheLibraryBoundary(t *testing.T) {
	ctx := context.Background()
	svc := newIntegrationService(t)

	admin, err := svc.Store.CreateUser(ctx, &store.User{
		Username: "rag-admin", Role: store.RoleAdmin, Email: "rag-admin@example.com",
	})
	require.NoError(t, err)
	adminCtx := userCtx(ctx, admin.ID)

	insider, err := svc.Store.CreateUser(ctx, &store.User{
		Username: "rag-insider", Role: store.RoleUser, Email: "rag-insider@example.com",
	})
	require.NoError(t, err)
	outsider, err := svc.Store.CreateUser(ctx, &store.User{
		Username: "rag-outsider", Role: store.RoleUser, Email: "rag-outsider@example.com",
	})
	require.NoError(t, err)

	protected, err := svc.CreateMemo(adminCtx, &v1pb.CreateMemoRequest{
		Memo: &v1pb.Memo{Content: "protected doc", Visibility: v1pb.Visibility_PROTECTED},
	})
	require.NoError(t, err)
	public, err := svc.CreateMemo(adminCtx, &v1pb.CreateMemoRequest{
		Memo: &v1pb.Memo{Content: "public doc", Visibility: v1pb.Visibility_PUBLIC},
	})
	require.NoError(t, err)

	protectedID := memoIDByName(ctx, t, svc, protected.Name)
	publicID := memoIDByName(ctx, t, svc, public.Name)

	// The insider is assigned the library the documents live in; the outsider is not.
	protectedMemo, err := svc.Store.GetMemo(ctx, &store.FindMemo{ID: &protectedID})
	require.NoError(t, err)
	_, err = svc.Store.CreateWorkspaceGrant(ctx, &store.WorkspaceGrant{
		WorkspaceID: protectedMemo.WorkspaceID,
		SubjectType: store.WorkspaceGrantSubjectUser,
		SubjectID:   insider.ID,
		Role:        store.WorkspaceGrantRoleViewer,
		GrantedBy:   admin.ID,
	})
	require.NoError(t, err)

	insiderIDs, err := svc.accessibleMemoIDs(ctx, insider, nil)
	require.NoError(t, err)
	require.Contains(t, insiderIDs, protectedID)
	require.Contains(t, insiderIDs, publicID)

	outsiderIDs, err := svc.accessibleMemoIDs(ctx, outsider, nil)
	require.NoError(t, err)
	require.NotContains(t, outsiderIDs, protectedID)
	// A PUBLIC document stays searchable: anonymous readers already see it, so a
	// signed-in member seeing less than an anonymous one would be the wrong answer.
	require.Contains(t, outsiderIDs, publicID)

	adminIDs, err := svc.accessibleMemoIDs(ctx, admin, nil)
	require.NoError(t, err)
	require.Contains(t, adminIDs, protectedID)
}

func memoIDByName(ctx context.Context, t *testing.T, svc *APIV1Service, name string) int32 {
	t.Helper()
	uid := name[len("memos/"):]
	memo, err := svc.Store.GetMemo(ctx, &store.FindMemo{UID: &uid})
	require.NoError(t, err)
	require.NotNil(t, memo)
	return memo.ID
}
