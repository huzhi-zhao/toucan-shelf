package v1

import (
	"context"
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
	workspace, err := s.Store.CreateWorkspace(ctx, &store.Workspace{
		UID:       uid,
		CreatorID: user.ID,
		Title:     request.Workspace.Title,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to create workspace: %v", err)
	}
	return convertWorkspaceFromStore(workspace, user.Username), nil
}

func (s *APIV1Service) ListWorkspaces(ctx context.Context, _ *v1pb.ListWorkspacesRequest) (*v1pb.ListWorkspacesResponse, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}

	list, err := s.Store.ListWorkspaces(ctx, &store.FindWorkspace{CreatorID: &user.ID})
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

	memos, err := s.Store.ListMemos(ctx, &store.FindMemo{WorkspaceID: &workspace.ID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to check workspace contents: %v", err)
	}
	if len(memos) > 0 {
		return nil, status.Errorf(codes.FailedPrecondition, "workspace is not empty")
	}

	if err := s.Store.DeleteWorkspace(ctx, &store.DeleteWorkspace{ID: workspace.ID}); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to delete workspace: %v", err)
	}
	return &emptypb.Empty{}, nil
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
	return &emptypb.Empty{}, nil
}

func (s *APIV1Service) DeleteWorkspaceFolder(ctx context.Context, request *v1pb.DeleteWorkspaceFolderRequest) (*emptypb.Empty, error) {
	workspace, _, err := s.getWorkspaceAndCheckOwnership(ctx, request.Parent)
	if err != nil {
		return nil, err
	}
	path := normalizeFolderPath(request.Path)

	memos, err := s.Store.ListMemos(ctx, &store.FindMemo{WorkspaceID: &workspace.ID, FolderPathPrefix: &path})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to check folder contents: %v", err)
	}
	if len(memos) > 0 {
		return nil, status.Errorf(codes.FailedPrecondition, "folder is not empty")
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
	list, err := s.Store.ListWorkspaces(ctx, &store.FindWorkspace{CreatorID: &userID})
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
	return s.Store.CreateWorkspace(ctx, &store.Workspace{
		UID:       uid,
		CreatorID: userID,
		Title:     "Default",
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
		Name:       WorkspaceNamePrefix + workspace.UID,
		Title:      workspace.Title,
		Creator:    BuildUserName(creatorUsername),
		CreateTime: timestamppb.New(time.Unix(workspace.CreatedTs, 0)),
		UpdateTime: timestamppb.New(time.Unix(workspace.UpdatedTs, 0)),
		SortField:  workspace.SortField,
		SortOrder:  workspace.SortOrder,
		CoverColor: workspace.CoverColor,
		CoverImage: workspace.CoverImage,
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
