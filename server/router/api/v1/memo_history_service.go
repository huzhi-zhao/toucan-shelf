package v1

import (
	"context"
	"fmt"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/lithammer/shortuuid/v4"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/store"
)

// CreateMemoHistory saves a manual snapshot (version) of a memo's current content
// and attachment set. Only the memo's creator or an admin may call this. The
// snapshot always captures the memo's current server-side state; only display_name
// is taken from the request.
func (s *APIV1Service) CreateMemoHistory(ctx context.Context, request *v1pb.CreateMemoHistoryRequest) (*v1pb.MemoHistory, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get user")
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}

	memoUID, err := ExtractMemoUIDFromName(request.Parent)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid memo name: %v", err)
	}
	memo, err := s.Store.GetMemo(ctx, &store.FindMemo{UID: &memoUID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get memo")
	}
	if memo == nil {
		return nil, status.Errorf(codes.NotFound, "memo not found")
	}
	if memo.CreatorID != user.ID && !isSuperUser(user) {
		return nil, status.Errorf(codes.PermissionDenied, "permission denied")
	}

	attachments, err := s.Store.ListAttachments(ctx, &store.FindAttachment{MemoID: &memo.ID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list attachments")
	}
	snapshotAttachments := make([]*store.MemoHistoryAttachment, 0, len(attachments))
	for _, a := range attachments {
		snapshotAttachments = append(snapshotAttachments, &store.MemoHistoryAttachment{
			UID:      a.UID,
			Filename: a.Filename,
			Type:     a.Type,
		})
	}

	displayName := ""
	if request.MemoHistory != nil {
		displayName = request.MemoHistory.DisplayName
	}

	history, err := s.Store.CreateMemoHistory(ctx, &store.MemoHistory{
		UID:         shortuuid.New(),
		MemoID:      memo.ID,
		Name:        displayName,
		Title:       memo.Title,
		Content:     memo.Content,
		Payload:     memo.Payload,
		Attachments: snapshotAttachments,
		CreatorID:   user.ID,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to create memo history")
	}

	return convertMemoHistoryFromStore(history, memo.UID), nil
}

// ListMemoHistories lists all saved versions for a memo, newest first.
// Only the memo's creator or an admin may call this.
func (s *APIV1Service) ListMemoHistories(ctx context.Context, request *v1pb.ListMemoHistoriesRequest) (*v1pb.ListMemoHistoriesResponse, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get user")
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}

	memoUID, err := ExtractMemoUIDFromName(request.Parent)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid memo name: %v", err)
	}
	memo, err := s.Store.GetMemo(ctx, &store.FindMemo{UID: &memoUID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get memo")
	}
	if memo == nil {
		return nil, status.Errorf(codes.NotFound, "memo not found")
	}
	if memo.CreatorID != user.ID && !isSuperUser(user) {
		return nil, status.Errorf(codes.PermissionDenied, "permission denied")
	}

	histories, err := s.Store.ListMemoHistories(ctx, &store.FindMemoHistory{MemoID: &memo.ID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list memo histories")
	}

	response := &v1pb.ListMemoHistoriesResponse{}
	for _, history := range histories {
		response.MemoHistories = append(response.MemoHistories, convertMemoHistoryFromStore(history, memo.UID))
	}
	return response, nil
}

// RestoreMemoHistory switches a memo's content and attachment set back to a saved
// version. It refuses to run (FAILED_PRECONDITION) unless the memo's current state
// still matches its latest saved version, so unsaved edits are never silently lost.
// Attachments dropped by the restore are unlinked (memo_id cleared), not deleted,
// so restoring back to a later version can relink them.
func (s *APIV1Service) RestoreMemoHistory(ctx context.Context, request *v1pb.RestoreMemoHistoryRequest) (*v1pb.Memo, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get user")
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}

	tokens, err := GetNameParentTokens(request.Name, MemoNamePrefix, MemoHistoryNamePrefix)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid history name: %v", err)
	}
	memoUID, historyUID := tokens[0], tokens[1]

	memo, err := s.Store.GetMemo(ctx, &store.FindMemo{UID: &memoUID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get memo")
	}
	if memo == nil {
		return nil, status.Errorf(codes.NotFound, "memo not found")
	}
	if !canModifyMemo(user, memo) {
		return nil, status.Errorf(codes.PermissionDenied, "permission denied")
	}

	histories, err := s.Store.ListMemoHistories(ctx, &store.FindMemoHistory{MemoID: &memo.ID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list memo histories")
	}
	if len(histories) == 0 {
		return nil, status.Errorf(codes.NotFound, "no versions found")
	}
	var target *store.MemoHistory
	for _, h := range histories {
		if h.UID == historyUID {
			target = h
			break
		}
	}
	if target == nil {
		return nil, status.Errorf(codes.NotFound, "version not found")
	}

	// Guard: the memo's current state must match SOME saved version — not
	// necessarily the latest one. A memo sitting at an older restored version is
	// still "safe" (that state is recoverable via its own history record); only
	// a state that matches no saved version at all represents unsaved changes
	// that would be lost by switching.
	currentAttachments, err := s.Store.ListAttachments(ctx, &store.FindAttachment{MemoID: &memo.ID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list attachments")
	}
	currentUIDs := make([]string, 0, len(currentAttachments))
	for _, a := range currentAttachments {
		currentUIDs = append(currentUIDs, a.UID)
	}
	currentHash := store.HashMemoState(memo.Content, currentUIDs)
	matchesSavedVersion := false
	for _, h := range histories {
		if h.ContentHash == currentHash {
			matchesSavedVersion = true
			break
		}
	}
	if !matchesSavedVersion {
		return nil, status.Errorf(codes.FailedPrecondition, "memo has unsaved changes; save a version before restoring")
	}

	// Restore content.
	//
	// Rolling back is a human edit, so it closes any open agent session: the
	// content that ends up stored is one a human chose, and the next agent write
	// must snapshot it before overwriting. This has to be written explicitly —
	// restoring only ever wrote Content, so the bit would otherwise stay true and
	// the agent's next write would overwrite the restored version with no
	// snapshot at all. Only the flag is carried over from the live payload; the
	// rest of the payload is deliberately left as-is, as before.
	restore := &store.UpdateMemo{ID: memo.ID}
	if target.Content != memo.Content {
		restore.Content = &target.Content
	}
	if memo.Payload.GetAgentSessionOpen() {
		memo.Payload.AgentSessionOpen = false
		restore.Payload = memo.Payload
	}
	if restore.Content != nil || restore.Payload != nil {
		if err := s.Store.UpdateMemo(ctx, restore); err != nil {
			return nil, status.Errorf(codes.Internal, "failed to restore memo content")
		}
	}

	// Reconcile attachments to match the target version's set.
	targetUIDs := make(map[string]bool, len(target.Attachments))
	for _, a := range target.Attachments {
		targetUIDs[a.UID] = true
	}
	currentUIDSet := make(map[string]bool, len(currentAttachments))
	for _, a := range currentAttachments {
		currentUIDSet[a.UID] = true
		// Unlink attachments not present in the target version (keep the file).
		if !targetUIDs[a.UID] {
			if err := s.Store.UpdateAttachment(ctx, &store.UpdateAttachment{ID: a.ID, UnsetMemoID: true}); err != nil {
				return nil, status.Errorf(codes.Internal, "failed to unlink attachment")
			}
		}
	}
	// Relink attachments that belong to the target version but aren't currently linked.
	for _, a := range target.Attachments {
		if currentUIDSet[a.UID] {
			continue
		}
		existing, err := s.Store.GetAttachment(ctx, &store.FindAttachment{UID: &a.UID})
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to get attachment")
		}
		if existing == nil {
			// The file was hard-deleted after this version was saved; nothing to relink.
			continue
		}
		if existing.CreatorID != user.ID && !isSuperUser(user) {
			continue
		}
		memoID := memo.ID
		if err := s.Store.UpdateAttachment(ctx, &store.UpdateAttachment{ID: existing.ID, MemoID: &memoID}); err != nil {
			return nil, status.Errorf(codes.Internal, "failed to relink attachment")
		}
	}

	if err := s.touchMemoUpdatedTimestamp(ctx, memo.ID); err != nil {
		return nil, err
	}
	updatedMemo, parentMemo, memoMessage, err := s.buildUpdatedMemoState(ctx, memo.ID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to build updated memo state")
	}
	s.dispatchMemoUpdatedSideEffects(ctx, updatedMemo, parentMemo, memoMessage)
	return memoMessage, nil
}

func convertMemoHistoryFromStore(history *store.MemoHistory, memoUID string) *v1pb.MemoHistory {
	name := fmt.Sprintf("%s%s/%s%s", MemoNamePrefix, memoUID, MemoHistoryNamePrefix, history.UID)
	attachments := make([]*v1pb.MemoHistory_Attachment, 0, len(history.Attachments))
	for _, a := range history.Attachments {
		attachments = append(attachments, &v1pb.MemoHistory_Attachment{
			Uid:      a.UID,
			Filename: a.Filename,
			Type:     a.Type,
		})
	}
	return &v1pb.MemoHistory{
		Name:        name,
		DisplayName: history.Name,
		Title:       history.Title,
		Content:     history.Content,
		ContentHash: history.ContentHash,
		CreateTime:  timestamppb.New(time.Unix(history.CreatedTs, 0)),
		Attachments: attachments,
	}
}
