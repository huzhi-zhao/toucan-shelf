package v1

import (
	"context"
	"log/slog"
	"time"

	"github.com/lithammer/shortuuid/v4"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/store"
)

// autoVersionMinInterval is how long an editing session waits between automatic
// versions after its first one.
//
// Auto-save itself runs every 30s; versioning every one of those ticks would
// bury the handful of versions a person actually wants under a wall of
// near-identical rows, each carrying a full copy of the document. Ten minutes
// keeps a multi-hour session down to a readable list while still bounding how
// much typing a single version can hide.
const autoVersionMinInterval = 10 * time.Minute

// snapshotAutoVersionIfNeeded keeps an automatic version of the memo's stored
// state before auto-save overwrites it.
//
// This exists because auto-save commits without anyone pressing anything: a
// stray cut-and-paste in a document left open is written to the server 30
// seconds later, and before this the overwritten text was simply gone. The
// version it writes is what that mistake is undone from.
//
// The first auto-save of an editing session always versions (when the state
// isn't already recoverable) — that is the "before you touched it" copy, and it
// is the one that matters. Later ticks are throttled to autoVersionMinInterval.
//
// It must be called before the memo is mutated: it snapshots `memo` as loaded.
//
// Returns whether a version was written; the caller does not need it, but the
// tests do.
func (s *APIV1Service) snapshotAutoVersionIfNeeded(
	ctx context.Context,
	memo *store.Memo,
	creatorID int32,
	mode v1pb.UpdateMemoRequest_AutoSave,
) (bool, error) {
	if mode == v1pb.UpdateMemoRequest_AUTO_SAVE_UNSPECIFIED {
		// A save the user asked for. They know what they just wrote, and they can
		// name a version themselves if they want one.
		return false, nil
	}

	autoSource := store.MemoHistoryAuto
	if mode == v1pb.UpdateMemoRequest_AUTO_SAVE_PERIODIC {
		one := 1
		recent, err := s.Store.ListMemoHistories(ctx, &store.FindMemoHistory{
			MemoID: &memo.ID,
			Source: &autoSource,
			Limit:  &one,
		})
		if err != nil {
			return false, err
		}
		if len(recent) > 0 && time.Since(time.Unix(recent[0].CreatedTs, 0)) < autoVersionMinInterval {
			return false, nil
		}
	}

	attachments, err := s.Store.ListAttachments(ctx, &store.FindAttachment{MemoID: &memo.ID})
	if err != nil {
		return false, err
	}
	snapshotAttachments := make([]*store.MemoHistoryAttachment, 0, len(attachments))
	uids := make([]string, 0, len(attachments))
	for _, a := range attachments {
		snapshotAttachments = append(snapshotAttachments, &store.MemoHistoryAttachment{
			UID:      a.UID,
			Filename: a.Filename,
			Type:     a.Type,
		})
		uids = append(uids, a.UID)
	}

	// Skip when this exact state is already recoverable from some version —
	// including a manual one, so opening a document, saving a named version and
	// then letting auto-save run doesn't immediately duplicate it. Matching
	// against every version rather than only the newest matters after a restore;
	// see snapshotHumanBaselineIfNeeded for that case.
	currentHash := store.HashMemoState(memo.Content, uids)
	one := 1
	existing, err := s.Store.ListMemoHistories(ctx, &store.FindMemoHistory{
		MemoID:      &memo.ID,
		ContentHash: &currentHash,
		Limit:       &one,
	})
	if err != nil {
		return false, err
	}
	if len(existing) > 0 {
		return false, nil
	}

	// Left unnamed on purpose: the client labels automatic versions from their
	// source, so the label follows the reader's language instead of being frozen
	// into the row at write time.
	if _, err := s.Store.CreateMemoHistory(ctx, &store.MemoHistory{
		UID:         shortuuid.New(),
		MemoID:      memo.ID,
		Title:       memo.Title,
		Content:     memo.Content,
		Payload:     memo.Payload,
		Attachments: snapshotAttachments,
		CreatorID:   creatorID,
		Source:      store.MemoHistoryAuto,
	}); err != nil {
		return false, err
	}

	// Retention runs here rather than on a sweeper: auto versions only ever
	// appear on this path, so this is the one moment a document can exceed its
	// allowance. A failure is not worth failing the save over — the version was
	// written, which is the part that protects the user; the worst case is a few
	// extra rows until the next auto-save prunes them.
	if _, err := s.Store.PruneAutoMemoHistories(ctx, memo.ID); err != nil {
		slog.Warn("Failed to prune auto memo versions",
			slog.Int64("memo_id", int64(memo.ID)),
			slog.Any("err", err),
		)
	}
	return true, nil
}
