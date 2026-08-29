package test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	apiv1 "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/store"
)

// TestMemoLinkIndexP0 covers the P0 reverse-link index: saving a memo whose
// content links to other memos (by absolute /memos/{uid} href, and by
// relative path) populates memo_link, and edits keep it in sync.
func TestMemoLinkIndexP0(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	user, err := ts.CreateRegularUser(ctx, "user")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	target, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Title: "Target Doc", Content: "target content", Visibility: apiv1.Visibility_PRIVATE},
	})
	require.NoError(t, err)
	targetUID := memoUIDFromName(t, target.Name)
	targetMemo, err := ts.Store.GetMemo(ctx, &store.FindMemo{UID: &targetUID})
	require.NoError(t, err)

	t.Run("absolute link is indexed on create", func(t *testing.T) {
		source, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
			Memo: &apiv1.Memo{
				Title:   "Source Doc",
				Content: "See [Target Doc](/memos/" + targetUID + ") for details.",
			},
		})
		require.NoError(t, err)
		sourceUID := memoUIDFromName(t, source.Name)
		sourceMemo, err := ts.Store.GetMemo(ctx, &store.FindMemo{UID: &sourceUID})
		require.NoError(t, err)

		links, err := ts.Store.ListMemoLinks(ctx, &store.FindMemoLink{MemoID: &sourceMemo.ID})
		require.NoError(t, err)
		require.Len(t, links, 1)
		require.Equal(t, targetMemo.ID, links[0].TargetMemoID)
	})

	t.Run("root-relative path link resolves via the workspace tree and is indexed", func(t *testing.T) {
		source, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
			Memo: &apiv1.Memo{
				Title:   "Source Doc 2",
				Content: "See [Target Doc](/Target%20Doc.md) for details.",
			},
		})
		require.NoError(t, err)
		sourceUID := memoUIDFromName(t, source.Name)
		sourceMemo, err := ts.Store.GetMemo(ctx, &store.FindMemo{UID: &sourceUID})
		require.NoError(t, err)

		links, err := ts.Store.ListMemoLinks(ctx, &store.FindMemoLink{MemoID: &sourceMemo.ID})
		require.NoError(t, err)
		require.Len(t, links, 1)
		require.Equal(t, targetMemo.ID, links[0].TargetMemoID)
	})

	// R1 (docs/dev/requirements/document-reference-forms.md) reverses the
	// 2026-08-07 decision that retired relative paths: a document-relative
	// href now resolves against the referencing document's own folder, and is
	// indexed like any other document link.
	t.Run("bare relative path resolves against the source document's folder and is indexed", func(t *testing.T) {
		source, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
			Memo: &apiv1.Memo{
				Title:   "Source Doc 2b",
				Content: "See [Target Doc](Target%20Doc.md) for details.",
			},
		})
		require.NoError(t, err)
		sourceUID := memoUIDFromName(t, source.Name)
		sourceMemo, err := ts.Store.GetMemo(ctx, &store.FindMemo{UID: &sourceUID})
		require.NoError(t, err)

		links, err := ts.Store.ListMemoLinks(ctx, &store.FindMemoLink{MemoID: &sourceMemo.ID})
		require.NoError(t, err)
		require.Len(t, links, 1)
		require.Equal(t, targetMemo.ID, links[0].TargetMemoID)
	})

	t.Run("explicit ./ relative path resolves and is indexed", func(t *testing.T) {
		source, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
			Memo: &apiv1.Memo{
				Title:   "Source Doc 2c",
				Content: "See [Target Doc](./Target%20Doc.md) for details.",
			},
		})
		require.NoError(t, err)
		sourceUID := memoUIDFromName(t, source.Name)
		sourceMemo, err := ts.Store.GetMemo(ctx, &store.FindMemo{UID: &sourceUID})
		require.NoError(t, err)

		links, err := ts.Store.ListMemoLinks(ctx, &store.FindMemoLink{MemoID: &sourceMemo.ID})
		require.NoError(t, err)
		require.Len(t, links, 1)
		require.Equal(t, targetMemo.ID, links[0].TargetMemoID)
	})

	t.Run("a relative path climbing above the workspace root resolves to nothing", func(t *testing.T) {
		source, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
			Memo: &apiv1.Memo{
				Title:   "Source Doc 2d",
				Content: "See [Target Doc](../Target%20Doc.md) for details.",
			},
		})
		require.NoError(t, err)
		sourceUID := memoUIDFromName(t, source.Name)
		sourceMemo, err := ts.Store.GetMemo(ctx, &store.FindMemo{UID: &sourceUID})
		require.NoError(t, err)

		links, err := ts.Store.ListMemoLinks(ctx, &store.FindMemoLink{MemoID: &sourceMemo.ID})
		require.NoError(t, err)
		require.Empty(t, links, "\"..\" must not escape the workspace root")
	})

	t.Run("re-editing content overwrites the index rather than appending", func(t *testing.T) {
		other, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
			Memo: &apiv1.Memo{Title: "Other Doc", Content: "other content"},
		})
		require.NoError(t, err)
		otherUID := memoUIDFromName(t, other.Name)
		otherMemo, err := ts.Store.GetMemo(ctx, &store.FindMemo{UID: &otherUID})
		require.NoError(t, err)

		source, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
			Memo: &apiv1.Memo{Title: "Source Doc 3", Content: "See [Target Doc](/memos/" + targetUID + ")."},
		})
		require.NoError(t, err)
		sourceUID := memoUIDFromName(t, source.Name)
		sourceMemo, err := ts.Store.GetMemo(ctx, &store.FindMemo{UID: &sourceUID})
		require.NoError(t, err)

		links, err := ts.Store.ListMemoLinks(ctx, &store.FindMemoLink{MemoID: &sourceMemo.ID})
		require.NoError(t, err)
		require.Len(t, links, 1)
		require.Equal(t, targetMemo.ID, links[0].TargetMemoID)

		_, err = ts.Service.UpdateMemo(userCtx, &apiv1.UpdateMemoRequest{
			Memo:       &apiv1.Memo{Name: source.Name, Content: "Now links to [Other Doc](/memos/" + otherUID + ") instead."},
			UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content"}},
		})
		require.NoError(t, err)

		links, err = ts.Store.ListMemoLinks(ctx, &store.FindMemoLink{MemoID: &sourceMemo.ID})
		require.NoError(t, err)
		require.Len(t, links, 1, "the stale link to target must be gone, not just appended to")
		require.Equal(t, otherMemo.ID, links[0].TargetMemoID)
	})

	t.Run("a dangling href is dropped, not an error", func(t *testing.T) {
		source, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
			Memo: &apiv1.Memo{Title: "Source Doc 4", Content: "See [Nowhere](/memos/does-not-exist)."},
		})
		require.NoError(t, err)
		sourceUID := memoUIDFromName(t, source.Name)
		sourceMemo, err := ts.Store.GetMemo(ctx, &store.FindMemo{UID: &sourceUID})
		require.NoError(t, err)

		links, err := ts.Store.ListMemoLinks(ctx, &store.FindMemoLink{MemoID: &sourceMemo.ID})
		require.NoError(t, err)
		require.Empty(t, links)
	})
}

// TestMemoLinkDependencyP1 covers the read-only dependency check: archiving
// or deleting a memo that other documents still link to must be rejected.
func TestMemoLinkDependencyP1(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	user, err := ts.CreateRegularUser(ctx, "user")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	target, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Title: "Target Doc", Content: "target content"},
	})
	require.NoError(t, err)
	targetUID := memoUIDFromName(t, target.Name)

	_, err = ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Title: "Referencing Doc", Content: "See [Target Doc](/memos/" + targetUID + ")."},
	})
	require.NoError(t, err)

	t.Run("deleting a referenced memo is rejected", func(t *testing.T) {
		_, err := ts.Service.DeleteMemo(userCtx, &apiv1.DeleteMemoRequest{Name: target.Name})
		require.Error(t, err)
		require.Equal(t, codes.FailedPrecondition, status.Code(err))
		require.Contains(t, err.Error(), "Referencing Doc")
	})

	t.Run("archiving a referenced memo is rejected", func(t *testing.T) {
		_, err := ts.Service.UpdateMemo(userCtx, &apiv1.UpdateMemoRequest{
			Memo:       &apiv1.Memo{Name: target.Name, State: apiv1.State_ARCHIVED},
			UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"state"}},
		})
		require.Error(t, err)
		require.Equal(t, codes.FailedPrecondition, status.Code(err))
		require.Contains(t, err.Error(), "Referencing Doc")
	})

	t.Run("an unreferenced memo can be archived and deleted freely", func(t *testing.T) {
		lonely, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
			Memo: &apiv1.Memo{Title: "Lonely Doc", Content: "nobody links to me"},
		})
		require.NoError(t, err)

		_, err = ts.Service.UpdateMemo(userCtx, &apiv1.UpdateMemoRequest{
			Memo:       &apiv1.Memo{Name: lonely.Name, State: apiv1.State_ARCHIVED},
			UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"state"}},
		})
		require.NoError(t, err)

		_, err = ts.Service.DeleteMemo(userCtx, &apiv1.DeleteMemoRequest{Name: lonely.Name})
		require.NoError(t, err)
	})

	t.Run("removing the reference lifts the block", func(t *testing.T) {
		other, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
			Memo: &apiv1.Memo{Title: "Solo Doc", Content: "no links here"},
		})
		require.NoError(t, err)
		soloUID := memoUIDFromName(t, other.Name)

		referrer, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
			Memo: &apiv1.Memo{Title: "Referrer", Content: "See [Solo Doc](/memos/" + soloUID + ")."},
		})
		require.NoError(t, err)

		_, err = ts.Service.DeleteMemo(userCtx, &apiv1.DeleteMemoRequest{Name: other.Name})
		require.Error(t, err)

		// Edit the referrer so it no longer links to `other`.
		_, err = ts.Service.UpdateMemo(userCtx, &apiv1.UpdateMemoRequest{
			Memo:       &apiv1.Memo{Name: referrer.Name, Content: "no more links"},
			UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content"}},
		})
		require.NoError(t, err)

		_, err = ts.Service.DeleteMemo(userCtx, &apiv1.DeleteMemoRequest{Name: other.Name})
		require.NoError(t, err)
	})
}

// TestMemoLinkRenameRepairP2 covers silent anchor-text repair on rename: when
// a memo's title changes, referencing documents whose anchor text equals the
// old title are updated in place; hand-edited anchors are left alone.
func TestMemoLinkRenameRepairP2(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	user, err := ts.CreateRegularUser(ctx, "user")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	target, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Title: "Old Title", Content: "target content"},
	})
	require.NoError(t, err)
	targetUID := memoUIDFromName(t, target.Name)

	absLinker, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Title: "Absolute Linker", Content: "See [Old Title](/memos/" + targetUID + ")."},
	})
	require.NoError(t, err)

	relLinker, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Title: "Relative Linker", Content: "See [Old Title](/Old%20Title.md)."},
	})
	require.NoError(t, err)

	customLinker, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Title: "Custom Linker", Content: "See [my custom label](/memos/" + targetUID + ")."},
	})
	require.NoError(t, err)

	// Rename the target document.
	_, err = ts.Service.UpdateMemo(userCtx, &apiv1.UpdateMemoRequest{
		Memo:       &apiv1.Memo{Name: target.Name, Title: "New Title"},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"title"}},
	})
	require.NoError(t, err)

	t.Run("absolute-link anchor equal to the old title is rewritten", func(t *testing.T) {
		updated, err := ts.Service.GetMemo(userCtx, &apiv1.GetMemoRequest{Name: absLinker.Name})
		require.NoError(t, err)
		require.Contains(t, updated.Content, "[New Title](/memos/"+targetUID+")")
		require.NotContains(t, updated.Content, "[Old Title]")
	})

	t.Run("root-relative link href and anchor are both rewritten on rename (P4)", func(t *testing.T) {
		updated, err := ts.Service.GetMemo(userCtx, &apiv1.GetMemoRequest{Name: relLinker.Name})
		require.NoError(t, err)
		// The canonical href for the renamed target is a fresh CanonicalHref
		// computed from its new title (space -> "<...>" wrapping, no extension
		// carried over from the old href).
		require.Contains(t, updated.Content, "[New Title](/New%20Title)")
		require.NotContains(t, updated.Content, "Old Title")
		require.NotContains(t, updated.Content, "Old%20Title")
	})

	t.Run("a hand-edited anchor is left untouched", func(t *testing.T) {
		updated, err := ts.Service.GetMemo(userCtx, &apiv1.GetMemoRequest{Name: customLinker.Name})
		require.NoError(t, err)
		require.Contains(t, updated.Content, "[my custom label](/memos/"+targetUID+")")
	})

	t.Run("repeated rename-triggered repair is idempotent", func(t *testing.T) {
		before, err := ts.Service.GetMemo(userCtx, &apiv1.GetMemoRequest{Name: absLinker.Name})
		require.NoError(t, err)

		// Renaming again with the same title (no-op update.Title change) must
		// not touch already-repaired documents a second time.
		_, err = ts.Service.UpdateMemo(userCtx, &apiv1.UpdateMemoRequest{
			Memo:       &apiv1.Memo{Name: target.Name, Title: "New Title"},
			UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"title"}},
		})
		require.NoError(t, err)

		after, err := ts.Service.GetMemo(userCtx, &apiv1.GetMemoRequest{Name: absLinker.Name})
		require.NoError(t, err)
		require.Equal(t, before.Content, after.Content)
		require.Equal(t, before.UpdateTime.AsTime(), after.UpdateTime.AsTime())
	})
}

func memoUIDFromName(t *testing.T, name string) string {
	t.Helper()
	// name is "memos/{uid}".
	const prefix = "memos/"
	require.Greater(t, len(name), len(prefix))
	return name[len(prefix):]
}
