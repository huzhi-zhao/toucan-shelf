package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/usememos/memos/store"
)

const secretBlockColumns = "`id`, `uid`, `creator_id`, `hint`, `kdf`, `kdf_iterations`, `cipher`, `salt`, `nonce`, `verifier`, `ciphertext`, `created_ts`, `updated_ts`, " +
	"`policy`, `pending_policy`, `pending_policy_effective_ts`"

func scanSecretBlock(row interface{ Scan(...any) error }) (*store.SecretBlock, error) {
	sb := &store.SecretBlock{}
	if err := row.Scan(
		&sb.ID,
		&sb.UID,
		&sb.CreatorID,
		&sb.Hint,
		&sb.KDF,
		&sb.KDFIterations,
		&sb.Cipher,
		&sb.Salt,
		&sb.Nonce,
		&sb.Verifier,
		&sb.Ciphertext,
		&sb.CreatedTs,
		&sb.UpdatedTs,
		&sb.Policy,
		&sb.PendingPolicy,
		&sb.PendingPolicyEffectiveTs,
	); err != nil {
		return nil, err
	}
	return sb, nil
}

func (d *DB) CreateSecretBlock(ctx context.Context, create *store.SecretBlock) (*store.SecretBlock, error) {
	stmt := "INSERT INTO `secret_block` (`uid`, `creator_id`, `hint`, `kdf`, `kdf_iterations`, `cipher`, `salt`, `nonce`, `verifier`, `ciphertext`, `policy`) " +
		"VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING `id`, `created_ts`, `updated_ts`"
	if err := d.db.QueryRowContext(ctx, stmt,
		create.UID,
		create.CreatorID,
		create.Hint,
		create.KDF,
		create.KDFIterations,
		create.Cipher,
		create.Salt,
		create.Nonce,
		create.Verifier,
		create.Ciphertext,
		create.Policy,
	).Scan(
		&create.ID,
		&create.CreatedTs,
		&create.UpdatedTs,
	); err != nil {
		return nil, err
	}
	return create, nil
}

func (d *DB) GetSecretBlock(ctx context.Context, find *store.FindSecretBlock) (*store.SecretBlock, error) {
	where, args := []string{"1 = 1"}, []any{}
	if find.UID != nil {
		where, args = append(where, "`uid` = ?"), append(args, *find.UID)
	}
	if find.CreatorID != nil {
		where, args = append(where, "`creator_id` = ?"), append(args, *find.CreatorID)
	}

	row := d.db.QueryRowContext(ctx,
		"SELECT "+secretBlockColumns+" FROM `secret_block` WHERE "+strings.Join(where, " AND ")+" LIMIT 1",
		args...,
	)
	sb, err := scanSecretBlock(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return sb, nil
}

// ListSecretBlockSummaries deliberately does not select the envelope columns.
func (d *DB) ListSecretBlockSummaries(ctx context.Context, find *store.FindSecretBlock) ([]*store.SecretBlockSummary, error) {
	where, args := []string{"1 = 1"}, []any{}
	if find.UID != nil {
		where, args = append(where, "`uid` = ?"), append(args, *find.UID)
	}
	if find.CreatorID != nil {
		where, args = append(where, "`creator_id` = ?"), append(args, *find.CreatorID)
	}

	rows, err := d.db.QueryContext(ctx,
		"SELECT `id`, `uid`, `hint`, LENGTH(`ciphertext`), `created_ts`, `updated_ts`, `policy`, `pending_policy`, `pending_policy_effective_ts` FROM `secret_block` "+
			"WHERE "+strings.Join(where, " AND ")+" ORDER BY `id` DESC",
		args...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := []*store.SecretBlockSummary{}
	for rows.Next() {
		summary := &store.SecretBlockSummary{}
		if err := rows.Scan(
			&summary.ID,
			&summary.UID,
			&summary.Hint,
			&summary.CiphertextSize,
			&summary.CreatedTs,
			&summary.UpdatedTs,
			&summary.Policy,
			&summary.PendingPolicy,
			&summary.PendingPolicyEffectiveTs,
		); err != nil {
			return nil, err
		}
		list = append(list, summary)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return list, nil
}

func (d *DB) UpdateSecretBlock(ctx context.Context, update *store.UpdateSecretBlock) (*store.SecretBlock, error) {
	stmt := "UPDATE `secret_block` SET `hint` = ?, `kdf` = ?, `kdf_iterations` = ?, `cipher` = ?, `salt` = ?, `nonce` = ?, " +
		"`verifier` = ?, `ciphertext` = ?, `updated_ts` = strftime('%s', 'now') " +
		"WHERE `uid` = ? AND `creator_id` = ? RETURNING " + secretBlockColumns
	row := d.db.QueryRowContext(ctx, stmt,
		update.Hint,
		update.KDF,
		update.KDFIterations,
		update.Cipher,
		update.Salt,
		update.Nonce,
		update.Verifier,
		update.Ciphertext,
		update.UID,
		update.CreatorID,
	)
	sb, err := scanSecretBlock(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return sb, nil
}

func (d *DB) DeleteSecretBlock(ctx context.Context, delete *store.DeleteSecretBlock) error {
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// Unlock history belongs to the block and goes with it.
	if _, err := tx.ExecContext(ctx,
		"DELETE FROM `secret_block_unlock` WHERE `secret_block_id` IN (SELECT `id` FROM `secret_block` WHERE `uid` = ? AND `creator_id` = ?)",
		delete.UID, delete.CreatorID,
	); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		"DELETE FROM `secret_block` WHERE `uid` = ? AND `creator_id` = ?",
		delete.UID, delete.CreatorID,
	); err != nil {
		return err
	}
	return tx.Commit()
}

func (d *DB) UpdateSecretBlockPolicy(ctx context.Context, update *store.UpdateSecretBlockPolicy) error {
	_, err := d.db.ExecContext(ctx,
		"UPDATE `secret_block` SET `policy` = ?, `pending_policy` = ?, `pending_policy_effective_ts` = ? WHERE `id` = ?",
		update.Policy, update.PendingPolicy, update.PendingPolicyEffectiveTs, update.ID,
	)
	return err
}

const secretBlockUnlockColumns = "`id`, `secret_block_id`, `kind`, `reason`, `requested_ts`, `available_ts`, `opened_ts`, `expires_ts`, `canceled_ts`"

func (d *DB) CreateSecretBlockUnlock(ctx context.Context, create *store.SecretBlockUnlock) (*store.SecretBlockUnlock, error) {
	stmt := "INSERT INTO `secret_block_unlock` (`secret_block_id`, `kind`, `reason`, `requested_ts`, `available_ts`) " +
		"VALUES (?, ?, ?, ?, ?) RETURNING `id`"
	if err := d.db.QueryRowContext(ctx, stmt,
		create.SecretBlockID, create.Kind, create.Reason, create.RequestedTs, create.AvailableTs,
	).Scan(&create.ID); err != nil {
		return nil, err
	}
	return create, nil
}

func (d *DB) ListSecretBlockUnlocks(ctx context.Context, find *store.FindSecretBlockUnlock) ([]*store.SecretBlockUnlock, error) {
	where, args := []string{"`secret_block_id` = ?"}, []any{find.SecretBlockID}
	if find.Kind != nil {
		where, args = append(where, "`kind` = ?"), append(args, *find.Kind)
	}
	if find.RequestedAfterTs != nil {
		where, args = append(where, "`requested_ts` > ?"), append(args, *find.RequestedAfterTs)
	}
	query := "SELECT " + secretBlockUnlockColumns + " FROM `secret_block_unlock` WHERE " + strings.Join(where, " AND ") + " ORDER BY `requested_ts` DESC, `id` DESC"
	if find.Limit > 0 {
		query += " LIMIT ?"
		args = append(args, find.Limit)
	}
	rows, err := d.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := []*store.SecretBlockUnlock{}
	for rows.Next() {
		u := &store.SecretBlockUnlock{}
		if err := rows.Scan(&u.ID, &u.SecretBlockID, &u.Kind, &u.Reason, &u.RequestedTs, &u.AvailableTs, &u.OpenedTs, &u.ExpiresTs, &u.CanceledTs); err != nil {
			return nil, err
		}
		list = append(list, u)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return list, nil
}

func (d *DB) OpenSecretBlockUnlock(ctx context.Context, id int32, openedTs, expiresTs int64) (bool, error) {
	result, err := d.db.ExecContext(ctx,
		"UPDATE `secret_block_unlock` SET `opened_ts` = ?, `expires_ts` = ? WHERE `id` = ? AND `opened_ts` = 0 AND `canceled_ts` = 0",
		openedTs, expiresTs, id,
	)
	if err != nil {
		return false, err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

func (d *DB) CancelSecretBlockUnlock(ctx context.Context, id int32, canceledTs int64) error {
	_, err := d.db.ExecContext(ctx,
		"UPDATE `secret_block_unlock` SET `canceled_ts` = ? WHERE `id` = ? AND `canceled_ts` = 0",
		canceledTs, id,
	)
	return err
}
