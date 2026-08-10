package test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	apiv1 "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
	apiv1service "github.com/usememos/memos/server/router/api/v1"
	"github.com/usememos/memos/store"
)

func TestDeleteMemoShare_VerifiesShareBelongsToMemo(t *testing.T) {
	ctx := context.Background()

	ts := NewTestService(t)
	defer ts.Cleanup()

	userOne, err := ts.CreateRegularUser(ctx, "share-owner-one")
	require.NoError(t, err)
	userTwo, err := ts.CreateRegularUser(ctx, "share-owner-two")
	require.NoError(t, err)

	userOneCtx := ts.CreateUserContext(ctx, userOne.ID)
	userTwoCtx := ts.CreateUserContext(ctx, userTwo.ID)

	memoOne, err := ts.Service.CreateMemo(userOneCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{
			Content:    "memo one",
			Visibility: apiv1.Visibility_PRIVATE,
		},
	})
	require.NoError(t, err)

	memoTwo, err := ts.Service.CreateMemo(userTwoCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{
			Content:    "memo two",
			Visibility: apiv1.Visibility_PRIVATE,
		},
	})
	require.NoError(t, err)

	share, err := ts.Service.CreateMemoShare(userTwoCtx, &apiv1.CreateMemoShareRequest{
		Parent:    memoTwo.Name,
		MemoShare: &apiv1.MemoShare{},
	})
	require.NoError(t, err)

	shareToken := share.Name[strings.LastIndex(share.Name, "/")+1:]
	forgedName := memoOne.Name + "/shares/" + shareToken

	_, err = ts.Service.DeleteMemoShare(userOneCtx, &apiv1.DeleteMemoShareRequest{
		Name: forgedName,
	})
	require.Error(t, err)
	require.Equal(t, codes.NotFound, status.Code(err))

	sharedMemo, err := ts.Service.GetMemoByShare(ctx, &apiv1.GetMemoByShareRequest{
		ShareId: shareToken,
	})
	require.NoError(t, err)
	require.Equal(t, memoTwo.Name, sharedMemo.Name)
}

func TestGetMemoByShare_IncludesReactions(t *testing.T) {
	ctx := context.Background()

	ts := NewTestService(t)
	defer ts.Cleanup()

	user, err := ts.CreateRegularUser(ctx, "share-reactions")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	memo, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{
			Content:    "memo with reactions",
			Visibility: apiv1.Visibility_PRIVATE,
		},
	})
	require.NoError(t, err)

	reaction, err := ts.Service.UpsertMemoReaction(userCtx, &apiv1.UpsertMemoReactionRequest{
		Name: memo.Name,
		Reaction: &apiv1.Reaction{
			ContentId:    memo.Name,
			ReactionType: "👍",
		},
	})
	require.NoError(t, err)
	require.NotNil(t, reaction)

	share, err := ts.Service.CreateMemoShare(userCtx, &apiv1.CreateMemoShareRequest{
		Parent:    memo.Name,
		MemoShare: &apiv1.MemoShare{},
	})
	require.NoError(t, err)

	shareToken := share.Name[strings.LastIndex(share.Name, "/")+1:]
	sharedMemo, err := ts.Service.GetMemoByShare(ctx, &apiv1.GetMemoByShareRequest{
		ShareId: shareToken,
	})
	require.NoError(t, err)
	require.Len(t, sharedMemo.Reactions, 1)
	require.Equal(t, "👍", sharedMemo.Reactions[0].ReactionType)
	require.Equal(t, memo.Name, sharedMemo.Reactions[0].ContentId)
}

func TestGetMemoByShare_SkipsReactionsWithMissingCreators(t *testing.T) {
	ctx := context.Background()

	ts := NewTestService(t)
	defer ts.Cleanup()

	owner, err := ts.CreateRegularUser(ctx, "share-owner")
	require.NoError(t, err)
	ownerCtx := ts.CreateUserContext(ctx, owner.ID)

	reactor, err := ts.CreateRegularUser(ctx, "share-reaction-orphan")
	require.NoError(t, err)
	reactorCtx := ts.CreateUserContext(ctx, reactor.ID)

	memo, err := ts.Service.CreateMemo(ownerCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{
			Content:    "memo with orphan share reaction",
			Visibility: apiv1.Visibility_PUBLIC,
		},
	})
	require.NoError(t, err)

	_, err = ts.Service.UpsertMemoReaction(reactorCtx, &apiv1.UpsertMemoReactionRequest{
		Name: memo.Name,
		Reaction: &apiv1.Reaction{
			ContentId:    memo.Name,
			ReactionType: "👍",
		},
	})
	require.NoError(t, err)

	share, err := ts.Service.CreateMemoShare(ownerCtx, &apiv1.CreateMemoShareRequest{
		Parent:    memo.Name,
		MemoShare: &apiv1.MemoShare{},
	})
	require.NoError(t, err)

	_, err = ts.Store.DeleteUser(ctx, &store.DeleteUser{ID: reactor.ID})
	require.NoError(t, err)

	shareToken := share.Name[strings.LastIndex(share.Name, "/")+1:]
	sharedMemo, err := ts.Service.GetMemoByShare(ctx, &apiv1.GetMemoByShareRequest{
		ShareId: shareToken,
	})
	require.NoError(t, err)
	require.Empty(t, sharedMemo.Reactions)
}

func TestGetMemoByShare_ReturnsNotFoundForUnknownShare(t *testing.T) {
	ctx := context.Background()

	ts := NewTestService(t)
	defer ts.Cleanup()

	_, err := ts.Service.GetMemoByShare(ctx, &apiv1.GetMemoByShareRequest{
		ShareId: "missing-share-token",
	})
	require.Error(t, err)
	require.Equal(t, codes.NotFound, status.Code(err))
}

func TestGetMemoByShare_ReturnsNotFoundForExpiredShare(t *testing.T) {
	ctx := context.Background()

	ts := NewTestService(t)
	defer ts.Cleanup()

	user, err := ts.CreateRegularUser(ctx, "share-expired")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	memo, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{
			Content:    "memo with expired share",
			Visibility: apiv1.Visibility_PRIVATE,
		},
	})
	require.NoError(t, err)

	expiredTs := time.Now().Add(-time.Hour).Unix()
	expiredShare, err := ts.Store.CreateMemoShare(ctx, &store.MemoShare{
		UID:       "expired-share-token",
		MemoID:    parseMemoIDFromNameForTest(t, ts, memo.Name),
		CreatorID: user.ID,
		ExpiresTs: &expiredTs,
	})
	require.NoError(t, err)

	_, err = ts.Service.GetMemoByShare(ctx, &apiv1.GetMemoByShareRequest{
		ShareId: expiredShare.UID,
	})
	require.Error(t, err)
	require.Equal(t, codes.NotFound, status.Code(err))
}

func TestGetMemoByShare_ReturnsNotFoundForArchivedMemo(t *testing.T) {
	ctx := context.Background()

	ts := NewTestService(t)
	defer ts.Cleanup()

	user, err := ts.CreateRegularUser(ctx, "share-archived")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	memoResp, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{
			Content:    "memo that will be archived",
			Visibility: apiv1.Visibility_PRIVATE,
		},
	})
	require.NoError(t, err)

	share, err := ts.Service.CreateMemoShare(userCtx, &apiv1.CreateMemoShareRequest{
		Parent:    memoResp.Name,
		MemoShare: &apiv1.MemoShare{},
	})
	require.NoError(t, err)

	memoID := parseMemoIDFromNameForTest(t, ts, memoResp.Name)
	memo, err := ts.Store.GetMemo(ctx, &store.FindMemo{ID: &memoID})
	require.NoError(t, err)
	require.NotNil(t, memo)

	archived := store.Archived
	err = ts.Store.UpdateMemo(ctx, &store.UpdateMemo{
		ID:        memo.ID,
		RowStatus: &archived,
	})
	require.NoError(t, err)

	shareToken := share.Name[strings.LastIndex(share.Name, "/")+1:]
	_, err = ts.Service.GetMemoByShare(ctx, &apiv1.GetMemoByShareRequest{
		ShareId: shareToken,
	})
	require.Error(t, err)
	require.Equal(t, codes.NotFound, status.Code(err))
}

// TestGetMemoByShare_HidesLockedAttachments guards P4 of the attachment access
// control plan: a share link stands in for the reader's identity, but a locked
// attachment answers to nothing but its creator's own unlocked vault. Without this
// filter, GetMemoByShare listed every attachment's filename and locked flag to
// anyone holding the link, undermining the "locked hides the filename" decision.
func TestGetMemoByShare_HidesLockedAttachments(t *testing.T) {
	ctx := context.Background()

	ts := NewTestService(t)
	defer ts.Cleanup()

	owner, err := ts.CreateRegularUser(ctx, "share-vault-owner")
	require.NoError(t, err)
	ownerCtx := ts.CreateUserContext(ctx, owner.ID)

	memo, err := ts.Service.CreateMemo(ownerCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{
			Content:    "memo with a locked attachment",
			Visibility: apiv1.Visibility_PUBLIC,
		},
	})
	require.NoError(t, err)

	_, err = ts.Service.CreateAttachment(ownerCtx, &apiv1.CreateAttachmentRequest{
		Attachment: &apiv1.Attachment{Filename: "open.txt", Type: "text/plain", Content: []byte("open"), Memo: &memo.Name},
	})
	require.NoError(t, err)

	lockedAttachment, err := ts.Service.CreateAttachment(ownerCtx, &apiv1.CreateAttachmentRequest{
		Attachment: &apiv1.Attachment{Filename: "secret.txt", Type: "text/plain", Content: []byte("secret"), Memo: &memo.Name},
	})
	require.NoError(t, err)

	lockedUID, err := apiv1service.ExtractAttachmentUIDFromName(lockedAttachment.Name)
	require.NoError(t, err)
	storedLocked, err := ts.Store.GetAttachment(ctx, &store.FindAttachment{UID: &lockedUID})
	require.NoError(t, err)
	payload := storedLocked.Payload
	if payload == nil {
		payload = &storepb.AttachmentPayload{}
	}
	payload.Locked = true
	require.NoError(t, ts.Store.UpdateAttachment(ctx, &store.UpdateAttachment{ID: storedLocked.ID, Payload: payload}))

	share, err := ts.Service.CreateMemoShare(ownerCtx, &apiv1.CreateMemoShareRequest{
		Parent:    memo.Name,
		MemoShare: &apiv1.MemoShare{},
	})
	require.NoError(t, err)
	shareToken := share.Name[strings.LastIndex(share.Name, "/")+1:]

	sharedMemo, err := ts.Service.GetMemoByShare(ctx, &apiv1.GetMemoByShareRequest{ShareId: shareToken})
	require.NoError(t, err)

	var names []string
	for _, a := range sharedMemo.Attachments {
		names = append(names, a.Filename)
	}
	require.Contains(t, names, "open.txt")
	require.NotContains(t, names, "secret.txt")
	require.Len(t, sharedMemo.Attachments, 1)
}

func parseMemoIDFromNameForTest(t *testing.T, ts *TestService, memoName string) int32 {
	t.Helper()

	memoUID, ok := strings.CutPrefix(memoName, "memos/")
	require.True(t, ok, "memo name must start with memos/: %s", memoName)

	memo, err := ts.Store.GetMemo(context.Background(), &store.FindMemo{UID: &memoUID})
	require.NoError(t, err)
	require.NotNil(t, memo)

	return memo.ID
}
