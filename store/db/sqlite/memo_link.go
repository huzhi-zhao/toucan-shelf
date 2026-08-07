package sqlite

import (
	"context"
	"fmt"
	"strings"

	"github.com/usememos/memos/store"
)

// ReplaceMemoLinks overwrites the full set of outbound links for memoID
// within a single transaction: delete all existing rows for memoID, then
// insert the freshly-parsed set. This matches the "full reparse, overwrite"
// strategy so the table never accumulates stale edges.
func (d *DB) ReplaceMemoLinks(ctx context.Context, memoID int32, targetMemoIDs []int32) error {
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, "DELETE FROM memo_link WHERE memo_id = ?", memoID); err != nil {
		return err
	}

	if len(targetMemoIDs) > 0 {
		// De-duplicate to avoid violating the UNIQUE(memo_id, target_memo_id) constraint.
		seen := make(map[int32]struct{}, len(targetMemoIDs))
		placeholders := make([]string, 0, len(targetMemoIDs))
		args := make([]any, 0, len(targetMemoIDs)*2)
		for _, targetMemoID := range targetMemoIDs {
			if _, ok := seen[targetMemoID]; ok {
				continue
			}
			seen[targetMemoID] = struct{}{}
			placeholders = append(placeholders, "(?, ?)")
			args = append(args, memoID, targetMemoID)
		}
		if len(placeholders) > 0 {
			stmt := "INSERT INTO memo_link (memo_id, target_memo_id) VALUES " + strings.Join(placeholders, ", ")
			if _, err := tx.ExecContext(ctx, stmt, args...); err != nil {
				return err
			}
		}
	}

	return tx.Commit()
}

func (d *DB) ListMemoLinks(ctx context.Context, find *store.FindMemoLink) ([]*store.MemoLink, error) {
	where, args := []string{"TRUE"}, []any{}
	if find.MemoID != nil {
		where, args = append(where, "memo_id = ?"), append(args, *find.MemoID)
	}
	if find.TargetMemoID != nil {
		where, args = append(where, "target_memo_id = ?"), append(args, *find.TargetMemoID)
	}
	if len(find.MemoIDList) > 0 {
		placeholders := make([]string, len(find.MemoIDList))
		for i, id := range find.MemoIDList {
			placeholders[i] = "?"
			args = append(args, id)
		}
		where = append(where, fmt.Sprintf("memo_id IN (%s)", strings.Join(placeholders, ", ")))
	}
	if len(find.TargetMemoIDList) > 0 {
		placeholders := make([]string, len(find.TargetMemoIDList))
		for i, id := range find.TargetMemoIDList {
			placeholders[i] = "?"
			args = append(args, id)
		}
		where = append(where, fmt.Sprintf("target_memo_id IN (%s)", strings.Join(placeholders, ", ")))
	}

	query := `
		SELECT
			memo_id,
			target_memo_id
		FROM memo_link
		WHERE ` + strings.Join(where, " AND ") + `
		ORDER BY memo_id ASC`

	rows, err := d.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := []*store.MemoLink{}
	for rows.Next() {
		memoLink := &store.MemoLink{}
		if err := rows.Scan(&memoLink.MemoID, &memoLink.TargetMemoID); err != nil {
			return nil, err
		}
		list = append(list, memoLink)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return list, nil
}

func (d *DB) DeleteMemoLinks(ctx context.Context, delete *store.DeleteMemoLink) error {
	where, args := []string{"TRUE"}, []any{}
	if delete.MemoID != nil {
		where, args = append(where, "memo_id = ?"), append(args, *delete.MemoID)
	}
	if delete.TargetMemoID != nil {
		where, args = append(where, "target_memo_id = ?"), append(args, *delete.TargetMemoID)
	}
	stmt := `DELETE FROM memo_link WHERE ` + strings.Join(where, " AND ")
	if _, err := d.db.ExecContext(ctx, stmt, args...); err != nil {
		return err
	}
	return nil
}
