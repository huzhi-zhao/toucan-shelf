package test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/store"
)

// A comment takes its visibility from the document it hangs on, and used to take it
// only once — at creation. These tests pin the cascade that keeps the two in step
// afterwards.
func TestUpdateMemo_CascadesVisibilityToComments(t *testing.T) {
	ctx := context.Background()

	setup := func(t *testing.T) (*TestService, context.Context, *v1pb.Memo, *v1pb.Memo) {
		t.Helper()
		ts := NewTestService(t)

		user, err := ts.CreateRegularUser(ctx, "cascade-owner")
		require.NoError(t, err)
		userCtx := ts.CreateUserContext(ctx, user.ID)

		parent, err := ts.Service.CreateMemo(userCtx, &v1pb.CreateMemoRequest{
			Memo: &v1pb.Memo{Content: "parent", Visibility: v1pb.Visibility_PUBLIC},
		})
		require.NoError(t, err)

		comment, err := ts.Service.CreateMemoComment(userCtx, &v1pb.CreateMemoCommentRequest{
			Name:    parent.Name,
			Comment: &v1pb.Memo{Content: "comment", Visibility: v1pb.Visibility_PUBLIC},
		})
		require.NoError(t, err)
		require.Equal(t, v1pb.Visibility_PUBLIC, comment.Visibility)

		return ts, userCtx, parent, comment
	}

	updateVisibility := func(t *testing.T, ts *TestService, userCtx context.Context, memo *v1pb.Memo, visibility v1pb.Visibility) {
		t.Helper()
		_, err := ts.Service.UpdateMemo(userCtx, &v1pb.UpdateMemoRequest{
			Memo:       &v1pb.Memo{Name: memo.Name, Visibility: visibility},
			UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"visibility"}},
		})
		require.NoError(t, err)
	}

	t.Run("tightening the parent tightens its comments", func(t *testing.T) {
		ts, userCtx, parent, comment := setup(t)
		defer ts.Cleanup()

		updateVisibility(t, ts, userCtx, parent, v1pb.Visibility_PRIVATE)

		got, err := ts.Service.GetMemo(userCtx, &v1pb.GetMemoRequest{Name: comment.Name})
		require.NoError(t, err)
		require.Equal(t, v1pb.Visibility_PRIVATE, got.Visibility)
	})

	t.Run("loosening the parent loosens its comments", func(t *testing.T) {
		ts, userCtx, parent, comment := setup(t)
		defer ts.Cleanup()

		// Both directions, matching how CreateMemoComment assigns the value: only
		// tightening would leave a document put back to public carrying private
		// comments, which is the same inconsistency the other way around.
		updateVisibility(t, ts, userCtx, parent, v1pb.Visibility_PRIVATE)
		updateVisibility(t, ts, userCtx, parent, v1pb.Visibility_PUBLIC)

		got, err := ts.Service.GetMemo(userCtx, &v1pb.GetMemoRequest{Name: comment.Name})
		require.NoError(t, err)
		require.Equal(t, v1pb.Visibility_PUBLIC, got.Visibility)
	})

	t.Run("a third party loses the comment when the parent goes private", func(t *testing.T) {
		ts, userCtx, parent, comment := setup(t)
		defer ts.Cleanup()

		stranger, err := ts.CreateRegularUser(ctx, "cascade-stranger")
		require.NoError(t, err)
		strangerCtx := ts.CreateUserContext(ctx, stranger.ID)

		_, err = ts.Service.GetMemo(strangerCtx, &v1pb.GetMemoRequest{Name: comment.Name})
		require.NoError(t, err, "the comment starts out readable by anyone")

		updateVisibility(t, ts, userCtx, parent, v1pb.Visibility_PRIVATE)

		_, err = ts.Service.GetMemo(strangerCtx, &v1pb.GetMemoRequest{Name: comment.Name})
		require.Error(t, err)
	})

	t.Run("an unrelated document's visibility is left alone", func(t *testing.T) {
		ts, userCtx, parent, comment := setup(t)
		defer ts.Cleanup()

		other, err := ts.Service.CreateMemo(userCtx, &v1pb.CreateMemoRequest{
			Memo: &v1pb.Memo{Content: "unrelated", Visibility: v1pb.Visibility_PUBLIC},
		})
		require.NoError(t, err)

		updateVisibility(t, ts, userCtx, parent, v1pb.Visibility_PRIVATE)

		got, err := ts.Service.GetMemo(userCtx, &v1pb.GetMemoRequest{Name: other.Name})
		require.NoError(t, err)
		require.Equal(t, v1pb.Visibility_PUBLIC, got.Visibility)

		// And the comment did move, so the assertion above isn't vacuous.
		gotComment, err := ts.Service.GetMemo(userCtx, &v1pb.GetMemoRequest{Name: comment.Name})
		require.NoError(t, err)
		require.Equal(t, v1pb.Visibility_PRIVATE, gotComment.Visibility)
	})

	t.Run("an update that doesn't touch visibility doesn't cascade", func(t *testing.T) {
		ts, userCtx, parent, comment := setup(t)
		defer ts.Cleanup()

		// Put the comment out of step behind the service's back, then edit the
		// parent's content: nothing about that edit should rewrite the comment.
		commentUID := comment.Name[len("memos/"):]
		commentMemo, err := ts.Store.GetMemo(ctx, &store.FindMemo{UID: &commentUID})
		require.NoError(t, err)
		protected := store.Protected
		require.NoError(t, ts.Store.UpdateMemo(ctx, &store.UpdateMemo{ID: commentMemo.ID, Visibility: &protected}))

		_, err = ts.Service.UpdateMemo(userCtx, &v1pb.UpdateMemoRequest{
			Memo:       &v1pb.Memo{Name: parent.Name, Content: "parent edited"},
			UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content"}},
		})
		require.NoError(t, err)

		got, err := ts.Service.GetMemo(userCtx, &v1pb.GetMemoRequest{Name: comment.Name})
		require.NoError(t, err)
		require.Equal(t, v1pb.Visibility_PROTECTED, got.Visibility)
	})
}
