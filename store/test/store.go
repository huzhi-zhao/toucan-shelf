package test

import (
	"context"
	"fmt"
	"net"
	"testing"

	// sqlite driver.
	_ "modernc.org/sqlite"

	"github.com/joho/godotenv"

	"github.com/usememos/memos/internal/profile"
	"github.com/usememos/memos/internal/version"
	"github.com/usememos/memos/store"
	"github.com/usememos/memos/store/db"
)

// NewTestingStore creates a new testing store with a fresh SQLite database in
// a temp file, one per test.
func NewTestingStore(ctx context.Context, t *testing.T) *store.Store {
	profile := getTestingProfile(t)
	dbDriver, err := db.NewDBDriver(profile)
	if err != nil {
		t.Fatalf("failed to create db driver: %v", err)
	}

	store := store.New(dbDriver, profile)
	if err := store.Migrate(ctx); err != nil {
		t.Fatalf("failed to migrate db: %v", err)
	}
	return store
}

// NewTestingStoreWithDSN creates a testing store connected to a specific DSN.
// This is useful for testing migrations on existing data.
func NewTestingStoreWithDSN(_ context.Context, t *testing.T, dsn string) *store.Store {
	profile := &profile.Profile{
		Port:    getUnusedPort(),
		Data:    t.TempDir(), // Dummy dir, DSN matters
		DSN:     dsn,
		Driver:  "sqlite",
		Version: version.GetCurrentVersion(),
	}
	dbDriver, err := db.NewDBDriver(profile)
	if err != nil {
		t.Fatalf("failed to create db driver: %v", err)
	}

	store := store.New(dbDriver, profile)
	// Do not run Migrate() automatically, as we might be testing pre-migration state
	// or want to run it manually.
	return store
}

func getUnusedPort() int {
	// Get a random unused port
	listener, err := net.Listen("tcp", "localhost:0")
	if err != nil {
		panic(err)
	}
	defer listener.Close()

	// Get the port number
	port := listener.Addr().(*net.TCPAddr).Port
	return port
}

// getTestingProfile creates a testing profile backed by a temp SQLite file.
func getTestingProfile(t *testing.T) *profile.Profile {
	// Attempt to load .env file if present (optional, for local development)
	_ = godotenv.Load(".env")

	// Get a temporary directory for the test data.
	dir := t.TempDir()
	mode := "prod"

	return &profile.Profile{
		Port:    getUnusedPort(),
		Data:    dir,
		DSN:     fmt.Sprintf("%s/memos_%s.db", dir, mode),
		Driver:  "sqlite",
		Version: version.GetCurrentVersion(),
	}
}
