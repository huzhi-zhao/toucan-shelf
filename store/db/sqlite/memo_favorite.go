package sqlite

import (
	"context"
	"database/sql"
	"strings"

	"github.com/pkg/errors"

	"github.com/usememos/memos/store"
)

func (d *DB) AddMemoFavorite(ctx context.Context, userID, memoID int32) (*store.MemoFavorite, error) {
	if _, err := d.db.ExecContext(ctx, "INSERT INTO `memo_favorite` (`user_id`, `memo_id`) VALUES (?, ?) ON CONFLICT DO NOTHING", userID, memoID); err != nil {
		return nil, errors.Wrap(err, "failed to add memo favorite")
	}
	return d.getMemoFavorite(ctx, userID, memoID)
}

func (d *DB) ListMemoFavorites(ctx context.Context, find *store.FindMemoFavorite) ([]*store.MemoFavorite, error) {
	where, args := []string{"1 = 1"}, []any{}
	if find.UserID != nil {
		where, args = append(where, "`user_id` = ?"), append(args, *find.UserID)
	}
	if find.MemoID != nil {
		where, args = append(where, "`memo_id` = ?"), append(args, *find.MemoID)
	}
	rows, err := d.db.QueryContext(ctx, "SELECT `user_id`, `memo_id`, `pinned`, `created_ts` FROM `memo_favorite` WHERE "+
		strings.Join(where, " AND ")+" ORDER BY `pinned` DESC, `created_ts` DESC, `memo_id` DESC", args...)
	if err != nil {
		return nil, errors.Wrap(err, "failed to list memo favorites")
	}
	defer rows.Close()

	list := []*store.MemoFavorite{}
	for rows.Next() {
		favorite := &store.MemoFavorite{}
		if err := rows.Scan(&favorite.UserID, &favorite.MemoID, &favorite.Pinned, &favorite.CreatedTs); err != nil {
			return nil, errors.Wrap(err, "failed to scan memo favorite")
		}
		list = append(list, favorite)
	}
	if err := rows.Err(); err != nil {
		return nil, errors.Wrap(err, "failed to list memo favorites")
	}
	return list, nil
}

func (d *DB) UpdateMemoFavorite(ctx context.Context, update *store.UpdateMemoFavorite) (*store.MemoFavorite, error) {
	if update.Pinned != nil {
		if _, err := d.db.ExecContext(ctx, "UPDATE `memo_favorite` SET `pinned` = ? WHERE `user_id` = ? AND `memo_id` = ?",
			*update.Pinned, update.UserID, update.MemoID); err != nil {
			return nil, errors.Wrap(err, "failed to update memo favorite")
		}
	}
	return d.getMemoFavorite(ctx, update.UserID, update.MemoID)
}

func (d *DB) DeleteMemoFavorite(ctx context.Context, userID, memoID int32) error {
	if _, err := d.db.ExecContext(ctx, "DELETE FROM `memo_favorite` WHERE `user_id` = ? AND `memo_id` = ?", userID, memoID); err != nil {
		return errors.Wrap(err, "failed to delete memo favorite")
	}
	return nil
}

// getMemoFavorite returns nil when the document is not one of the user's favorites.
func (d *DB) getMemoFavorite(ctx context.Context, userID, memoID int32) (*store.MemoFavorite, error) {
	list, err := d.ListMemoFavorites(ctx, &store.FindMemoFavorite{UserID: &userID, MemoID: &memoID})
	if err != nil || len(list) == 0 {
		return nil, err
	}
	return list[0], nil
}

// deleteMemoFavoritesTx removes a deleted user's favorites. They are personal, so nothing is inherited.
func deleteMemoFavoritesTx(ctx context.Context, tx *sql.Tx, userID int32) error {
	if _, err := tx.ExecContext(ctx, "DELETE FROM `memo_favorite` WHERE `user_id` = ?", userID); err != nil {
		return errors.Wrap(err, "failed to delete memo favorites")
	}
	return nil
}
