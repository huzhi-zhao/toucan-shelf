package store

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/usememos/memos/internal/base"

	storepb "github.com/usememos/memos/proto/gen/store"
)

// MemoHistoryAttachment is a lightweight reference to an attachment captured in a
// version snapshot. Only enough is stored to relink (UID) and to display the set
// (Filename/Type); the file bytes themselves are never copied.
type MemoHistoryAttachment struct {
	UID      string `json:"uid"`
	Filename string `json:"filename"`
	Type     string `json:"type"`
}

// MemoHistory is a manually-created snapshot (version) of a memo's content and
// attachment set at a point in time. History records are append-only: they are
// created on demand (never automatically) and are never updated.
type MemoHistory struct {
	// ID is the system generated unique identifier for the history record.
	ID int32
	// UID is the user defined unique identifier for the history record.
	UID string
	// MemoID is the memo this snapshot belongs to.
	MemoID int32
	// Name is the user-supplied version name.
	Name string
	// Title is the memo's title at snapshot time.
	Title string
	// Content is the full memo content at snapshot time.
	Content string
	// Payload is the memo's payload at snapshot time.
	Payload *storepb.MemoPayload
	// Attachments is the memo's attachment set at snapshot time.
	Attachments []*MemoHistoryAttachment
	// ContentHash is the SHA-256 hex digest of the content + attachment set, used
	// to detect whether the memo's current state still matches this saved version.
	ContentHash string
	// CreatorID is the user who created the snapshot.
	CreatorID int32
	// CreatedTs is the snapshot creation time.
	CreatedTs int64
}

type FindMemoHistory struct {
	ID     *int32
	UID    *string
	MemoID *int32
	// ContentHash asks "does this memo already have a version holding exactly
	// this state?" — see HashMemoState. It exists so the agent-baseline path can
	// answer that in the database instead of loading every version's full content
	// to compare hashes in Go; combined with Limit=1 the common answer ("no, take
	// a snapshot") reads no rows at all.
	ContentHash *string

	Limit  *int
	Offset *int
}

// HashMemoState returns the SHA-256 hex digest of a memo's versionable state:
// its content plus its (order-independent) set of attachment UIDs. Both the
// snapshot creation path and the pre-switch guard compute the hash this way so
// that changing either content or attachments invalidates a match.
func HashMemoState(content string, attachmentUIDs []string) string {
	uids := append([]string(nil), attachmentUIDs...)
	sort.Strings(uids)
	h := sha256.New()
	h.Write([]byte(content))
	h.Write([]byte("\x00"))
	h.Write([]byte(strings.Join(uids, "\x00")))
	return hex.EncodeToString(h.Sum(nil))
}

func (s *Store) CreateMemoHistory(ctx context.Context, create *MemoHistory) (*MemoHistory, error) {
	if !base.UIDMatcher.MatchString(create.UID) {
		return nil, errors.New("invalid uid")
	}
	if create.MemoID == 0 {
		return nil, errors.New("memo id is required")
	}
	// Always (re)compute the hash from the snapshotted state so it stays
	// consistent regardless of what the caller passed.
	uids := make([]string, 0, len(create.Attachments))
	for _, a := range create.Attachments {
		uids = append(uids, a.UID)
	}
	create.ContentHash = HashMemoState(create.Content, uids)
	if create.CreatedTs == 0 {
		create.CreatedTs = time.Now().Unix()
	}
	return s.driver.CreateMemoHistory(ctx, create)
}

func (s *Store) ListMemoHistories(ctx context.Context, find *FindMemoHistory) ([]*MemoHistory, error) {
	return s.driver.ListMemoHistories(ctx, find)
}
