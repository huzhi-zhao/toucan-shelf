package v1

import (
	"context"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/emptypb"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
)

// This file contains all Connect service handler method implementations.
// Each method delegates to the underlying gRPC service implementation,
// converting between Connect and gRPC request/response types.

// InstanceService

func (s *ConnectServiceHandler) GetInstanceProfile(ctx context.Context, req *connect.Request[v1pb.GetInstanceProfileRequest]) (*connect.Response[v1pb.InstanceProfile], error) {
	resp, err := s.APIV1Service.GetInstanceProfile(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) GetInstanceSetting(ctx context.Context, req *connect.Request[v1pb.GetInstanceSettingRequest]) (*connect.Response[v1pb.InstanceSetting], error) {
	resp, err := s.APIV1Service.GetInstanceSetting(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) BatchGetInstanceSettings(ctx context.Context, req *connect.Request[v1pb.BatchGetInstanceSettingsRequest]) (*connect.Response[v1pb.BatchGetInstanceSettingsResponse], error) {
	resp, err := s.APIV1Service.BatchGetInstanceSettings(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) UpdateInstanceSetting(ctx context.Context, req *connect.Request[v1pb.UpdateInstanceSettingRequest]) (*connect.Response[v1pb.InstanceSetting], error) {
	resp, err := s.APIV1Service.UpdateInstanceSetting(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) TestInstanceEmailSetting(ctx context.Context, req *connect.Request[v1pb.TestInstanceEmailSettingRequest]) (*connect.Response[emptypb.Empty], error) {
	resp, err := s.APIV1Service.TestInstanceEmailSetting(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) TestAIProvider(ctx context.Context, req *connect.Request[v1pb.TestAIProviderRequest]) (*connect.Response[v1pb.TestAIProviderResponse], error) {
	resp, err := s.APIV1Service.TestAIProvider(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) GetInstanceStats(ctx context.Context, req *connect.Request[v1pb.GetInstanceStatsRequest]) (*connect.Response[v1pb.InstanceStats], error) {
	resp, err := s.APIV1Service.GetInstanceStats(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) BackupNow(ctx context.Context, req *connect.Request[v1pb.BackupNowRequest]) (*connect.Response[v1pb.BackupNowResponse], error) {
	resp, err := s.APIV1Service.BackupNow(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

// AuthService
//
// Auth service methods need special handling for response headers (cookies).
// We use connectWithHeaderCarrier helper to inject a header carrier into the context,
// which allows the service to set headers in a protocol-agnostic way.

func (s *ConnectServiceHandler) GetCurrentUser(ctx context.Context, req *connect.Request[v1pb.GetCurrentUserRequest]) (*connect.Response[v1pb.GetCurrentUserResponse], error) {
	return connectWithHeaderCarrier(ctx, func(ctx context.Context) (*v1pb.GetCurrentUserResponse, error) {
		return s.APIV1Service.GetCurrentUser(ctx, req.Msg)
	})
}

func (s *ConnectServiceHandler) SignIn(ctx context.Context, req *connect.Request[v1pb.SignInRequest]) (*connect.Response[v1pb.SignInResponse], error) {
	return connectWithHeaderCarrier(ctx, func(ctx context.Context) (*v1pb.SignInResponse, error) {
		return s.APIV1Service.SignIn(ctx, req.Msg)
	})
}

func (s *ConnectServiceHandler) SignOut(ctx context.Context, req *connect.Request[v1pb.SignOutRequest]) (*connect.Response[emptypb.Empty], error) {
	return connectWithHeaderCarrier(ctx, func(ctx context.Context) (*emptypb.Empty, error) {
		return s.APIV1Service.SignOut(ctx, req.Msg)
	})
}

func (s *ConnectServiceHandler) RefreshToken(ctx context.Context, req *connect.Request[v1pb.RefreshTokenRequest]) (*connect.Response[v1pb.RefreshTokenResponse], error) {
	return connectWithHeaderCarrier(ctx, func(ctx context.Context) (*v1pb.RefreshTokenResponse, error) {
		return s.APIV1Service.RefreshToken(ctx, req.Msg)
	})
}

// UserService

func (s *ConnectServiceHandler) ListUsers(ctx context.Context, req *connect.Request[v1pb.ListUsersRequest]) (*connect.Response[v1pb.ListUsersResponse], error) {
	resp, err := s.APIV1Service.ListUsers(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) BatchGetUsers(ctx context.Context, req *connect.Request[v1pb.BatchGetUsersRequest]) (*connect.Response[v1pb.BatchGetUsersResponse], error) {
	resp, err := s.APIV1Service.BatchGetUsers(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) GetUser(ctx context.Context, req *connect.Request[v1pb.GetUserRequest]) (*connect.Response[v1pb.User], error) {
	resp, err := s.APIV1Service.GetUser(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) CreateUser(ctx context.Context, req *connect.Request[v1pb.CreateUserRequest]) (*connect.Response[v1pb.User], error) {
	resp, err := s.APIV1Service.CreateUser(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) UpdateUser(ctx context.Context, req *connect.Request[v1pb.UpdateUserRequest]) (*connect.Response[v1pb.User], error) {
	resp, err := s.APIV1Service.UpdateUser(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) DeleteUser(ctx context.Context, req *connect.Request[v1pb.DeleteUserRequest]) (*connect.Response[emptypb.Empty], error) {
	return connectWithHeaderCarrier(ctx, func(ctx context.Context) (*emptypb.Empty, error) {
		return s.APIV1Service.DeleteUser(ctx, req.Msg)
	})
}

func (s *ConnectServiceHandler) ListAllUserStats(ctx context.Context, req *connect.Request[v1pb.ListAllUserStatsRequest]) (*connect.Response[v1pb.ListAllUserStatsResponse], error) {
	resp, err := s.APIV1Service.ListAllUserStats(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) GetUserStats(ctx context.Context, req *connect.Request[v1pb.GetUserStatsRequest]) (*connect.Response[v1pb.UserStats], error) {
	resp, err := s.APIV1Service.GetUserStats(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) GetUserSetting(ctx context.Context, req *connect.Request[v1pb.GetUserSettingRequest]) (*connect.Response[v1pb.UserSetting], error) {
	resp, err := s.APIV1Service.GetUserSetting(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) UpdateUserSetting(ctx context.Context, req *connect.Request[v1pb.UpdateUserSettingRequest]) (*connect.Response[v1pb.UserSetting], error) {
	resp, err := s.APIV1Service.UpdateUserSetting(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) ListUserSettings(ctx context.Context, req *connect.Request[v1pb.ListUserSettingsRequest]) (*connect.Response[v1pb.ListUserSettingsResponse], error) {
	resp, err := s.APIV1Service.ListUserSettings(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) ListLinkedIdentities(ctx context.Context, req *connect.Request[v1pb.ListLinkedIdentitiesRequest]) (*connect.Response[v1pb.ListLinkedIdentitiesResponse], error) {
	resp, err := s.APIV1Service.ListLinkedIdentities(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) CreateLinkedIdentity(ctx context.Context, req *connect.Request[v1pb.CreateLinkedIdentityRequest]) (*connect.Response[v1pb.LinkedIdentity], error) {
	resp, err := s.APIV1Service.CreateLinkedIdentity(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) GetLinkedIdentity(ctx context.Context, req *connect.Request[v1pb.GetLinkedIdentityRequest]) (*connect.Response[v1pb.LinkedIdentity], error) {
	resp, err := s.APIV1Service.GetLinkedIdentity(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) DeleteLinkedIdentity(ctx context.Context, req *connect.Request[v1pb.DeleteLinkedIdentityRequest]) (*connect.Response[emptypb.Empty], error) {
	resp, err := s.APIV1Service.DeleteLinkedIdentity(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) ListPersonalAccessTokens(ctx context.Context, req *connect.Request[v1pb.ListPersonalAccessTokensRequest]) (*connect.Response[v1pb.ListPersonalAccessTokensResponse], error) {
	resp, err := s.APIV1Service.ListPersonalAccessTokens(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) CreatePersonalAccessToken(ctx context.Context, req *connect.Request[v1pb.CreatePersonalAccessTokenRequest]) (*connect.Response[v1pb.CreatePersonalAccessTokenResponse], error) {
	resp, err := s.APIV1Service.CreatePersonalAccessToken(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) DeletePersonalAccessToken(ctx context.Context, req *connect.Request[v1pb.DeletePersonalAccessTokenRequest]) (*connect.Response[emptypb.Empty], error) {
	resp, err := s.APIV1Service.DeletePersonalAccessToken(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) ListUserWebhooks(ctx context.Context, req *connect.Request[v1pb.ListUserWebhooksRequest]) (*connect.Response[v1pb.ListUserWebhooksResponse], error) {
	resp, err := s.APIV1Service.ListUserWebhooks(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) CreateUserWebhook(ctx context.Context, req *connect.Request[v1pb.CreateUserWebhookRequest]) (*connect.Response[v1pb.UserWebhook], error) {
	resp, err := s.APIV1Service.CreateUserWebhook(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) UpdateUserWebhook(ctx context.Context, req *connect.Request[v1pb.UpdateUserWebhookRequest]) (*connect.Response[v1pb.UserWebhook], error) {
	resp, err := s.APIV1Service.UpdateUserWebhook(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) DeleteUserWebhook(ctx context.Context, req *connect.Request[v1pb.DeleteUserWebhookRequest]) (*connect.Response[emptypb.Empty], error) {
	resp, err := s.APIV1Service.DeleteUserWebhook(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) GetUserWebhookSigningSecret(ctx context.Context, req *connect.Request[v1pb.GetUserWebhookSigningSecretRequest]) (*connect.Response[v1pb.GetUserWebhookSigningSecretResponse], error) {
	resp, err := s.APIV1Service.GetUserWebhookSigningSecret(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) ListUserNotifications(ctx context.Context, req *connect.Request[v1pb.ListUserNotificationsRequest]) (*connect.Response[v1pb.ListUserNotificationsResponse], error) {
	resp, err := s.APIV1Service.ListUserNotifications(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) UpdateUserNotification(ctx context.Context, req *connect.Request[v1pb.UpdateUserNotificationRequest]) (*connect.Response[v1pb.UserNotification], error) {
	resp, err := s.APIV1Service.UpdateUserNotification(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) DeleteUserNotification(ctx context.Context, req *connect.Request[v1pb.DeleteUserNotificationRequest]) (*connect.Response[emptypb.Empty], error) {
	resp, err := s.APIV1Service.DeleteUserNotification(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

// MemoService

func (s *ConnectServiceHandler) CreateMemo(ctx context.Context, req *connect.Request[v1pb.CreateMemoRequest]) (*connect.Response[v1pb.Memo], error) {
	resp, err := s.APIV1Service.CreateMemo(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) ListMemos(ctx context.Context, req *connect.Request[v1pb.ListMemosRequest]) (*connect.Response[v1pb.ListMemosResponse], error) {
	resp, err := s.APIV1Service.ListMemos(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) GetMemo(ctx context.Context, req *connect.Request[v1pb.GetMemoRequest]) (*connect.Response[v1pb.Memo], error) {
	resp, err := s.APIV1Service.GetMemo(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) UpdateMemo(ctx context.Context, req *connect.Request[v1pb.UpdateMemoRequest]) (*connect.Response[v1pb.Memo], error) {
	resp, err := s.APIV1Service.UpdateMemo(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) DeleteMemo(ctx context.Context, req *connect.Request[v1pb.DeleteMemoRequest]) (*connect.Response[emptypb.Empty], error) {
	resp, err := s.APIV1Service.DeleteMemo(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) SetMemoAttachments(ctx context.Context, req *connect.Request[v1pb.SetMemoAttachmentsRequest]) (*connect.Response[emptypb.Empty], error) {
	resp, err := s.APIV1Service.SetMemoAttachments(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) ListMemoAttachments(ctx context.Context, req *connect.Request[v1pb.ListMemoAttachmentsRequest]) (*connect.Response[v1pb.ListMemoAttachmentsResponse], error) {
	resp, err := s.APIV1Service.ListMemoAttachments(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) SetMemoRelations(ctx context.Context, req *connect.Request[v1pb.SetMemoRelationsRequest]) (*connect.Response[emptypb.Empty], error) {
	resp, err := s.APIV1Service.SetMemoRelations(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) ListMemoRelations(ctx context.Context, req *connect.Request[v1pb.ListMemoRelationsRequest]) (*connect.Response[v1pb.ListMemoRelationsResponse], error) {
	resp, err := s.APIV1Service.ListMemoRelations(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) CreateMemoComment(ctx context.Context, req *connect.Request[v1pb.CreateMemoCommentRequest]) (*connect.Response[v1pb.Memo], error) {
	resp, err := s.APIV1Service.CreateMemoComment(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) ListMemoComments(ctx context.Context, req *connect.Request[v1pb.ListMemoCommentsRequest]) (*connect.Response[v1pb.ListMemoCommentsResponse], error) {
	resp, err := s.APIV1Service.ListMemoComments(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) ListMemoReactions(ctx context.Context, req *connect.Request[v1pb.ListMemoReactionsRequest]) (*connect.Response[v1pb.ListMemoReactionsResponse], error) {
	resp, err := s.APIV1Service.ListMemoReactions(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) UpsertMemoReaction(ctx context.Context, req *connect.Request[v1pb.UpsertMemoReactionRequest]) (*connect.Response[v1pb.Reaction], error) {
	resp, err := s.APIV1Service.UpsertMemoReaction(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) DeleteMemoReaction(ctx context.Context, req *connect.Request[v1pb.DeleteMemoReactionRequest]) (*connect.Response[emptypb.Empty], error) {
	resp, err := s.APIV1Service.DeleteMemoReaction(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) CreateMemoShare(ctx context.Context, req *connect.Request[v1pb.CreateMemoShareRequest]) (*connect.Response[v1pb.MemoShare], error) {
	resp, err := s.APIV1Service.CreateMemoShare(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) ListMemoShares(ctx context.Context, req *connect.Request[v1pb.ListMemoSharesRequest]) (*connect.Response[v1pb.ListMemoSharesResponse], error) {
	resp, err := s.APIV1Service.ListMemoShares(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) CreateMemoHistory(ctx context.Context, req *connect.Request[v1pb.CreateMemoHistoryRequest]) (*connect.Response[v1pb.MemoHistory], error) {
	resp, err := s.APIV1Service.CreateMemoHistory(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) ListMemoHistories(ctx context.Context, req *connect.Request[v1pb.ListMemoHistoriesRequest]) (*connect.Response[v1pb.ListMemoHistoriesResponse], error) {
	resp, err := s.APIV1Service.ListMemoHistories(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) RestoreMemoHistory(ctx context.Context, req *connect.Request[v1pb.RestoreMemoHistoryRequest]) (*connect.Response[v1pb.Memo], error) {
	resp, err := s.APIV1Service.RestoreMemoHistory(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) DeleteMemoShare(ctx context.Context, req *connect.Request[v1pb.DeleteMemoShareRequest]) (*connect.Response[emptypb.Empty], error) {
	resp, err := s.APIV1Service.DeleteMemoShare(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) GetMemoByShare(ctx context.Context, req *connect.Request[v1pb.GetMemoByShareRequest]) (*connect.Response[v1pb.Memo], error) {
	resp, err := s.APIV1Service.GetMemoByShare(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) GetLinkMetadata(ctx context.Context, req *connect.Request[v1pb.GetLinkMetadataRequest]) (*connect.Response[v1pb.LinkMetadata], error) {
	resp, err := s.APIV1Service.GetLinkMetadata(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) BatchGetLinkMetadata(ctx context.Context, req *connect.Request[v1pb.BatchGetLinkMetadataRequest]) (*connect.Response[v1pb.BatchGetLinkMetadataResponse], error) {
	resp, err := s.APIV1Service.BatchGetLinkMetadata(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

// AttachmentService

func (s *ConnectServiceHandler) CreateAttachment(ctx context.Context, req *connect.Request[v1pb.CreateAttachmentRequest]) (*connect.Response[v1pb.Attachment], error) {
	resp, err := s.APIV1Service.CreateAttachment(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) ListAttachments(ctx context.Context, req *connect.Request[v1pb.ListAttachmentsRequest]) (*connect.Response[v1pb.ListAttachmentsResponse], error) {
	resp, err := s.APIV1Service.ListAttachments(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) GetAttachment(ctx context.Context, req *connect.Request[v1pb.GetAttachmentRequest]) (*connect.Response[v1pb.Attachment], error) {
	resp, err := s.APIV1Service.GetAttachment(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) UpdateAttachment(ctx context.Context, req *connect.Request[v1pb.UpdateAttachmentRequest]) (*connect.Response[v1pb.Attachment], error) {
	resp, err := s.APIV1Service.UpdateAttachment(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) UnlinkAttachment(ctx context.Context, req *connect.Request[v1pb.UnlinkAttachmentRequest]) (*connect.Response[v1pb.Attachment], error) {
	resp, err := s.APIV1Service.UnlinkAttachment(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) DeleteAttachment(ctx context.Context, req *connect.Request[v1pb.DeleteAttachmentRequest]) (*connect.Response[emptypb.Empty], error) {
	resp, err := s.APIV1Service.DeleteAttachment(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) BatchDeleteAttachments(ctx context.Context, req *connect.Request[v1pb.BatchDeleteAttachmentsRequest]) (*connect.Response[emptypb.Empty], error) {
	resp, err := s.APIV1Service.BatchDeleteAttachments(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) UnlockVault(ctx context.Context, req *connect.Request[v1pb.UnlockVaultRequest]) (*connect.Response[emptypb.Empty], error) {
	return connectWithHeaderCarrier(ctx, func(ctx context.Context) (*emptypb.Empty, error) {
		return s.APIV1Service.UnlockVault(ctx, req.Msg)
	})
}

func (s *ConnectServiceHandler) LockVault(ctx context.Context, req *connect.Request[v1pb.LockVaultRequest]) (*connect.Response[emptypb.Empty], error) {
	return connectWithHeaderCarrier(ctx, func(ctx context.Context) (*emptypb.Empty, error) {
		return s.APIV1Service.LockVault(ctx, req.Msg)
	})
}

func (s *ConnectServiceHandler) GetDownloadUrl(ctx context.Context, req *connect.Request[v1pb.GetDownloadUrlRequest]) (*connect.Response[v1pb.GetDownloadUrlResponse], error) {
	resp, err := s.APIV1Service.GetDownloadUrl(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

// AIService

func (s *ConnectServiceHandler) Transcribe(ctx context.Context, req *connect.Request[v1pb.TranscribeRequest]) (*connect.Response[v1pb.TranscribeResponse], error) {
	resp, err := s.APIV1Service.Transcribe(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) FormatMarkdown(ctx context.Context, req *connect.Request[v1pb.FormatMarkdownRequest]) (*connect.Response[v1pb.FormatMarkdownResponse], error) {
	resp, err := s.APIV1Service.FormatMarkdown(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) PolishText(ctx context.Context, req *connect.Request[v1pb.PolishTextRequest]) (*connect.Response[v1pb.PolishTextResponse], error) {
	resp, err := s.APIV1Service.PolishText(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) GenerateFormula(ctx context.Context, req *connect.Request[v1pb.GenerateFormulaRequest]) (*connect.Response[v1pb.GenerateFormulaResponse], error) {
	resp, err := s.APIV1Service.GenerateFormula(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

// RagService

func (s *ConnectServiceHandler) Search(ctx context.Context, req *connect.Request[v1pb.SearchRequest]) (*connect.Response[v1pb.SearchResponse], error) {
	resp, err := s.APIV1Service.Search(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) RebuildIndex(ctx context.Context, req *connect.Request[v1pb.RebuildIndexRequest]) (*connect.Response[v1pb.RebuildIndexResponse], error) {
	resp, err := s.APIV1Service.RebuildIndex(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) GetIndexStatus(ctx context.Context, req *connect.Request[v1pb.GetIndexStatusRequest]) (*connect.Response[v1pb.GetIndexStatusResponse], error) {
	resp, err := s.APIV1Service.GetIndexStatus(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

// SecretBlockService

func (s *ConnectServiceHandler) ListSecretBlocks(ctx context.Context, req *connect.Request[v1pb.ListSecretBlocksRequest]) (*connect.Response[v1pb.ListSecretBlocksResponse], error) {
	resp, err := s.APIV1Service.ListSecretBlocks(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) GetSecretBlock(ctx context.Context, req *connect.Request[v1pb.GetSecretBlockRequest]) (*connect.Response[v1pb.SecretBlock], error) {
	resp, err := s.APIV1Service.GetSecretBlock(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) CreateSecretBlock(ctx context.Context, req *connect.Request[v1pb.CreateSecretBlockRequest]) (*connect.Response[v1pb.SecretBlock], error) {
	resp, err := s.APIV1Service.CreateSecretBlock(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) UpdateSecretBlock(ctx context.Context, req *connect.Request[v1pb.UpdateSecretBlockRequest]) (*connect.Response[v1pb.SecretBlock], error) {
	resp, err := s.APIV1Service.UpdateSecretBlock(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) DeleteSecretBlock(ctx context.Context, req *connect.Request[v1pb.DeleteSecretBlockRequest]) (*connect.Response[emptypb.Empty], error) {
	resp, err := s.APIV1Service.DeleteSecretBlock(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

// ShortcutService

func (s *ConnectServiceHandler) ListShortcuts(ctx context.Context, req *connect.Request[v1pb.ListShortcutsRequest]) (*connect.Response[v1pb.ListShortcutsResponse], error) {
	resp, err := s.APIV1Service.ListShortcuts(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) GetShortcut(ctx context.Context, req *connect.Request[v1pb.GetShortcutRequest]) (*connect.Response[v1pb.Shortcut], error) {
	resp, err := s.APIV1Service.GetShortcut(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) CreateShortcut(ctx context.Context, req *connect.Request[v1pb.CreateShortcutRequest]) (*connect.Response[v1pb.Shortcut], error) {
	resp, err := s.APIV1Service.CreateShortcut(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) UpdateShortcut(ctx context.Context, req *connect.Request[v1pb.UpdateShortcutRequest]) (*connect.Response[v1pb.Shortcut], error) {
	resp, err := s.APIV1Service.UpdateShortcut(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) DeleteShortcut(ctx context.Context, req *connect.Request[v1pb.DeleteShortcutRequest]) (*connect.Response[emptypb.Empty], error) {
	resp, err := s.APIV1Service.DeleteShortcut(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

// IdentityProviderService

func (s *ConnectServiceHandler) ListIdentityProviders(ctx context.Context, req *connect.Request[v1pb.ListIdentityProvidersRequest]) (*connect.Response[v1pb.ListIdentityProvidersResponse], error) {
	resp, err := s.APIV1Service.ListIdentityProviders(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) GetIdentityProvider(ctx context.Context, req *connect.Request[v1pb.GetIdentityProviderRequest]) (*connect.Response[v1pb.IdentityProvider], error) {
	resp, err := s.APIV1Service.GetIdentityProvider(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) CreateIdentityProvider(ctx context.Context, req *connect.Request[v1pb.CreateIdentityProviderRequest]) (*connect.Response[v1pb.IdentityProvider], error) {
	resp, err := s.APIV1Service.CreateIdentityProvider(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) UpdateIdentityProvider(ctx context.Context, req *connect.Request[v1pb.UpdateIdentityProviderRequest]) (*connect.Response[v1pb.IdentityProvider], error) {
	resp, err := s.APIV1Service.UpdateIdentityProvider(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) DeleteIdentityProvider(ctx context.Context, req *connect.Request[v1pb.DeleteIdentityProviderRequest]) (*connect.Response[emptypb.Empty], error) {
	resp, err := s.APIV1Service.DeleteIdentityProvider(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

// WorkspaceService

func (s *ConnectServiceHandler) CreateWorkspace(ctx context.Context, req *connect.Request[v1pb.CreateWorkspaceRequest]) (*connect.Response[v1pb.Workspace], error) {
	resp, err := s.APIV1Service.CreateWorkspace(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) ListWorkspaces(ctx context.Context, req *connect.Request[v1pb.ListWorkspacesRequest]) (*connect.Response[v1pb.ListWorkspacesResponse], error) {
	resp, err := s.APIV1Service.ListWorkspaces(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) GetWorkspace(ctx context.Context, req *connect.Request[v1pb.GetWorkspaceRequest]) (*connect.Response[v1pb.Workspace], error) {
	resp, err := s.APIV1Service.GetWorkspace(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) UpdateWorkspace(ctx context.Context, req *connect.Request[v1pb.UpdateWorkspaceRequest]) (*connect.Response[v1pb.Workspace], error) {
	resp, err := s.APIV1Service.UpdateWorkspace(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) DeleteWorkspace(ctx context.Context, req *connect.Request[v1pb.DeleteWorkspaceRequest]) (*connect.Response[emptypb.Empty], error) {
	resp, err := s.APIV1Service.DeleteWorkspace(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) GetWorkspaceTree(ctx context.Context, req *connect.Request[v1pb.GetWorkspaceTreeRequest]) (*connect.Response[v1pb.GetWorkspaceTreeResponse], error) {
	resp, err := s.APIV1Service.GetWorkspaceTree(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) BatchGetWorkspaceTreesByTitle(ctx context.Context, req *connect.Request[v1pb.BatchGetWorkspaceTreesByTitleRequest]) (*connect.Response[v1pb.BatchGetWorkspaceTreesByTitleResponse], error) {
	resp, err := s.APIV1Service.BatchGetWorkspaceTreesByTitle(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) CreateWorkspaceFolder(ctx context.Context, req *connect.Request[v1pb.CreateWorkspaceFolderRequest]) (*connect.Response[v1pb.WorkspaceFolder], error) {
	resp, err := s.APIV1Service.CreateWorkspaceFolder(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) RenameWorkspaceFolder(ctx context.Context, req *connect.Request[v1pb.RenameWorkspaceFolderRequest]) (*connect.Response[emptypb.Empty], error) {
	resp, err := s.APIV1Service.RenameWorkspaceFolder(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) MoveWorkspaceFolder(ctx context.Context, req *connect.Request[v1pb.MoveWorkspaceFolderRequest]) (*connect.Response[v1pb.MoveWorkspaceFolderResponse], error) {
	resp, err := s.APIV1Service.MoveWorkspaceFolder(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) DeleteWorkspaceFolder(ctx context.Context, req *connect.Request[v1pb.DeleteWorkspaceFolderRequest]) (*connect.Response[emptypb.Empty], error) {
	resp, err := s.APIV1Service.DeleteWorkspaceFolder(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) ListWorkspaceGrants(ctx context.Context, req *connect.Request[v1pb.ListWorkspaceGrantsRequest]) (*connect.Response[v1pb.ListWorkspaceGrantsResponse], error) {
	resp, err := s.APIV1Service.ListWorkspaceGrants(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) CreateWorkspaceGrant(ctx context.Context, req *connect.Request[v1pb.CreateWorkspaceGrantRequest]) (*connect.Response[v1pb.WorkspaceGrant], error) {
	resp, err := s.APIV1Service.CreateWorkspaceGrant(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) UpdateWorkspaceGrant(ctx context.Context, req *connect.Request[v1pb.UpdateWorkspaceGrantRequest]) (*connect.Response[v1pb.WorkspaceGrant], error) {
	resp, err := s.APIV1Service.UpdateWorkspaceGrant(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) DeleteWorkspaceGrant(ctx context.Context, req *connect.Request[v1pb.DeleteWorkspaceGrantRequest]) (*connect.Response[emptypb.Empty], error) {
	resp, err := s.APIV1Service.DeleteWorkspaceGrant(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

// SiteService

func (s *ConnectServiceHandler) ListSites(ctx context.Context, req *connect.Request[v1pb.ListSitesRequest]) (*connect.Response[v1pb.ListSitesResponse], error) {
	resp, err := s.APIV1Service.ListSites(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) GetSite(ctx context.Context, req *connect.Request[v1pb.GetSiteRequest]) (*connect.Response[v1pb.Site], error) {
	resp, err := s.APIV1Service.GetSite(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) CreateSite(ctx context.Context, req *connect.Request[v1pb.CreateSiteRequest]) (*connect.Response[v1pb.Site], error) {
	resp, err := s.APIV1Service.CreateSite(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) UpdateSite(ctx context.Context, req *connect.Request[v1pb.UpdateSiteRequest]) (*connect.Response[v1pb.Site], error) {
	resp, err := s.APIV1Service.UpdateSite(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) DeleteSite(ctx context.Context, req *connect.Request[v1pb.DeleteSiteRequest]) (*connect.Response[emptypb.Empty], error) {
	resp, err := s.APIV1Service.DeleteSite(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) ListPublications(ctx context.Context, req *connect.Request[v1pb.ListPublicationsRequest]) (*connect.Response[v1pb.ListPublicationsResponse], error) {
	resp, err := s.APIV1Service.ListPublications(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) ListMemoPublications(ctx context.Context, req *connect.Request[v1pb.ListMemoPublicationsRequest]) (*connect.Response[v1pb.ListMemoPublicationsResponse], error) {
	resp, err := s.APIV1Service.ListMemoPublications(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) PreviewPublish(ctx context.Context, req *connect.Request[v1pb.PreviewPublishRequest]) (*connect.Response[v1pb.PreviewPublishResponse], error) {
	resp, err := s.APIV1Service.PreviewPublish(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) PublishMemo(ctx context.Context, req *connect.Request[v1pb.PublishMemoRequest]) (*connect.Response[v1pb.Publication], error) {
	resp, err := s.APIV1Service.PublishMemo(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) UpdatePublication(ctx context.Context, req *connect.Request[v1pb.UpdatePublicationRequest]) (*connect.Response[v1pb.Publication], error) {
	resp, err := s.APIV1Service.UpdatePublication(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) UnpublishMemo(ctx context.Context, req *connect.Request[v1pb.UnpublishMemoRequest]) (*connect.Response[v1pb.UnpublishMemoResponse], error) {
	resp, err := s.APIV1Service.UnpublishMemo(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

// PublicSiteService

func (s *ConnectServiceHandler) GetPublicSiteProfile(ctx context.Context, req *connect.Request[v1pb.GetPublicSiteProfileRequest]) (*connect.Response[v1pb.PublicSiteProfile], error) {
	resp, err := s.APIV1Service.GetPublicSiteProfile(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) GetPublicPage(ctx context.Context, req *connect.Request[v1pb.GetPublicPageRequest]) (*connect.Response[v1pb.PublicPage], error) {
	resp, err := s.APIV1Service.GetPublicPage(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) ResolvePublicDoc(ctx context.Context, req *connect.Request[v1pb.ResolvePublicDocRequest]) (*connect.Response[v1pb.ResolvePublicDocResponse], error) {
	resp, err := s.APIV1Service.ResolvePublicDoc(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) ListPublicPages(ctx context.Context, req *connect.Request[v1pb.ListPublicPagesRequest]) (*connect.Response[v1pb.ListPublicPagesResponse], error) {
	resp, err := s.APIV1Service.ListPublicPages(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

func (s *ConnectServiceHandler) SearchPublicPages(ctx context.Context, req *connect.Request[v1pb.SearchPublicPagesRequest]) (*connect.Response[v1pb.SearchPublicPagesResponse], error) {
	resp, err := s.APIV1Service.SearchPublicPages(ctx, req.Msg)
	if err != nil {
		return nil, convertGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}
