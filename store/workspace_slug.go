package store

import (
	"context"
	"strings"
	"unicode"
)

// UnassignedWorkspaceSlug is the storage directory for attachments with no owning workspace:
// uploads that legitimately arrive without one, and rows whose document was deleted. It lives
// here rather than next to the upload path because the storage migration has to recompute the
// exact directory the upload path would have chosen.
const UnassignedWorkspaceSlug = "_unassigned"

// maxStorageSlugRunes caps the derived part of a storage slug. Titles are unbounded but the
// slug ends up inside every object key of the workspace, so keep it short.
const maxStorageSlugRunes = 48

// isStorageSlugRune reports whether r may appear in a storage slug: Latin letters, digits,
// and CJK ideographs. Everything else (spaces, punctuation, emoji, combining marks) is
// dropped, which keeps slugs safe as a path segment on any storage backend.
func isStorageSlugRune(r rune) bool {
	switch {
	case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
		return true
	case unicode.Is(unicode.Han, r):
		return true
	default:
		return false
	}
}

// BuildStorageSlugBase derives the candidate slug from a workspace title. It returns "" when
// the title has no usable characters at all; callers fall back to the workspace UID.
func BuildStorageSlugBase(title string) string {
	var b strings.Builder
	n := 0
	for _, r := range title {
		if !isStorageSlugRune(r) {
			continue
		}
		b.WriteRune(r)
		n++
		if n >= maxStorageSlugRunes {
			break
		}
	}
	return b.String()
}

// GenerateStorageSlug produces a storage slug for a workspace that is unique across all
// workspaces. Uniqueness matters because the slug is the workspace's directory in attachment
// storage: two workspaces sharing one would defeat the isolation the directory exists for.
//
// Collisions are resolved by appending the workspace UID, which is itself unique — one step,
// no retry loop.
func (s *Store) GenerateStorageSlug(ctx context.Context, uid, title string) (string, error) {
	base := BuildStorageSlugBase(title)
	if base == "" {
		return uid, nil
	}
	taken, err := s.ListWorkspaces(ctx, &FindWorkspace{StorageSlug: &base})
	if err != nil {
		return "", err
	}
	if len(taken) == 0 {
		return base, nil
	}
	return base + "-" + uid, nil
}

// EnsureWorkspaceStorageSlug returns the workspace's storage slug, generating and persisting
// one on first use. Existing workspaces predate the column, so backfill happens lazily here
// rather than in a migration — deriving a slug from a CJK title is not expressible in SQL.
//
// Once set, the slug is never recomputed: object keys already written under it must keep
// resolving, so a later workspace rename deliberately does not move the directory.
func (s *Store) EnsureWorkspaceStorageSlug(ctx context.Context, workspace *Workspace) (string, error) {
	if workspace.StorageSlug != "" {
		return workspace.StorageSlug, nil
	}
	slug, err := s.GenerateStorageSlug(ctx, workspace.UID, workspace.Title)
	if err != nil {
		return "", err
	}
	updated, err := s.UpdateWorkspace(ctx, &UpdateWorkspace{ID: workspace.ID, StorageSlug: &slug})
	if err != nil {
		return "", err
	}
	workspace.StorageSlug = updated.StorageSlug
	return updated.StorageSlug, nil
}
