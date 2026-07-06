package store

import (
	"context"
)

// Workspace represents a knowledge base that groups memos under a folder hierarchy.
type Workspace struct {
	ID         int32
	UID        string
	CreatorID  int32
	Title      string
	CreatedTs  int64
	UpdatedTs  int64
	SortField  string
	SortOrder  string
	CoverColor string
	CoverImage string
}

// FindWorkspace specifies filter criteria for querying workspaces.
type FindWorkspace struct {
	ID        *int32
	UID       *string
	CreatorID *int32
	Title     *string
}

// UpdateWorkspace contains fields that can be updated for a workspace.
type UpdateWorkspace struct {
	ID         int32
	Title      *string
	SortField  *string
	SortOrder  *string
	CoverColor *string
	CoverImage *string
}

// DeleteWorkspace specifies which workspace to delete.
type DeleteWorkspace struct {
	ID int32
}

// WorkspaceFolder represents a (possibly empty) folder path within a workspace.
type WorkspaceFolder struct {
	ID          int32
	WorkspaceID int32
	Path        string
	CreatedTs   int64
}

// FindWorkspaceFolder specifies filter criteria for querying workspace folders.
type FindWorkspaceFolder struct {
	WorkspaceID *int32
	Path        *string
}

// DeleteWorkspaceFolder specifies which workspace folder to delete.
type DeleteWorkspaceFolder struct {
	WorkspaceID int32
	Path        string
}

// CreateWorkspace creates a new workspace.
func (s *Store) CreateWorkspace(ctx context.Context, create *Workspace) (*Workspace, error) {
	return s.driver.CreateWorkspace(ctx, create)
}

// ListWorkspaces retrieves workspaces matching the filter criteria.
func (s *Store) ListWorkspaces(ctx context.Context, find *FindWorkspace) ([]*Workspace, error) {
	return s.driver.ListWorkspaces(ctx, find)
}

// GetWorkspace retrieves a single workspace matching the filter criteria.
func (s *Store) GetWorkspace(ctx context.Context, find *FindWorkspace) (*Workspace, error) {
	list, err := s.ListWorkspaces(ctx, find)
	if err != nil {
		return nil, err
	}
	if len(list) == 0 {
		return nil, nil
	}
	return list[0], nil
}

// UpdateWorkspace updates an existing workspace.
func (s *Store) UpdateWorkspace(ctx context.Context, update *UpdateWorkspace) (*Workspace, error) {
	return s.driver.UpdateWorkspace(ctx, update)
}

// DeleteWorkspace permanently removes a workspace.
func (s *Store) DeleteWorkspace(ctx context.Context, delete *DeleteWorkspace) error {
	return s.driver.DeleteWorkspace(ctx, delete)
}

// CreateWorkspaceFolder creates a new (possibly empty) workspace folder.
func (s *Store) CreateWorkspaceFolder(ctx context.Context, create *WorkspaceFolder) (*WorkspaceFolder, error) {
	return s.driver.CreateWorkspaceFolder(ctx, create)
}

// ListWorkspaceFolders retrieves workspace folders matching the filter criteria.
func (s *Store) ListWorkspaceFolders(ctx context.Context, find *FindWorkspaceFolder) ([]*WorkspaceFolder, error) {
	return s.driver.ListWorkspaceFolders(ctx, find)
}

// DeleteWorkspaceFolder permanently removes a workspace folder record.
func (s *Store) DeleteWorkspaceFolder(ctx context.Context, delete *DeleteWorkspaceFolder) error {
	return s.driver.DeleteWorkspaceFolder(ctx, delete)
}

// RenameWorkspaceFolder moves a folder (and every memo/subfolder nested under it) from
// oldPath to newPath within a workspace.
func (s *Store) RenameWorkspaceFolder(ctx context.Context, workspaceID int32, oldPath, newPath string) error {
	return s.driver.RenameWorkspaceFolder(ctx, workspaceID, oldPath, newPath)
}
