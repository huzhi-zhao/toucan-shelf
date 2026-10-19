package v1

import (
	"context"
	"log/slog"
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/store"
)

// FavoriteNamePrefix is the resource prefix of a favorite; the id after it is the document's.
const FavoriteNamePrefix = "favorites/"

// ListFavorites returns the caller's favorites. Ones whose document is gone are dropped for good; ones whose
// document is in the recycle bin, in a hidden knowledge base or no longer readable are only left out, since
// they come back when the document does.
func (s *APIV1Service) ListFavorites(ctx context.Context, _ *v1pb.ListFavoritesRequest) (*v1pb.ListFavoritesResponse, error) {
	user, err := s.favoriteUser(ctx)
	if err != nil {
		return nil, err
	}
	favorites, err := s.Store.ListMemoFavorites(ctx, &store.FindMemoFavorite{UserID: &user.ID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list favorites: %v", err)
	}
	response := &v1pb.ListFavoritesResponse{Favorites: []*v1pb.Favorite{}}
	if len(favorites) == 0 {
		return response, nil
	}

	memoIDs := make([]int32, 0, len(favorites))
	for _, favorite := range favorites {
		memoIDs = append(memoIDs, favorite.MemoID)
	}
	memos, err := s.Store.ListMemos(ctx, &store.FindMemo{IDList: memoIDs, ExcludeContent: true})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list favorite documents: %v", err)
	}
	memoByID := make(map[int32]*store.Memo, len(memos))
	workspaceIDs := []int32{}
	for _, memo := range memos {
		memoByID[memo.ID] = memo
		workspaceIDs = append(workspaceIDs, memo.WorkspaceID)
	}
	workspaces, err := s.Store.ListWorkspaces(ctx, &store.FindWorkspace{IDList: workspaceIDs})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list favorite knowledge bases: %v", err)
	}
	workspaceByID := make(map[int32]*store.Workspace, len(workspaces))
	for _, workspace := range workspaces {
		workspaceByID[workspace.ID] = workspace
	}

	for _, favorite := range favorites {
		memo := memoByID[favorite.MemoID]
		if memo == nil {
			if err := s.Store.DeleteMemoFavorite(ctx, user.ID, favorite.MemoID); err != nil {
				slog.Warn("failed to drop favorite of a deleted document", slog.String("error", err.Error()))
			}
			continue
		}
		workspace := workspaceByID[memo.WorkspaceID]
		if memo.RowStatus == store.Archived || workspace == nil || workspace.Hidden || !s.canViewerAccessMemo(ctx, user, memo) {
			continue
		}
		response.Favorites = append(response.Favorites, convertFavorite(favorite, memo, workspace))
	}
	return response, nil
}

// AddFavorite adds a document the caller can read.
func (s *APIV1Service) AddFavorite(ctx context.Context, request *v1pb.AddFavoriteRequest) (*v1pb.Favorite, error) {
	user, err := s.favoriteUser(ctx)
	if err != nil {
		return nil, err
	}
	uid, err := ExtractMemoUIDFromName(request.Memo)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid memo name: %v", err)
	}
	memo, workspace, err := s.favoriteDocument(ctx, uid)
	if err != nil {
		return nil, err
	}
	if memo.RowStatus == store.Archived {
		return nil, status.Errorf(codes.FailedPrecondition, "document is in the recycle bin")
	}
	favorite, err := s.Store.AddMemoFavorite(ctx, user.ID, memo.ID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to add favorite: %v", err)
	}
	return convertFavorite(favorite, memo, workspace), nil
}

// UpdateFavorite pins or unpins a favorite.
func (s *APIV1Service) UpdateFavorite(ctx context.Context, request *v1pb.UpdateFavoriteRequest) (*v1pb.Favorite, error) {
	user, err := s.favoriteUser(ctx)
	if err != nil {
		return nil, err
	}
	if request.Favorite == nil {
		return nil, status.Errorf(codes.InvalidArgument, "favorite is required")
	}
	if request.UpdateMask == nil || len(request.UpdateMask.Paths) == 0 {
		return nil, status.Errorf(codes.InvalidArgument, "update mask is required")
	}
	update := &store.UpdateMemoFavorite{UserID: user.ID}
	for _, path := range request.UpdateMask.Paths {
		switch path {
		case "pinned":
			update.Pinned = &request.Favorite.Pinned
		default:
			return nil, status.Errorf(codes.InvalidArgument, "unsupported update mask path: %s", path)
		}
	}
	uid, err := extractFavoriteUID(request.Favorite.Name)
	if err != nil {
		return nil, err
	}
	memo, workspace, err := s.favoriteDocument(ctx, uid)
	if err != nil {
		return nil, err
	}
	update.MemoID = memo.ID
	favorite, err := s.Store.UpdateMemoFavorite(ctx, update)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to update favorite: %v", err)
	}
	if favorite == nil {
		return nil, status.Errorf(codes.NotFound, "not a favorite")
	}
	return convertFavorite(favorite, memo, workspace), nil
}

// DeleteFavorite takes a document off the caller's favorites. It does not check read access: losing access
// to a document must not stop anyone from cleaning up their own list.
func (s *APIV1Service) DeleteFavorite(ctx context.Context, request *v1pb.DeleteFavoriteRequest) (*emptypb.Empty, error) {
	user, err := s.favoriteUser(ctx)
	if err != nil {
		return nil, err
	}
	uid, err := extractFavoriteUID(request.Name)
	if err != nil {
		return nil, err
	}
	memo, err := s.Store.GetMemo(ctx, &store.FindMemo{UID: &uid, ExcludeContent: true})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get document: %v", err)
	}
	if memo != nil {
		if err := s.Store.DeleteMemoFavorite(ctx, user.ID, memo.ID); err != nil {
			return nil, status.Errorf(codes.Internal, "failed to delete favorite: %v", err)
		}
	}
	return &emptypb.Empty{}, nil
}

// favoriteUser is the signed-in caller; favorites have no anonymous view.
func (s *APIV1Service) favoriteUser(ctx context.Context) (*store.User, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "authentication required")
	}
	return user, nil
}

// favoriteDocument loads a document the caller may read, and its knowledge base.
func (s *APIV1Service) favoriteDocument(ctx context.Context, uid string) (*store.Memo, *store.Workspace, error) {
	memo, err := s.Store.GetMemo(ctx, &store.FindMemo{UID: &uid, ExcludeContent: true})
	if err != nil {
		return nil, nil, status.Errorf(codes.Internal, "failed to get document: %v", err)
	}
	if err := s.checkMemoReadAccess(ctx, memo); err != nil {
		return nil, nil, err
	}
	workspace, err := s.Store.GetWorkspace(ctx, &store.FindWorkspace{ID: &memo.WorkspaceID})
	if err != nil {
		return nil, nil, status.Errorf(codes.Internal, "failed to get knowledge base: %v", err)
	}
	if workspace == nil {
		return nil, nil, status.Errorf(codes.NotFound, "memo not found")
	}
	return memo, workspace, nil
}

func extractFavoriteUID(name string) (string, error) {
	uid := strings.TrimPrefix(name, FavoriteNamePrefix)
	if uid == name || uid == "" || strings.Contains(uid, "/") {
		return "", status.Errorf(codes.InvalidArgument, "invalid favorite name: %s", name)
	}
	return uid, nil
}

func convertFavorite(favorite *store.MemoFavorite, memo *store.Memo, workspace *store.Workspace) *v1pb.Favorite {
	return &v1pb.Favorite{
		Name:           FavoriteNamePrefix + memo.UID,
		Memo:           MemoNamePrefix + memo.UID,
		Title:          memo.Title,
		Icon:           memo.Payload.GetIcon(),
		DocType:        memo.DocType,
		Workspace:      WorkspaceNamePrefix + workspace.UID,
		WorkspaceTitle: workspace.Title,
		Pinned:         favorite.Pinned,
		CreateTime:     timestamppb.New(time.Unix(favorite.CreatedTs, 0)),
	}
}
