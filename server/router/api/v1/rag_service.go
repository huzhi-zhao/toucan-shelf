package v1

import (
	"context"
	"fmt"
	"strings"

	"github.com/pkg/errors"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/usememos/memos/internal/rag"
	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

const defaultMaxResultDocs = 20

// Search runs a hybrid search over the memos the current user can access.
func (s *APIV1Service) Search(ctx context.Context, request *v1pb.SearchRequest) (*v1pb.SearchResponse, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}

	query := request.GetQuery()
	if query == "" {
		return &v1pb.SearchResponse{Hits: []*v1pb.SearchHit{}}, nil
	}

	// Resolve the permission-scoped candidate memo set. Reuse the same visibility
	// rules as memo listing so search never leaks inaccessible content.
	var workspaceID *int32
	if workspaceName := request.GetWorkspace(); workspaceName != "" {
		workspaceUID, err := ExtractWorkspaceUIDFromName(workspaceName)
		if err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "invalid workspace name: %v", err)
		}
		workspace, err := s.Store.GetWorkspace(ctx, &store.FindWorkspace{UID: &workspaceUID})
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to get workspace: %v", err)
		}
		if workspace == nil {
			return nil, status.Errorf(codes.NotFound, "workspace not found")
		}
		wid := workspace.ID
		workspaceID = &wid
	}
	// A structured CEL filter (from Explore's secondary filters) constrains the
	// candidate corpus before ranking; permission scoping is still applied on top.
	memoIDs, err := s.accessibleMemoIDs(ctx, user, workspaceID, request.GetFilter())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to scope search: %v", err)
	}

	mode, limit := s.resolveSearchPreferences(ctx, user, request)

	result, err := rag.Search(ctx, s.Store, rag.SearchParams{
		Query:   query,
		MemoIDs: memoIDs,
		Mode:    mode,
		Limit:   limit,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "search failed: %v", err)
	}

	hits, err := s.convertSearchHits(ctx, result.Hits)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to build search results: %v", err)
	}
	return &v1pb.SearchResponse{
		Hits:          hits,
		EffectiveMode: ragModeToProto(result.EffectiveMode),
	}, nil
}

// RebuildIndex re-enqueues the current user's own documents for indexing. This is a
// user-level recovery action (e.g. after a transient embedding failure left some docs
// unindexed); it only touches the caller's own memos, so it needs no admin role.
func (s *APIV1Service) RebuildIndex(ctx context.Context, _ *v1pb.RebuildIndexRequest) (*v1pb.RebuildIndexResponse, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}

	enqueued, err := s.enqueueRebuild(ctx, store.IndexJobReasonManual, &user.ID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to rebuild index: %v", err)
	}
	return &v1pb.RebuildIndexResponse{Enqueued: int32(enqueued)}, nil
}

// enqueueRebuild walks the indexable memos and enqueues an index job with the given
// reason. When creatorID is non-nil, only that user's memos are re-enqueued (user-level
// rebuild); when nil, every memo is re-enqueued (used by the embedding-model change hook,
// which invalidates all existing vectors instance-wide).
func (s *APIV1Service) enqueueRebuild(ctx context.Context, reason string, creatorID *int32) (int, error) {
	const batchSize = 200
	offset := 0
	enqueued := 0
	normal := store.Normal
	for {
		limit := batchSize
		memos, err := s.Store.ListMemos(ctx, &store.FindMemo{
			RowStatus:       &normal,
			CreatorID:       creatorID,
			ExcludeComments: true,
			ExcludeContent:  true,
			Limit:           &limit,
			Offset:          &offset,
		})
		if err != nil {
			return enqueued, errors.Wrap(err, "failed to list memos")
		}
		if len(memos) == 0 {
			break
		}
		for _, memo := range memos {
			if !rag.IsIndexable(memo) {
				continue
			}
			if err := s.Store.UpsertMemoIndexJob(ctx, memo.ID, reason); err != nil {
				return enqueued, errors.Wrapf(err, "failed to enqueue memo %d", memo.ID)
			}
			enqueued++
		}
		offset += len(memos)
	}
	return enqueued, nil
}

// GetIndexStatus returns the current index queue progress.
func (s *APIV1Service) GetIndexStatus(ctx context.Context, _ *v1pb.GetIndexStatusRequest) (*v1pb.GetIndexStatusResponse, error) {
	if _, err := s.fetchCurrentUser(ctx); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	counts, err := s.Store.CountMemoIndexJobsByStatus(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get index status: %v", err)
	}
	configured, err := rag.EmbeddingConfigured(ctx, s.Store)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to resolve embedding config: %v", err)
	}
	return &v1pb.GetIndexStatusResponse{
		Pending:             int32(counts[store.IndexJobStatusPending]),
		Processing:          int32(counts[store.IndexJobStatusProcessing]),
		Failed:              int32(counts[store.IndexJobStatusFailed]),
		Done:                int32(counts[store.IndexJobStatusDone]),
		EmbeddingConfigured: configured,
	}, nil
}

// accessibleMemoIDs returns the ids of normal (non-archived) memos the user can
// see, optionally restricted to a single workspace.
func (s *APIV1Service) accessibleMemoIDs(ctx context.Context, user *store.User, workspaceID *int32, extraFilters ...string) ([]int32, error) {
	find := &store.FindMemo{
		ExcludeComments: true,
		ExcludeContent:  true,
		WorkspaceID:     workspaceID,
		// An unscoped search spans every workspace, so hidden ones have to be dropped
		// or hiding leaks. A search explicitly scoped to one workspace is direct access
		// and stays searchable — that is how a hidden workspace is found to restore it.
		ExcludeHiddenWorkspaces: workspaceID == nil,
	}
	normal := store.Normal
	find.RowStatus = &normal
	if user == nil {
		find.VisibilityList = []store.Visibility{store.Public}
	} else {
		filter := fmt.Sprintf(`creator_id == %d || visibility in ["PUBLIC", "PROTECTED"]`, user.ID)
		find.Filters = append(find.Filters, filter)
	}
	// Additional caller-supplied CEL filters (e.g. Explore's structured filters) are
	// ANDed with the permission filter, so they can only narrow — never widen — access.
	for _, f := range extraFilters {
		if strings.TrimSpace(f) != "" {
			find.Filters = append(find.Filters, f)
		}
	}

	memos, err := s.Store.ListMemos(ctx, find)
	if err != nil {
		return nil, err
	}
	ids := make([]int32, 0, len(memos))
	for _, memo := range memos {
		ids = append(ids, memo.ID)
	}
	return ids, nil
}

// resolveSearchPreferences determines the effective mode and limit from the
// request (which takes precedence) and the user's persisted RAG settings.
func (s *APIV1Service) resolveSearchPreferences(ctx context.Context, user *store.User, request *v1pb.SearchRequest) (rag.Mode, int) {
	mode := rag.ModeMixed
	limit := defaultMaxResultDocs

	if user != nil {
		setting, err := s.Store.GetUserSetting(ctx, &store.FindUserSetting{
			UserID: &user.ID,
			Key:    storepb.UserSetting_RAG_SEARCH,
		})
		if err == nil && setting != nil {
			if rs := setting.GetRagSearch(); rs != nil {
				if rs.GetMaxResultDocs() > 0 {
					limit = int(rs.GetMaxResultDocs())
				}
				mode = ragModeFromStore(rs.GetMode())
			}
		}
	}

	// An explicit request mode/limit overrides the stored preference.
	if request.GetMode() != v1pb.SearchMode_SEARCH_MODE_UNSPECIFIED {
		mode = ragModeFromProto(request.GetMode())
	}
	if request.GetLimit() > 0 {
		limit = int(request.GetLimit())
	}
	return mode, limit
}

func (s *APIV1Service) convertSearchHits(ctx context.Context, hits []rag.Hit) ([]*v1pb.SearchHit, error) {
	if len(hits) == 0 {
		return []*v1pb.SearchHit{}, nil
	}
	ids := make([]int32, 0, len(hits))
	for _, hit := range hits {
		ids = append(ids, hit.MemoID)
	}
	memos, err := s.Store.ListMemos(ctx, &store.FindMemo{IDList: ids, ExcludeContent: true})
	if err != nil {
		return nil, err
	}
	byID := make(map[int32]*store.Memo, len(memos))
	for _, memo := range memos {
		byID[memo.ID] = memo
	}

	// Resolve workspace resource names for the memos in the result set.
	workspaceNames, err := s.workspaceNamesByID(ctx)
	if err != nil {
		return nil, err
	}

	result := make([]*v1pb.SearchHit, 0, len(hits))
	for _, hit := range hits {
		memo := byID[hit.MemoID]
		if memo == nil {
			continue
		}
		result = append(result, &v1pb.SearchHit{
			Memo:       fmt.Sprintf("%s%s", MemoNamePrefix, memo.UID),
			Title:      memo.Title,
			Workspace:  workspaceNames[memo.WorkspaceID],
			FolderPath: memo.FolderPath,
			Score:      hit.Score,
			Snippet:    hit.Snippet,
			Highlights: hit.Highlights,
		})
	}
	return result, nil
}

// workspaceNamesByID returns a map of workspace id -> resource name.
func (s *APIV1Service) workspaceNamesByID(ctx context.Context) (map[int32]string, error) {
	workspaces, err := s.Store.ListWorkspaces(ctx, &store.FindWorkspace{})
	if err != nil {
		return nil, err
	}
	names := make(map[int32]string, len(workspaces))
	for _, workspace := range workspaces {
		names[workspace.ID] = WorkspaceNamePrefix + workspace.UID
	}
	return names, nil
}

func ragModeFromProto(mode v1pb.SearchMode) rag.Mode {
	switch mode {
	case v1pb.SearchMode_SEARCH_MODE_KEYWORD:
		return rag.ModeKeyword
	case v1pb.SearchMode_SEARCH_MODE_SEMANTIC:
		return rag.ModeSemantic
	case v1pb.SearchMode_SEARCH_MODE_LIKE:
		return rag.ModeLike
	default:
		return rag.ModeMixed
	}
}

func ragModeFromStore(mode storepb.RagSearchMode) rag.Mode {
	switch mode {
	case storepb.RagSearchMode_KEYWORD:
		return rag.ModeKeyword
	case storepb.RagSearchMode_SEMANTIC:
		return rag.ModeSemantic
	case storepb.RagSearchMode_LIKE:
		return rag.ModeLike
	default:
		return rag.ModeMixed
	}
}

func ragModeToProto(mode rag.Mode) v1pb.SearchMode {
	switch mode {
	case rag.ModeKeyword:
		return v1pb.SearchMode_SEARCH_MODE_KEYWORD
	case rag.ModeSemantic:
		return v1pb.SearchMode_SEARCH_MODE_SEMANTIC
	case rag.ModeLike:
		return v1pb.SearchMode_SEARCH_MODE_LIKE
	default:
		return v1pb.SearchMode_SEARCH_MODE_MIXED
	}
}
