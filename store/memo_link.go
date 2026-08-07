package store

import "context"

// MemoLink represents a directed edge in the reverse-link index: MemoID's
// markdown content links to TargetMemoID. This table is fully derived from
// memo content (best-effort parse of markdown links) and is overwritten in
// full whenever the source memo's content changes; it carries no meaning
// beyond that reparse.
type MemoLink struct {
	MemoID       int32
	TargetMemoID int32
}

type FindMemoLink struct {
	MemoID           *int32
	TargetMemoID     *int32
	MemoIDList       []int32 // matches memo_id in list
	TargetMemoIDList []int32 // matches target_memo_id in list
}

type DeleteMemoLink struct {
	MemoID *int32
	// TargetMemoID, when set, deletes inbound links pointing at this memo
	// (i.e. rows where target_memo_id matches). Used when a memo is
	// permanently deleted, so links other memos recorded toward it don't
	// dangle.
	TargetMemoID *int32
}

// ReplaceMemoLinks overwrites the full set of outbound links for a memo. This
// mirrors the "full reparse, overwrite" indexing strategy: callers are
// expected to pass the complete, freshly-parsed set of target memo IDs for
// memoID, including an empty slice to clear all links.
func (s *Store) ReplaceMemoLinks(ctx context.Context, memoID int32, targetMemoIDs []int32) error {
	return s.driver.ReplaceMemoLinks(ctx, memoID, targetMemoIDs)
}

// ListMemoLinks queries the reverse-link index. Use TargetMemoID /
// TargetMemoIDList to find which memos link to a given target (i.e. reverse
// references), and MemoID / MemoIDList to find what a memo links out to.
func (s *Store) ListMemoLinks(ctx context.Context, find *FindMemoLink) ([]*MemoLink, error) {
	return s.driver.ListMemoLinks(ctx, find)
}

// DeleteMemoLinks removes all outbound links recorded for a memo (e.g. when
// the memo itself is deleted).
func (s *Store) DeleteMemoLinks(ctx context.Context, delete *DeleteMemoLink) error {
	return s.driver.DeleteMemoLinks(ctx, delete)
}
