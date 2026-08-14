# Store tests

SQLite is the only supported driver (see
[`../../docs/dev/requirements/storage/sqlite-as-sole-datasource.md`](../../docs/dev/requirements/storage/sqlite-as-sole-datasource.md)).
Each test gets its own temp database file, so no setup is needed:

```sh
go test -v ./store/...
```

Some migration tests start containers via testcontainers. Set
`SKIP_CONTAINER_TESTS=1` to skip those when no Docker daemon is available.
