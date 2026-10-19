package store

import (
	"context"
)

// MemoFavorite is a document on a user's reading list (docs/dev/requirements/mobile-phase3.md §2).
// It is personal: unlike Memo.Pinned, which every reader of the document shares, each user has their own.
type MemoFavorite struct {
	UserID int32
	MemoID int32
	// Pinned keeps the favorite at the top of the list however old it is.
	Pinned    bool
	CreatedTs int64
}

// FindMemoFavorite filters favorites. Callers always scope by UserID.
type FindMemoFavorite struct {
	UserID *int32
	MemoID *int32
}

// UpdateMemoFavorite changes the given fields of one favorite.
type UpdateMemoFavorite struct {
	UserID int32
	MemoID int32
	Pinned *bool
}

// AddMemoFavorite adds a document to the user's favorites. Adding one that is already there keeps it as it
// was, favorite time and pin included.
func (s *Store) AddMemoFavorite(ctx context.Context, userID, memoID int32) (*MemoFavorite, error) {
	return s.driver.AddMemoFavorite(ctx, userID, memoID)
}

// ListMemoFavorites returns favorites, pinned first, then the most recently added first.
func (s *Store) ListMemoFavorites(ctx context.Context, find *FindMemoFavorite) ([]*MemoFavorite, error) {
	return s.driver.ListMemoFavorites(ctx, find)
}

// UpdateMemoFavorite changes one favorite; it returns nil when the document is not a favorite.
func (s *Store) UpdateMemoFavorite(ctx context.Context, update *UpdateMemoFavorite) (*MemoFavorite, error) {
	return s.driver.UpdateMemoFavorite(ctx, update)
}

// DeleteMemoFavorite removes a document from the user's favorites. Removing one that is not there is a no-op.
func (s *Store) DeleteMemoFavorite(ctx context.Context, userID, memoID int32) error {
	return s.driver.DeleteMemoFavorite(ctx, userID, memoID)
}
