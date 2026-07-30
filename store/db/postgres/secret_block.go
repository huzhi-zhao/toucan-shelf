package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/usememos/memos/store"
)

const secretBlockColumns = "id, uid, creator_id, hint, kdf, kdf_iterations, cipher, salt, nonce, verifier, ciphertext, created_ts, updated_ts"

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
	); err != nil {
		return nil, err
	}
	return sb, nil
}

func (d *DB) CreateSecretBlock(ctx context.Context, create *store.SecretBlock) (*store.SecretBlock, error) {
	args := []any{
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
	}
	stmt := "INSERT INTO secret_block (uid, creator_id, hint, kdf, kdf_iterations, cipher, salt, nonce, verifier, ciphertext) " +
		"VALUES (" + placeholders(len(args)) + ") RETURNING id, created_ts, updated_ts"
	if err := d.db.QueryRowContext(ctx, stmt, args...).Scan(
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
		where, args = append(where, "uid = "+placeholder(len(args)+1)), append(args, *find.UID)
	}
	if find.CreatorID != nil {
		where, args = append(where, "creator_id = "+placeholder(len(args)+1)), append(args, *find.CreatorID)
	}

	row := d.db.QueryRowContext(ctx,
		"SELECT "+secretBlockColumns+" FROM secret_block WHERE "+strings.Join(where, " AND ")+" LIMIT 1",
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
		where, args = append(where, "uid = "+placeholder(len(args)+1)), append(args, *find.UID)
	}
	if find.CreatorID != nil {
		where, args = append(where, "creator_id = "+placeholder(len(args)+1)), append(args, *find.CreatorID)
	}

	rows, err := d.db.QueryContext(ctx,
		"SELECT uid, hint, LENGTH(ciphertext), created_ts, updated_ts FROM secret_block "+
			"WHERE "+strings.Join(where, " AND ")+" ORDER BY id DESC",
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
	args := []any{
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
	}
	stmt := "UPDATE secret_block SET hint = " + placeholder(1) +
		", kdf = " + placeholder(2) +
		", kdf_iterations = " + placeholder(3) +
		", cipher = " + placeholder(4) +
		", salt = " + placeholder(5) +
		", nonce = " + placeholder(6) +
		", verifier = " + placeholder(7) +
		", ciphertext = " + placeholder(8) +
		", updated_ts = EXTRACT(EPOCH FROM NOW())" +
		" WHERE uid = " + placeholder(9) + " AND creator_id = " + placeholder(10) +
		" RETURNING " + secretBlockColumns

	row := d.db.QueryRowContext(ctx, stmt, args...)
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
	_, err := d.db.ExecContext(ctx,
		"DELETE FROM secret_block WHERE uid = "+placeholder(1)+" AND creator_id = "+placeholder(2),
		delete.UID, delete.CreatorID,
	)
	return err
}
