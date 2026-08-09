// Package commentvisibility realigns existing comments with the visibility of the
// document they hang on.
//
// A comment's visibility is assigned once, when it is created, from its parent. Until
// the cascade in UpdateMemo was added, nothing re-applied it: a public document that
// collected comments and was later made private kept comments still marked public.
// The document side hid their bodies anyway (it checks the parent), but their
// attachments were reachable, which is what made this worth fixing in the data and
// not only in the code path.
//
// This runs once at startup and rewrites the stored value. Because that is not
// reversible, every row it is about to change is written to a dump file in the data
// directory first.
package commentvisibility

import (
	"context"
	"encoding/csv"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/pkg/errors"

	"github.com/usememos/memos/store"
)

// DumpFilePrefix names the pre-write dump; the run's timestamp is appended.
const DumpFilePrefix = "comment_visibility_backfill_"

type Runner struct {
	Store   *store.Store
	DataDir string
}

func NewRunner(store *store.Store, dataDir string) *Runner {
	return &Runner{Store: store, DataDir: dataDir}
}

// mismatch is one comment whose stored visibility disagrees with its parent's.
type mismatch struct {
	commentID  int32
	commentUID string
	parentID   int32
	from       store.Visibility
	to         store.Visibility
}

// RunOnce aligns every mismatched comment. Failures are logged rather than fatal:
// a startup backfill must not keep the instance from coming up.
func (r *Runner) RunOnce(ctx context.Context) {
	mismatches, err := r.findMismatches(ctx)
	if err != nil {
		slog.Error("failed to scan comment visibility", "err", err)
		return
	}
	if len(mismatches) == 0 {
		return
	}

	dumpPath, err := r.writeDump(mismatches)
	if err != nil {
		// The dump is the only record of the pre-backfill values, so no dump means
		// no rewrite: an unrecoverable one is worse than a stale one.
		slog.Error("failed to write comment visibility backfill dump; skipping backfill", "err", err)
		return
	}

	aligned := 0
	for _, m := range mismatches {
		if ctx.Err() != nil {
			slog.Info("comment visibility backfill cancelled", "aligned", aligned, "total", len(mismatches))
			return
		}
		visibility := m.to
		if err := r.Store.UpdateMemo(ctx, &store.UpdateMemo{
			ID:         m.commentID,
			Visibility: &visibility,
			// Visibility is not indexed (title and content are); this must not
			// re-queue the corpus for embedding.
			SkipReindex: true,
		}); err != nil {
			slog.Error("failed to align comment visibility", "err", err, "memoID", m.commentID)
			continue
		}
		aligned++
	}

	slog.Info("comment visibility backfill finished", "aligned", aligned, "total", len(mismatches), "dump", dumpPath)
}

// findMismatches collects the comments whose visibility differs from their parent's.
func (r *Runner) findMismatches(ctx context.Context) ([]mismatch, error) {
	commentType := store.MemoRelationComment
	relations, err := r.Store.ListMemoRelations(ctx, &store.FindMemoRelation{Type: &commentType})
	if err != nil {
		return nil, errors.Wrap(err, "failed to list comment relations")
	}

	parents := map[int32]*store.Memo{}
	var mismatches []mismatch
	for _, relation := range relations {
		parent, ok := parents[relation.RelatedMemoID]
		if !ok {
			parent, err = r.Store.GetMemo(ctx, &store.FindMemo{ID: &relation.RelatedMemoID, ExcludeContent: true})
			if err != nil {
				return nil, errors.Wrap(err, "failed to get parent memo")
			}
			parents[relation.RelatedMemoID] = parent
		}
		if parent == nil {
			continue
		}

		comment, err := r.Store.GetMemo(ctx, &store.FindMemo{ID: &relation.MemoID, ExcludeContent: true})
		if err != nil {
			return nil, errors.Wrap(err, "failed to get comment memo")
		}
		if comment == nil || comment.Visibility == parent.Visibility {
			continue
		}
		mismatches = append(mismatches, mismatch{
			commentID:  comment.ID,
			commentUID: comment.UID,
			parentID:   parent.ID,
			from:       comment.Visibility,
			to:         parent.Visibility,
		})
	}
	return mismatches, nil
}

// writeDump records the rows about to be rewritten, so the original values survive the
// backfill. Returns the path written.
func (r *Runner) writeDump(mismatches []mismatch) (string, error) {
	path := filepath.Join(r.DataDir, fmt.Sprintf("%s%d.csv", DumpFilePrefix, time.Now().Unix()))
	file, err := os.Create(path)
	if err != nil {
		return "", errors.Wrap(err, "failed to create dump file")
	}
	defer file.Close()

	writer := csv.NewWriter(file)
	if err := writer.Write([]string{"memo_id", "memo_uid", "parent_memo_id", "previous_visibility", "new_visibility"}); err != nil {
		return "", errors.Wrap(err, "failed to write dump header")
	}
	for _, m := range mismatches {
		row := []string{
			strconv.FormatInt(int64(m.commentID), 10),
			m.commentUID,
			strconv.FormatInt(int64(m.parentID), 10),
			string(m.from),
			string(m.to),
		}
		if err := writer.Write(row); err != nil {
			return "", errors.Wrap(err, "failed to write dump row")
		}
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		return "", errors.Wrap(err, "failed to flush dump file")
	}
	return path, nil
}
