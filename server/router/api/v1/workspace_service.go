package v1

import (
	"context"
	"log/slog"
	"sort"
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/store"
)

func (s *APIV1Service) CreateWorkspace(ctx context.Context, request *v1pb.CreateWorkspaceRequest) (*v1pb.Workspace, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}
	if request.Workspace == nil || strings.TrimSpace(request.Workspace.Title) == "" {
		return nil, status.Errorf(codes.InvalidArgument, "workspace title is required")
	}

	existing, err := s.Store.GetWorkspace(ctx, &store.FindWorkspace{CreatorID: &user.ID, Title: &request.Workspace.Title})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to check workspace title: %v", err)
	}
	if existing != nil {
		return nil, status.Errorf(codes.AlreadyExists, "workspace with this title already exists")
	}

	uid, err := ValidateAndGenerateUID("")
	if err != nil {
		return nil, err
	}
	storageSlug, err := s.Store.GenerateStorageSlug(ctx, uid, request.Workspace.Title)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to generate storage slug: %v", err)
	}
	workspace, err := s.Store.CreateWorkspace(ctx, &store.Workspace{
		UID:         uid,
		CreatorID:   user.ID,
		Title:       request.Workspace.Title,
		StorageSlug: storageSlug,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to create workspace: %v", err)
	}
	return convertWorkspaceFromStore(workspace, user.Username), nil
}

func (s *APIV1Service) ListWorkspaces(ctx context.Context, request *v1pb.ListWorkspacesRequest) (*v1pb.ListWorkspacesResponse, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}

	find := &store.FindWorkspace{CreatorID: &user.ID}
	// Hidden workspaces are left out by default; only the bookshelf's restore view asks
	// for them. Direct access by name (GetWorkspace) is deliberately not filtered — that
	// is what keeps a hidden workspace restorable.
	if !request.ShowHidden {
		visibleOnly := false
		find.Hidden = &visibleOnly
	}
	list, err := s.Store.ListWorkspaces(ctx, find)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list workspaces: %v", err)
	}
	workspaces := make([]*v1pb.Workspace, 0, len(list))
	for _, w := range list {
		workspaces = append(workspaces, convertWorkspaceFromStore(w, user.Username))
	}
	return &v1pb.ListWorkspacesResponse{Workspaces: workspaces}, nil
}

func (s *APIV1Service) GetWorkspace(ctx context.Context, request *v1pb.GetWorkspaceRequest) (*v1pb.Workspace, error) {
	workspace, user, err := s.getWorkspaceAndCheckOwnership(ctx, request.Name)
	if err != nil {
		return nil, err
	}
	return convertWorkspaceFromStore(workspace, user.Username), nil
}

func (s *APIV1Service) UpdateWorkspace(ctx context.Context, request *v1pb.UpdateWorkspaceRequest) (*v1pb.Workspace, error) {
	if request.Workspace == nil {
		return nil, status.Errorf(codes.InvalidArgument, "workspace is required")
	}
	if request.UpdateMask == nil || len(request.UpdateMask.Paths) == 0 {
		return nil, status.Errorf(codes.InvalidArgument, "update mask is required")
	}
	workspace, user, err := s.getWorkspaceAndCheckOwnership(ctx, request.Workspace.Name)
	if err != nil {
		return nil, err
	}

	update := &store.UpdateWorkspace{ID: workspace.ID}
	for _, field := range request.UpdateMask.Paths {
		if field == "title" {
			if strings.TrimSpace(request.Workspace.Title) == "" {
				return nil, status.Errorf(codes.InvalidArgument, "workspace title cannot be empty")
			}
			existing, err := s.Store.GetWorkspace(ctx, &store.FindWorkspace{CreatorID: &user.ID, Title: &request.Workspace.Title})
			if err != nil {
				return nil, status.Errorf(codes.Internal, "failed to check workspace title: %v", err)
			}
			if existing != nil && existing.ID != workspace.ID {
				return nil, status.Errorf(codes.AlreadyExists, "workspace with this title already exists")
			}
			update.Title = &request.Workspace.Title
		} else if field == "sort_field" {
			if !isValidWorkspaceSortField(request.Workspace.SortField) {
				return nil, status.Errorf(codes.InvalidArgument, "invalid sort_field: %s", request.Workspace.SortField)
			}
			update.SortField = &request.Workspace.SortField
		} else if field == "sort_order" {
			if !isValidWorkspaceSortOrder(request.Workspace.SortOrder) {
				return nil, status.Errorf(codes.InvalidArgument, "invalid sort_order: %s", request.Workspace.SortOrder)
			}
			update.SortOrder = &request.Workspace.SortOrder
		} else if field == "cover_color" {
			update.CoverColor = &request.Workspace.CoverColor
		} else if field == "cover_image" {
			update.CoverImage = &request.Workspace.CoverImage
		} else if field == "folders_first" {
			update.FoldersFirst = &request.Workspace.FoldersFirst
		} else if field == "display_order" {
			update.DisplayOrder = &request.Workspace.DisplayOrder
		} else if field == "hidden" {
			update.Hidden = &request.Workspace.Hidden
		}
	}

	updated, err := s.Store.UpdateWorkspace(ctx, update)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to update workspace: %v", err)
	}
	return convertWorkspaceFromStore(updated, user.Username), nil
}

func (s *APIV1Service) DeleteWorkspace(ctx context.Context, request *v1pb.DeleteWorkspaceRequest) (*emptypb.Empty, error) {
	workspace, _, err := s.getWorkspaceAndCheckOwnership(ctx, request.Name)
	if err != nil {
		return nil, err
	}

	// Only live documents block the delete, matching DeleteWorkspaceFolder's
	// rule (see its comment): archived memos keep their workspace_id forever,
	// so counting them here would make any workspace that ever held a deleted
	// document permanently undeletable.
	normal := store.Normal
	memos, err := s.Store.ListMemos(ctx, &store.FindMemo{WorkspaceID: &workspace.ID, RowStatus: &normal})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to check workspace contents: %v", err)
	}
	if len(memos) > 0 {
		return nil, status.Errorf(codes.FailedPrecondition, "workspace is not empty")
	}

	// P1: reject the delete if a document outside this workspace links to any
	// (live or archived) document inside it.
	allMemos, err := s.Store.ListMemos(ctx, &store.FindMemo{WorkspaceID: &workspace.ID, ExcludeContent: true, ExcludeComments: true})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to check workspace contents: %v", err)
	}
	if len(allMemos) > 0 {
		ids := make([]int32, len(allMemos))
		inWorkspace := make(map[int32]bool, len(allMemos))
		for i, m := range allMemos {
			ids[i] = m.ID
			inWorkspace[m.ID] = true
		}
		refs, err := s.findExternalLinkReferences(ctx, ids, inWorkspace)
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to check memo references: %v", err)
		}
		if len(refs) > 0 {
			return nil, referenceDependencyError(refs)
		}
	}

	if err := s.Store.DeleteWorkspace(ctx, &store.DeleteWorkspace{ID: workspace.ID}); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to delete workspace: %v", err)
	}
	return &emptypb.Empty{}, nil
}

// HomeFolderPath is the reserved folder holding the user's single Home
// document. It is not a real folder (no folder row is ever created for it) and
// is hidden from the workspace tree, so the Home page's own configuration never
// shows up as a document the user can stumble into.
const HomeFolderPath = ".home"

// isHomeFolder reports whether a memo's folder path is the reserved Home folder.
func isHomeFolder(path string) bool {
	return normalizeFolderPath(path) == HomeFolderPath
}

func (s *APIV1Service) GetWorkspaceTree(ctx context.Context, request *v1pb.GetWorkspaceTreeRequest) (*v1pb.GetWorkspaceTreeResponse, error) {
	workspace, _, err := s.getWorkspaceAndCheckOwnership(ctx, request.Name)
	if err != nil {
		return nil, err
	}

	memos, err := s.Store.ListMemos(ctx, &store.FindMemo{
		WorkspaceID:     &workspace.ID,
		ExcludeComments: true,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list memos: %v", err)
	}
	folders, err := s.Store.ListWorkspaceFolders(ctx, &store.FindWorkspaceFolder{WorkspaceID: &workspace.ID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list folders: %v", err)
	}

	root := newTreeDir()
	for _, f := range folders {
		root.ensurePath(strings.Split(strings.Trim(f.Path, "/"), "/"))
	}
	for _, m := range memos {
		if m.RowStatus == store.Archived != request.Archived {
			continue
		}
		if isHomeFolder(m.FolderPath) {
			continue
		}
		var segments []string
		if strings.TrimSpace(m.FolderPath) != "" {
			segments = strings.Split(strings.Trim(m.FolderPath, "/"), "/")
		}
		dir := root.ensurePath(segments)
		dir.docs = append(dir.docs, m)
	}

	return &v1pb.GetWorkspaceTreeResponse{Nodes: root.toNodes("")}, nil
}

func (s *APIV1Service) CreateWorkspaceFolder(ctx context.Context, request *v1pb.CreateWorkspaceFolderRequest) (*v1pb.WorkspaceFolder, error) {
	workspace, _, err := s.getWorkspaceAndCheckOwnership(ctx, request.Parent)
	if err != nil {
		return nil, err
	}
	if request.Folder == nil || strings.TrimSpace(request.Folder.Path) == "" {
		return nil, status.Errorf(codes.InvalidArgument, "folder path is required")
	}
	path := normalizeFolderPath(request.Folder.Path)

	folder, err := s.Store.CreateWorkspaceFolder(ctx, &store.WorkspaceFolder{
		WorkspaceID: workspace.ID,
		Path:        path,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to create folder: %v", err)
	}
	return &v1pb.WorkspaceFolder{
		Name: WorkspaceNamePrefix + workspace.UID + "/folders/" + folder.Path,
		Path: folder.Path,
	}, nil
}

func (s *APIV1Service) RenameWorkspaceFolder(ctx context.Context, request *v1pb.RenameWorkspaceFolderRequest) (*emptypb.Empty, error) {
	workspace, _, err := s.getWorkspaceAndCheckOwnership(ctx, request.Parent)
	if err != nil {
		return nil, err
	}
	oldPath := normalizeFolderPath(request.OldPath)
	newPath := normalizeFolderPath(request.NewPath)
	if oldPath == "" || newPath == "" {
		return nil, status.Errorf(codes.InvalidArgument, "old_path and new_path are required")
	}

	if err := s.Store.RenameWorkspaceFolder(ctx, workspace.ID, oldPath, newPath); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to rename folder: %v", err)
	}
	s.reindexFolder(ctx, workspace.ID, newPath)
	return &emptypb.Empty{}, nil
}

// reindexFolder re-enqueues every document under path for indexing.
//
// RenameWorkspaceFolder rewrites memo.folder_path with bulk SQL in the store
// layer, which is much cheaper than a per-document update but bypasses
// store.UpdateMemo — the only write path that enqueues an index job. memo_chunk
// denormalizes folder_path, so without this the chunks keep pointing at the old
// path forever. (MoveWorkspaceFolder does not need this: it moves document by
// document precisely so it inherits the enqueue.)
//
// Best-effort by design, matching store.enqueueMemoIndex: the rename itself has
// already committed, and a search index that is briefly stale must never turn a
// successful rename into an error. Re-indexing is cheap here because embeddings
// are reused by chunk content, so a pure path change costs no provider calls.
func (s *APIV1Service) reindexFolder(ctx context.Context, workspaceID int32, path string) {
	memos, err := s.Store.ListMemos(ctx, &store.FindMemo{
		WorkspaceID:      &workspaceID,
		FolderPathPrefix: &path,
		ExcludeContent:   true,
	})
	if err != nil {
		slog.Warn("failed to list memos for reindex after folder rename",
			slog.Int("workspaceID", int(workspaceID)), slog.String("path", path), slog.Any("err", err))
		return
	}
	for _, memo := range memos {
		if err := s.Store.UpsertMemoIndexJob(ctx, memo.ID, store.IndexJobReasonUpdated); err != nil {
			slog.Warn("failed to enqueue memo index job after folder rename",
				slog.Int("memoID", int(memo.ID)), slog.Any("err", err))
		}
	}
}

// MoveWorkspaceFolder moves a folder subtree into a different workspace.
//
// It deliberately does NOT reuse the bulk-SQL path RenameWorkspaceFolder takes.
// That path rewrites folder_path directly and so bypasses store.UpdateMemo,
// which is what re-enqueues a memo for indexing; memo_chunk carries a
// denormalized workspace_id, so a bulk rewrite across workspaces would leave
// chunks pointing at the old workspace and workspace-scoped search would return
// documents that no longer live there. Moving document by document is slower but
// inherits the index refresh, the duplicate-title check and the updated_ts bump
// that memo updates already get right.
func (s *APIV1Service) MoveWorkspaceFolder(ctx context.Context, request *v1pb.MoveWorkspaceFolderRequest) (*v1pb.MoveWorkspaceFolderResponse, error) {
	source, _, err := s.getWorkspaceAndCheckOwnership(ctx, request.Parent)
	if err != nil {
		return nil, err
	}
	destination, _, err := s.getWorkspaceAndCheckOwnership(ctx, request.DestinationWorkspace)
	if err != nil {
		return nil, err
	}

	path := normalizeFolderPath(request.Path)
	if path == "" {
		return nil, status.Errorf(codes.InvalidArgument, "path is required")
	}
	if isHomeFolder(path) {
		return nil, status.Errorf(codes.InvalidArgument, "the home folder cannot be moved")
	}
	destinationParent := normalizeFolderPath(request.DestinationFolderPath)
	if isHomeFolder(destinationParent) {
		return nil, status.Errorf(codes.InvalidArgument, "the home folder cannot be a destination")
	}

	newPath := movedFolderDestination(path, destinationParent)

	if source.ID == destination.ID {
		// Same workspace: this is a rename, and the rename path already guards its
		// own edge cases. Bounce it rather than growing a second implementation.
		return nil, status.Errorf(codes.InvalidArgument, "source and destination workspaces are the same; use RenameWorkspaceFolder")
	}

	memos, err := s.Store.ListMemos(ctx, &store.FindMemo{
		WorkspaceID:      &source.ID,
		FolderPathPrefix: &path,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list folder contents: %v", err)
	}

	// (workspace_id, folder_path, title) is unique, so a colliding title anywhere in
	// the subtree would fail mid-move. Collect every conflict up front: a user told
	// "3 documents already exist at the destination: a, b, c" can act on it, whereas
	// a constraint error surfacing on document 47 of 60 leaves the move half applied
	// with no clue which document stopped it.
	existing, err := s.Store.ListMemos(ctx, &store.FindMemo{WorkspaceID: &destination.ID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to inspect destination workspace: %v", err)
	}
	if conflicts := folderMoveConflicts(memos, existing, path, newPath); len(conflicts) > 0 {
		return nil, status.Errorf(codes.AlreadyExists,
			"%d document(s) already exist at the destination: %s", len(conflicts), strings.Join(conflicts, ", "))
	}

	// Folder rows first, so an interrupted move leaves the destination folders in
	// place (harmless, and empty folders are user-deletable) rather than documents
	// sitting in a folder the destination workspace has no row for.
	folders, err := s.Store.ListWorkspaceFolders(ctx, &store.FindWorkspaceFolder{WorkspaceID: &source.ID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list folders: %v", err)
	}
	destinationFolders, err := s.Store.ListWorkspaceFolders(ctx, &store.FindWorkspaceFolder{WorkspaceID: &destination.ID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list destination folders: %v", err)
	}
	existingFolders := make(map[string]struct{}, len(destinationFolders))
	for _, f := range destinationFolders {
		existingFolders[f.Path] = struct{}{}
	}
	moved := []*store.WorkspaceFolder{}
	for _, f := range folders {
		if f.Path != path && !strings.HasPrefix(f.Path, path+"/") {
			continue
		}
		moved = append(moved, f)
		target := movedFolderPath(f.Path, path, newPath)
		// A folder that already exists at the destination is merged into, not
		// duplicated; (workspace_id, path) is unique so inserting would fail.
		if _, ok := existingFolders[target]; ok {
			continue
		}
		if _, err := s.Store.CreateWorkspaceFolder(ctx, &store.WorkspaceFolder{
			WorkspaceID: destination.ID,
			Path:        target,
		}); err != nil {
			return nil, status.Errorf(codes.Internal, "failed to create destination folder: %v", err)
		}
	}

	now := time.Now().Unix()
	for i, m := range memos {
		target := movedFolderPath(m.FolderPath, path, newPath)
		if err := s.Store.UpdateMemo(ctx, &store.UpdateMemo{
			ID:          m.ID,
			WorkspaceID: &destination.ID,
			FolderPath:  &target,
			UpdatedTs:   &now,
		}); err != nil {
			// Partial moves are recoverable: the operation is idempotent, so the user
			// can retry and the documents already moved are simply skipped next time.
			return nil, status.Errorf(codes.Internal,
				"failed to move document %q (%d of %d moved, retry to finish): %v", m.Title, i, len(memos), err)
		}
	}

	for _, f := range moved {
		if err := s.Store.DeleteWorkspaceFolder(ctx, &store.DeleteWorkspaceFolder{WorkspaceID: source.ID, Path: f.Path}); err != nil {
			return nil, status.Errorf(codes.Internal, "failed to clean up source folder: %v", err)
		}
	}

	return &v1pb.MoveWorkspaceFolderResponse{
		NewPath:            newPath,
		MovedDocumentCount: int32(len(memos)),
	}, nil
}

// movedFolderDestination is where a folder ends up when dropped into
// destinationParent: it keeps its own name and becomes a child of the target.
func movedFolderDestination(path, destinationParent string) string {
	name := path
	if index := strings.LastIndex(path, "/"); index >= 0 {
		name = path[index+1:]
	}
	if destinationParent == "" {
		return name
	}
	return destinationParent + "/" + name
}

// folderMoveConflicts returns the titles of documents in the moved subtree that
// would land on a (folder_path, title) pair the destination workspace already
// uses. That pair is unique per workspace in the schema, so each of these would
// fail the write; they are collected rather than hit one at a time.
func folderMoveConflicts(moving, destination []*store.Memo, oldRoot, newRoot string) []string {
	taken := make(map[string]struct{}, len(destination))
	for _, m := range destination {
		taken[normalizeFolderPath(m.FolderPath)+"\x00"+m.Title] = struct{}{}
	}
	conflicts := []string{}
	for _, m := range moving {
		if _, ok := taken[movedFolderPath(m.FolderPath, oldRoot, newRoot)+"\x00"+m.Title]; ok {
			conflicts = append(conflicts, m.Title)
		}
	}
	return conflicts
}

// movedFolderPath rebases a path that sits at or under oldRoot onto newRoot.
func movedFolderPath(path, oldRoot, newRoot string) string {
	path = normalizeFolderPath(path)
	if path == oldRoot {
		return newRoot
	}
	if strings.HasPrefix(path, oldRoot+"/") {
		return newRoot + path[len(oldRoot):]
	}
	return path
}

func (s *APIV1Service) DeleteWorkspaceFolder(ctx context.Context, request *v1pb.DeleteWorkspaceFolderRequest) (*emptypb.Empty, error) {
	workspace, _, err := s.getWorkspaceAndCheckOwnership(ctx, request.Parent)
	if err != nil {
		return nil, err
	}
	path := normalizeFolderPath(request.Path)

	// Only live documents block the delete. Archived ones keep their folder_path
	// forever (archiving never moves a memo), but the tree hides them, so counting
	// them here would make any folder that ever held a deleted document
	// permanently undeletable while looking empty in the UI. Folders are implicit
	// in the tree anyway, so an archived memo restored later still finds its way
	// back into a folder with no row.
	normal := store.Normal
	memos, err := s.Store.ListMemos(ctx, &store.FindMemo{
		WorkspaceID:      &workspace.ID,
		FolderPathPrefix: &path,
		RowStatus:        &normal,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to check folder contents: %v", err)
	}
	if len(memos) > 0 {
		return nil, status.Errorf(codes.FailedPrecondition, "folder is not empty")
	}

	// P1: reject the delete if a document outside this folder subtree links to
	// a document inside it. Includes archived documents in the subtree as
	// possible link targets, since they can still be linked to even though
	// they no longer block emptiness above.
	subtreeMemos, err := s.Store.ListMemos(ctx, &store.FindMemo{
		WorkspaceID:      &workspace.ID,
		FolderPathPrefix: &path,
		ExcludeContent:   true,
		ExcludeComments:  true,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to check folder contents: %v", err)
	}
	if len(subtreeMemos) > 0 {
		ids := make([]int32, len(subtreeMemos))
		inSubtree := make(map[int32]bool, len(subtreeMemos))
		for i, m := range subtreeMemos {
			ids[i] = m.ID
			inSubtree[m.ID] = true
		}
		refs, err := s.findExternalLinkReferences(ctx, ids, inSubtree)
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to check memo references: %v", err)
		}
		if len(refs) > 0 {
			return nil, referenceDependencyError(refs)
		}
	}

	if err := s.Store.DeleteWorkspaceFolder(ctx, &store.DeleteWorkspaceFolder{WorkspaceID: workspace.ID, Path: path}); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to delete folder: %v", err)
	}
	return &emptypb.Empty{}, nil
}

// resolveOrCreateDefaultWorkspace returns the user's first workspace, creating a
// "Default" one if they have none yet. It exists so legacy API clients that don't
// pass a workspace on memo creation still get a valid, organized home for their memo.
func (s *APIV1Service) resolveOrCreateDefaultWorkspace(ctx context.Context, userID int32) (*store.Workspace, error) {
	// A hidden workspace must never become the implicit home for a new memo, so only
	// visible ones count here — a user whose every workspace is hidden gets a fresh one.
	visibleOnly := false
	list, err := s.Store.ListWorkspaces(ctx, &store.FindWorkspace{CreatorID: &userID, Hidden: &visibleOnly})
	if err != nil {
		return nil, err
	}
	if len(list) > 0 {
		return list[0], nil
	}
	uid, err := ValidateAndGenerateUID("")
	if err != nil {
		return nil, err
	}
	storageSlug, err := s.Store.GenerateStorageSlug(ctx, uid, "Default")
	if err != nil {
		return nil, err
	}
	return s.Store.CreateWorkspace(ctx, &store.Workspace{
		UID:         uid,
		CreatorID:   userID,
		Title:       "Default",
		StorageSlug: storageSlug,
	})
}

// resolveWorkspaceForMemo resolves the target workspace for a create/update memo
// request. The given value may be either a resource name ("workspaces/{uid}")
// or, since callers don't necessarily know a workspace's UID, its display
// title (unique per user). Falls back to (creating, if necessary) the user's
// default workspace when empty.
func (s *APIV1Service) resolveWorkspaceForMemo(ctx context.Context, userID int32, workspaceName string) (*store.Workspace, error) {
	if strings.TrimSpace(workspaceName) == "" {
		return s.resolveOrCreateDefaultWorkspace(ctx, userID)
	}

	var workspace *store.Workspace
	if uid, err := ExtractWorkspaceUIDFromName(workspaceName); err == nil {
		workspace, err = s.Store.GetWorkspace(ctx, &store.FindWorkspace{UID: &uid})
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to get workspace: %v", err)
		}
	} else {
		var err error
		workspace, err = s.Store.GetWorkspace(ctx, &store.FindWorkspace{CreatorID: &userID, Title: &workspaceName})
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to get workspace: %v", err)
		}
	}
	if workspace == nil {
		return nil, status.Errorf(codes.NotFound, "workspace not found")
	}
	if workspace.CreatorID != userID {
		return nil, status.Errorf(codes.PermissionDenied, "permission denied")
	}
	return workspace, nil
}

// getWorkspaceAndCheckOwnership resolves a workspace by resource name and ensures
// the current authenticated user is its creator.
func (s *APIV1Service) getWorkspaceAndCheckOwnership(ctx context.Context, name string) (*store.Workspace, *store.User, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}
	uid, err := ExtractWorkspaceUIDFromName(name)
	if err != nil {
		return nil, nil, status.Errorf(codes.InvalidArgument, "invalid workspace name: %v", err)
	}
	workspace, err := s.Store.GetWorkspace(ctx, &store.FindWorkspace{UID: &uid})
	if err != nil {
		return nil, nil, status.Errorf(codes.Internal, "failed to get workspace: %v", err)
	}
	if workspace == nil {
		return nil, nil, status.Errorf(codes.NotFound, "workspace not found")
	}
	if workspace.CreatorID != user.ID {
		return nil, nil, status.Errorf(codes.PermissionDenied, "permission denied")
	}
	return workspace, user, nil
}

func isValidWorkspaceSortField(field string) bool {
	switch field {
	case "createTime", "updateTime", "alphabetical":
		return true
	default:
		return false
	}
}

func isValidWorkspaceSortOrder(order string) bool {
	switch order {
	case "asc", "desc":
		return true
	default:
		return false
	}
}

func convertWorkspaceFromStore(workspace *store.Workspace, creatorUsername string) *v1pb.Workspace {
	return &v1pb.Workspace{
		Name:         WorkspaceNamePrefix + workspace.UID,
		Title:        workspace.Title,
		Creator:      BuildUserName(creatorUsername),
		CreateTime:   timestamppb.New(time.Unix(workspace.CreatedTs, 0)),
		UpdateTime:   timestamppb.New(time.Unix(workspace.UpdatedTs, 0)),
		SortField:    workspace.SortField,
		SortOrder:    workspace.SortOrder,
		CoverColor:   workspace.CoverColor,
		CoverImage:   workspace.CoverImage,
		FoldersFirst: workspace.FoldersFirst,
		DisplayOrder: workspace.DisplayOrder,
		Hidden:       workspace.Hidden,
	}
}

// normalizeFolderPath trims slashes and whitespace from a user-provided folder path.
func normalizeFolderPath(path string) string {
	return strings.Trim(strings.TrimSpace(path), "/")
}

// treeDir is an in-memory helper used to assemble a workspace's folder/document
// hierarchy from a flat list of memos and folder rows.
type treeDir struct {
	children map[string]*treeDir
	docs     []*store.Memo
}

func newTreeDir() *treeDir {
	return &treeDir{children: map[string]*treeDir{}}
}

func (d *treeDir) ensurePath(segments []string) *treeDir {
	cur := d
	for _, seg := range segments {
		if seg == "" {
			continue
		}
		next, ok := cur.children[seg]
		if !ok {
			next = newTreeDir()
			cur.children[seg] = next
		}
		cur = next
	}
	return cur
}

func (d *treeDir) toNodes(prefix string) []*v1pb.WorkspaceTreeNode {
	names := make([]string, 0, len(d.children))
	for name := range d.children {
		names = append(names, name)
	}
	sort.Strings(names)

	nodes := make([]*v1pb.WorkspaceTreeNode, 0, len(names)+len(d.docs))
	for _, name := range names {
		childPath := name
		if prefix != "" {
			childPath = prefix + "/" + name
		}
		nodes = append(nodes, &v1pb.WorkspaceTreeNode{
			Type:     v1pb.WorkspaceTreeNode_FOLDER,
			Name:     name,
			Path:     childPath,
			Children: d.children[name].toNodes(childPath),
		})
	}

	sort.Slice(d.docs, func(i, j int) bool { return d.docs[i].CreatedTs < d.docs[j].CreatedTs })
	for _, m := range d.docs {
		docPath := m.UID
		if prefix != "" {
			docPath = prefix + "/" + m.UID
		}
		nodes = append(nodes, &v1pb.WorkspaceTreeNode{
			Type:       v1pb.WorkspaceTreeNode_DOCUMENT,
			Name:       m.Title,
			Path:       docPath,
			Memo:       MemoNamePrefix + m.UID,
			Archived:   m.RowStatus == store.Archived,
			DocType:    m.DocType,
			CreateTime: timestamppb.New(time.Unix(m.CreatedTs, 0)),
			UpdateTime: timestamppb.New(time.Unix(m.UpdatedTs, 0)),
		})
	}
	return nodes
}
