package db

import (
	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/profile"
	"github.com/usememos/memos/store"
	"github.com/usememos/memos/store/db/sqlite"
)

// NewDBDriver creates new db driver based on profile.
//
// This project supports SQLite only. The inherited mysql/postgres drivers have
// been removed; see docs/dev/requirements/storage/sqlite-as-sole-datasource.md.
func NewDBDriver(profile *profile.Profile) (store.Driver, error) {
	var driver store.Driver
	var err error

	switch profile.Driver {
	case "sqlite":
		driver, err = sqlite.NewDB(profile)
	case "mysql", "postgres":
		return nil, errors.Errorf("db driver %q is no longer supported: this project supports SQLite only", profile.Driver)
	default:
		return nil, errors.Errorf("unknown db driver %q: this project supports SQLite only", profile.Driver)
	}
	if err != nil {
		return nil, errors.Wrap(err, "failed to create db driver")
	}
	return driver, nil
}
