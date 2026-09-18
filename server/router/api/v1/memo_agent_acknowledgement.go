package v1

import (
	"context"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/usememos/memos/internal/base"
	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/store"
)

// AcknowledgeAgentEdit clears the editor notice for the current MCP-authored
// content without changing content, timestamps, or the baseline-snapshot bit.
func (s *APIV1Service) AcknowledgeAgentEdit(ctx context.Context, request *v1pb.AcknowledgeAgentEditRequest) (*v1pb.Memo, error) {
	if request == nil {
		return nil, status.Errorf(codes.InvalidArgument, "memo name is required")
	}
	memoUID, err := ExtractMemoUIDFromName(request.Name)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid memo name: %v", err)
	}
	memo, err := s.Store.GetMemo(ctx, &store.FindMemo{UID: &memoUID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get memo: %v", err)
	}
	if memo == nil {
		return nil, status.Errorf(codes.NotFound, "memo not found")
	}
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user")
	}
	if err := s.checkMemoWriteAccess(ctx, user, memo); err != nil {
		return nil, err
	}
	if base.ActorKindFromContext(ctx).IsAgent() {
		return nil, status.Errorf(codes.PermissionDenied, "only a human can acknowledge an agent edit")
	}
	if memo.Payload != nil && memo.Payload.GetAgentSessionOpen() && !memo.Payload.GetAgentEditAcknowledged() {
		memo.Payload.AgentEditAcknowledged = true
		if err := s.Store.UpdateMemo(ctx, &store.UpdateMemo{ID: memo.ID, Payload: memo.Payload}); err != nil {
			return nil, status.Errorf(codes.Internal, "failed to acknowledge agent edit: %v", err)
		}
		if s.SSEHub != nil {
			s.SSEHub.Broadcast(&SSEEvent{
				Type:       SSEEventMemoUpdated,
				Name:       request.Name,
				Visibility: memo.Visibility,
				CreatorID:  memo.CreatorID,
			})
		}
	}
	return s.GetMemo(ctx, &v1pb.GetMemoRequest{Name: request.Name})
}
