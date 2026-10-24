package sqlite

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/internal/profile"
)

// A transaction that reads before it writes must wait out another writer, not fail with SQLITE_BUSY: a
// deferred transaction cannot upgrade its read lock while someone else writes, and SQLite does not retry that.
func TestTransactionReadThenWriteWaitsForOtherWriter(t *testing.T) {
	ctx := context.Background()
	driver, err := NewDB(&profile.Profile{DSN: filepath.Join(t.TempDir(), "tx.db")})
	require.NoError(t, err)
	db := driver.(*DB)
	defer db.Close()
	_, err = db.db.ExecContext(ctx, "CREATE TABLE t (v INTEGER)")
	require.NoError(t, err)

	// Another connection is in the middle of a write.
	other, err := db.db.Conn(ctx)
	require.NoError(t, err)
	defer other.Close()
	_, err = other.ExecContext(ctx, "BEGIN IMMEDIATE")
	require.NoError(t, err)
	_, err = other.ExecContext(ctx, "INSERT INTO t (v) VALUES (1)")
	require.NoError(t, err)
	go func() {
		time.Sleep(200 * time.Millisecond)
		_, _ = other.ExecContext(ctx, "COMMIT")
	}()

	err = db.withPlannerTx(ctx, func(tx *sql.Tx) error {
		var n int
		if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM t").Scan(&n); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, "INSERT INTO t (v) VALUES (2)")
		return err
	})
	require.NoError(t, err)
}
