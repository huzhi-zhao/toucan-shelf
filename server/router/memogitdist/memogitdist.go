// Package memogitdist serves a prebuilt memogit distribution directory under
// /memogit/: the per-platform binaries, version.json, install.sh and the
// agent-facing bootstrap.md, all built from the same commit as this server by
// `scripts/build-memogit.sh --dist`.
//
// The server treats the directory as opaque static files. It does not import
// or understand memogit; it only hands out what the build put there, so
// downstream repos always get the memogit that matches this server. See
// docs/dev/design/20261006-memogit-hosted-distribution.md.
package memogitdist

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/labstack/echo/v5"
)

// PathPrefix is where the distribution is mounted.
const PathPrefix = "/memogit"

// RegisterRoutes mounts dir under PathPrefix. An empty dir registers nothing,
// so /memogit/* stays a plain 404 on instances without a distribution.
func RegisterRoutes(e *echo.Echo, dir string) {
	if dir == "" {
		return
	}
	e.GET(PathPrefix+"/:name", func(c *echo.Context) error {
		return serveFile(c, dir, c.Param("name"))
	})
}

func serveFile(c *echo.Context, dir, name string) error {
	// Only plain top-level files: no subpaths, no traversal, no dotfiles.
	if name == "" || strings.ContainsAny(name, `/\`) || strings.HasPrefix(name, ".") {
		return echo.ErrNotFound
	}
	path := filepath.Join(dir, name)
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() {
		return echo.ErrNotFound
	}
	f, err := os.Open(path)
	if err != nil {
		return echo.ErrNotFound
	}
	defer f.Close()

	header := c.Response().Header()
	header.Set(echo.HeaderContentType, contentType(name))
	// The file names are stable across releases (memogit-linux-amd64,
	// version.json, ...), so clients must always revalidate; ServeContent
	// answers that with a 304 when nothing changed.
	header.Set(echo.HeaderCacheControl, "no-cache")
	http.ServeContent(c.Response(), c.Request(), name, info.ModTime(), f)
	return nil
}

func contentType(name string) string {
	switch filepath.Ext(name) {
	case ".md":
		return "text/markdown; charset=utf-8"
	case ".sh":
		return "text/x-shellscript; charset=utf-8"
	case ".json":
		return "application/json; charset=utf-8"
	default:
		return "application/octet-stream"
	}
}
