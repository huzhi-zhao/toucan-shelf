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

// MemoHistorySource records what produced a version. It decides retention:
// only MemoHistoryAuto is ever pruned.
type MemoHistorySource string

const (
	// MemoHistoryManual is a version the user asked for and named.
	MemoHistoryManual MemoHistorySource = "manual"
	// MemoHistoryAuto is written by the editor's auto-save before it overwrites
	// the stored content, so an auto-save can always be undone. These accumulate
	// without anyone asking, which is why they are the only kind with retention.
	MemoHistoryAuto MemoHistorySource = "auto"
	// MemoHistoryAgentBaseline is the last human-authored state before an AI
	// write. Kept forever like a manual version: once the agent has overwritten
	// it, this row is the only copy of what the human wrote.
	MemoHistoryAgentBaseline MemoHistorySource = "agent_baseline"
)

// Retention for MemoHistoryAuto versions, applied per memo. Both limits are
// enforced together — whichever bites first — every time an auto version is
// written, so there is no sweeper to run and no way for a document to sit on an
// unbounded pile of them.
const (
	// AutoMemoHistoryMaxAge is how far back auto versions stay recoverable.
	AutoMemoHistoryMaxAge = 90 * 24 * time.Hour
	// AutoMemoHistoryMaxCount is how many auto versions a single memo keeps,
	// newest first.
	AutoMemoHistoryMaxCount = 10
)

// MemoHistory is a snapshot (version) of a memo's content and attachment set at
// a point in time. History records are append-only: they are never updated, and
// the only deletion is auto-version retention (PruneAutoMemoHistories).
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
	// Source is what produced this version; see MemoHistorySource. Empty on
	// create means MemoHistoryManual.
	Source MemoHistorySource
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
	// Source narrows the list to one kind of version — used by retention, which
	// only ever looks at auto versions.
	Source *MemoHistorySource

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
	if create.Source == "" {
		create.Source = MemoHistoryManual
	}
	return s.driver.CreateMemoHistory(ctx, create)
}

// PruneAutoMemoHistories drops the memo's auto versions that retention no
// longer covers: older than AutoMemoHistoryMaxAge, or past the newest
// AutoMemoHistoryMaxCount. Manual and agent-baseline versions are never
// touched. Returns how many rows were removed.
func (s *Store) PruneAutoMemoHistories(ctx context.Context, memoID int32) (int64, error) {
	if memoID == 0 {
		return 0, errors.New("memo id is required")
	}
	cutoffTs := time.Now().Add(-AutoMemoHistoryMaxAge).Unix()
	return s.driver.PruneAutoMemoHistories(ctx, memoID, cutoffTs, AutoMemoHistoryMaxCount)
}

func (s *Store) ListMemoHistories(ctx context.Context, find *FindMemoHistory) ([]*MemoHistory, error) {
	return s.driver.ListMemoHistories(ctx, find)
}
