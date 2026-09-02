package store

import (
	"context"
	"database/sql"
)

// Driver is an interface for store driver.
// It contains all methods that store database driver should implement.
type Driver interface {
	GetDB() *sql.DB
	Close() error

	IsInitialized(ctx context.Context) (bool, error)

	// GetDatabaseSize returns the database size in bytes, or -1 if unavailable.
	// A non-nil error indicates a hard failure; -1 with nil error means the
	// driver cannot report a size from the underlying database.
	GetDatabaseSize(ctx context.Context) (int64, error)

	// Attachment model related methods.
	CreateAttachment(ctx context.Context, create *Attachment) (*Attachment, error)
	ListAttachments(ctx context.Context, find *FindAttachment) ([]*Attachment, error)
	UpdateAttachment(ctx context.Context, update *UpdateAttachment) error
	DeleteAttachment(ctx context.Context, delete *DeleteAttachment) error
	DeleteAttachments(ctx context.Context, deletes []*DeleteAttachment) error

	// Memo model related methods.
	CreateMemo(ctx context.Context, create *Memo) (*Memo, error)
	ListMemos(ctx context.Context, find *FindMemo) ([]*Memo, error)
	UpdateMemo(ctx context.Context, update *UpdateMemo) error
	DeleteMemo(ctx context.Context, delete *DeleteMemo) error

	// MemoRelation model related methods.
	UpsertMemoRelation(ctx context.Context, create *MemoRelation) (*MemoRelation, error)
	ListMemoRelations(ctx context.Context, find *FindMemoRelation) ([]*MemoRelation, error)
	DeleteMemoRelation(ctx context.Context, delete *DeleteMemoRelation) error

	// MemoLink model related methods (reverse-link index for cross-document
	// markdown links, derived from memo content).
	ReplaceMemoLinks(ctx context.Context, memoID int32, targetMemoIDs []int32) error
	ListMemoLinks(ctx context.Context, find *FindMemoLink) ([]*MemoLink, error)
	DeleteMemoLinks(ctx context.Context, delete *DeleteMemoLink) error

	// MemoHistory model related methods.
	CreateMemoHistory(ctx context.Context, create *MemoHistory) (*MemoHistory, error)
	ListMemoHistories(ctx context.Context, find *FindMemoHistory) ([]*MemoHistory, error)

	// MemoChunk / RAG index related methods.
	ReplaceMemoChunks(ctx context.Context, memoID int32, chunks []*MemoChunk) error
	DeleteMemoChunks(ctx context.Context, memoID int32) error
	ListMemoChunks(ctx context.Context, find *FindMemoChunk) ([]*MemoChunk, error)
	SearchMemoChunksFTS(ctx context.Context, query *ChunkFTSQuery) ([]*ChunkFTSResult, error)
	SearchMemosLike(ctx context.Context, query *MemoLikeQuery) ([]*MemoLikeResult, error)
	UpsertMemoIndexJob(ctx context.Context, memoID int32, reason string) error
	ListMemoIndexJobs(ctx context.Context, find *FindMemoIndexJob) ([]*MemoIndexJob, error)
	UpdateMemoIndexJob(ctx context.Context, update *UpdateMemoIndexJob) error
	DeleteMemoIndexJob(ctx context.Context, memoID int32) error
	CountMemoIndexJobsByStatus(ctx context.Context) (map[string]int, error)

	// AttachmentMigrationJob related methods (attachment storage migration).
	UpsertAttachmentMigrationJobs(ctx context.Context, jobs []*AttachmentMigrationJob) error
	ListAttachmentMigrationJobs(ctx context.Context, find *FindAttachmentMigrationJob) ([]*AttachmentMigrationJob, error)
	UpdateAttachmentMigrationJob(ctx context.Context, update *UpdateAttachmentMigrationJob) error
	CountAttachmentMigrationJobsByStatus(ctx context.Context) (map[string]int, error)
	ClearAttachmentMigrationJobs(ctx context.Context) error
	ApplyAttachmentStorageMigration(ctx context.Context, rewrites []*AttachmentStorageRewriteRow, settings []*InstanceSetting) error

	// InstanceSetting model related methods.
	UpsertInstanceSetting(ctx context.Context, upsert *InstanceSetting) (*InstanceSetting, error)
	ListInstanceSettings(ctx context.Context, find *FindInstanceSetting) ([]*InstanceSetting, error)
	DeleteInstanceSetting(ctx context.Context, delete *DeleteInstanceSetting) error

	// User model related methods.
	CreateUser(ctx context.Context, create *User) (*User, error)
	UpdateUser(ctx context.Context, update *UpdateUser) (*User, error)
	ListUsers(ctx context.Context, find *FindUser) ([]*User, error)
	DeleteUser(ctx context.Context, delete *DeleteUser) (*DeleteUserResult, error)

	// UserSetting model related methods.
	UpsertUserSetting(ctx context.Context, upsert *UserSetting) (*UserSetting, error)
	ListUserSettings(ctx context.Context, find *FindUserSetting) ([]*UserSetting, error)
	DeleteUserSettings(ctx context.Context, delete *DeleteUserSetting) error
	GetUserByPATHash(ctx context.Context, tokenHash string) (*PATQueryResult, error)

	// IdentityProvider model related methods.
	CreateIdentityProvider(ctx context.Context, create *IdentityProvider) (*IdentityProvider, error)
	ListIdentityProviders(ctx context.Context, find *FindIdentityProvider) ([]*IdentityProvider, error)
	UpdateIdentityProvider(ctx context.Context, update *UpdateIdentityProvider) (*IdentityProvider, error)
	DeleteIdentityProvider(ctx context.Context, delete *DeleteIdentityProvider) error

	// Inbox model related methods.
	CreateInbox(ctx context.Context, create *Inbox) (*Inbox, error)
	ListInboxes(ctx context.Context, find *FindInbox) ([]*Inbox, error)
	UpdateInbox(ctx context.Context, update *UpdateInbox) (*Inbox, error)
	DeleteInbox(ctx context.Context, delete *DeleteInbox) error

	// Workspace model related methods.
	CreateWorkspace(ctx context.Context, create *Workspace) (*Workspace, error)
	ListWorkspaces(ctx context.Context, find *FindWorkspace) ([]*Workspace, error)
	UpdateWorkspace(ctx context.Context, update *UpdateWorkspace) (*Workspace, error)
	DeleteWorkspace(ctx context.Context, delete *DeleteWorkspace) error
	CreateWorkspaceFolder(ctx context.Context, create *WorkspaceFolder) (*WorkspaceFolder, error)
	ListWorkspaceFolders(ctx context.Context, find *FindWorkspaceFolder) ([]*WorkspaceFolder, error)
	DeleteWorkspaceFolder(ctx context.Context, delete *DeleteWorkspaceFolder) error
	RenameWorkspaceFolder(ctx context.Context, workspaceID int32, oldPath, newPath string) error

	// WorkspaceGrant model related methods.
	CreateWorkspaceGrant(ctx context.Context, create *WorkspaceGrant) (*WorkspaceGrant, error)
	ListWorkspaceGrants(ctx context.Context, find *FindWorkspaceGrant) ([]*WorkspaceGrant, error)
	UpdateWorkspaceGrant(ctx context.Context, update *UpdateWorkspaceGrant) (*WorkspaceGrant, error)
	DeleteWorkspaceGrant(ctx context.Context, delete *DeleteWorkspaceGrant) error

	// Reaction model related methods.
	UpsertReaction(ctx context.Context, create *Reaction) (*Reaction, error)
	ListReactions(ctx context.Context, find *FindReaction) ([]*Reaction, error)
	GetReaction(ctx context.Context, find *FindReaction) (*Reaction, error)
	DeleteReaction(ctx context.Context, delete *DeleteReaction) error

	// MemoShare model related methods.
	CreateMemoShare(ctx context.Context, create *MemoShare) (*MemoShare, error)
	ListMemoShares(ctx context.Context, find *FindMemoShare) ([]*MemoShare, error)
	GetMemoShare(ctx context.Context, find *FindMemoShare) (*MemoShare, error)
	DeleteMemoShare(ctx context.Context, delete *DeleteMemoShare) error

	// Site model related methods (public publishing target).
	CreateSite(ctx context.Context, create *Site) (*Site, error)
	ListSites(ctx context.Context, find *FindSite) ([]*Site, error)
	UpdateSite(ctx context.Context, update *UpdateSite) (*Site, error)
	DeleteSite(ctx context.Context, delete *DeleteSite) error

	// SitePublication model related methods (read-only published snapshots).
	CreateSitePublication(ctx context.Context, create *SitePublication) (*SitePublication, error)
	ListSitePublications(ctx context.Context, find *FindSitePublication) ([]*SitePublication, error)
	UpdateSitePublication(ctx context.Context, update *UpdateSitePublication) (*SitePublication, error)
	DeleteSitePublication(ctx context.Context, delete *DeleteSitePublication) error
	ReplaceSitePublicationAttachments(ctx context.Context, publicationID int32, refs []*SitePublicationAttachment) error
	ListSitePublicationAttachments(ctx context.Context, find *FindSitePublicationAttachment) ([]*SitePublicationAttachment, error)
	ReplaceSitePublicationLinks(ctx context.Context, publicationID int32, links []*SitePublicationLink) error
	ListSitePublicationLinks(ctx context.Context, find *FindSitePublicationLink) ([]*SitePublicationLink, error)

	// UserIdentity model related methods.
	CreateUserIdentity(ctx context.Context, create *UserIdentity) (*UserIdentity, error)
	ListUserIdentities(ctx context.Context, find *FindUserIdentity) ([]*UserIdentity, error)
	DeleteUserIdentities(ctx context.Context, delete *DeleteUserIdentity) error

	// SecretBlock model related methods.
	CreateSecretBlock(ctx context.Context, create *SecretBlock) (*SecretBlock, error)
	GetSecretBlock(ctx context.Context, find *FindSecretBlock) (*SecretBlock, error)
	ListSecretBlockSummaries(ctx context.Context, find *FindSecretBlock) ([]*SecretBlockSummary, error)
	UpdateSecretBlock(ctx context.Context, update *UpdateSecretBlock) (*SecretBlock, error)
	DeleteSecretBlock(ctx context.Context, delete *DeleteSecretBlock) error
}
