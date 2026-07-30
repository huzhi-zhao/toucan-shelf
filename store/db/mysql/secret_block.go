package mysql

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/usememos/memos/store"
)

const secretBlockColumns = "`id`, `uid`, `creator_id`, `hint`, `kdf`, `kdf_iterations`, `cipher`, `salt`, `nonce`, `verifier`, `ciphertext`, `created_ts`, `updated_ts`"

// MySQL has no RETURNING clause, so writes re-read the row they just touched.
func (d *DB) CreateSecretBlock(ctx context.Context, create *store.SecretBlock) (*store.SecretBlock, error) {
	stmt := "INSERT INTO `secret_block` (`uid`, `creator_id`, `hint`, `kdf`, `kdf_iterations`, `cipher`, `salt`, `nonce`, `verifier`, `ciphertext`) " +
		"VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
	if _, err := d.db.ExecContext(ctx, stmt,
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
	); err != nil {
		return nil, err
	}

	sb, err := d.GetSecretBlock(ctx, &store.FindSecretBlock{UID: &create.UID, CreatorID: &create.CreatorID})
	if err != nil {
		return nil, err
	}
	if sb == nil {
		return nil, errors.New("failed to read back the created secret block")
	}
	return sb, nil
}

func (d *DB) GetSecretBlock(ctx context.Context, find *store.FindSecretBlock) (*store.SecretBlock, error) {
	where, args := []string{"1 = 1"}, []any{}
	if find.UID != nil {
		where, args = append(where, "`uid` = ?"), append(args, *find.UID)
	}
	if find.CreatorID != nil {
		where, args = append(where, "`creator_id` = ?"), append(args, *find.CreatorID)
	}

	sb := &store.SecretBlock{}
	if err := d.db.QueryRowContext(ctx,
		"SELECT "+secretBlockColumns+" FROM `secret_block` WHERE "+strings.Join(where, " AND ")+" LIMIT 1",
		args...,
	).Scan(
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
	); err != nil {
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
		"SELECT `uid`, `hint`, LENGTH(`ciphertext`), `created_ts`, `updated_ts` FROM `secret_block` "+
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
			&summary.UID,
			&summary.Hint,
			&summary.CiphertextSize,
			&summary.CreatedTs,
			&summary.UpdatedTs,
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
		"`verifier` = ?, `ciphertext` = ?, `updated_ts` = UNIX_TIMESTAMP() WHERE `uid` = ? AND `creator_id` = ?"
	if _, err := d.db.ExecContext(ctx, stmt,
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
	); err != nil {
		return nil, err
	}
	// RowsAffected is 0 both for "no such record" and "record unchanged", so it
	// cannot tell the two apart. Re-read instead: a nil result means no record.
	return d.GetSecretBlock(ctx, &store.FindSecretBlock{UID: &update.UID, CreatorID: &update.CreatorID})
}

func (d *DB) DeleteSecretBlock(ctx context.Context, delete *store.DeleteSecretBlock) error {
	_, err := d.db.ExecContext(ctx,
		"DELETE FROM `secret_block` WHERE `uid` = ? AND `creator_id` = ?",
		delete.UID, delete.CreatorID,
	)
	return err
}
