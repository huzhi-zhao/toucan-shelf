package memogitdist

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/labstack/echo/v5"
	"github.com/stretchr/testify/require"
)

func TestServeDistribution(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "version.json"), []byte(`{"version":"v"}`), 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "bootstrap.md"), []byte("# hi"), 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "memogit-linux-amd64"), []byte("ELF"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(dir, ".hidden"), []byte("x"), 0o644))
	require.NoError(t, os.Mkdir(filepath.Join(dir, "sub"), 0o755))

	e := echo.New()
	RegisterRoutes(e, dir)

	tests := []struct {
		path        string
		status      int
		body        string
		contentType string
	}{
		{"/memogit/version.json", http.StatusOK, `{"version":"v"}`, "application/json; charset=utf-8"},
		{"/memogit/bootstrap.md", http.StatusOK, "# hi", "text/markdown; charset=utf-8"},
		{"/memogit/memogit-linux-amd64", http.StatusOK, "ELF", "application/octet-stream"},
		{"/memogit/missing", http.StatusNotFound, "", ""},
		{"/memogit/.hidden", http.StatusNotFound, "", ""},
		{"/memogit/sub", http.StatusNotFound, "", ""},
		{"/memogit/..%2Fetc%2Fpasswd", http.StatusNotFound, "", ""},
	}
	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			e.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, tt.path, nil))
			require.Equal(t, tt.status, rec.Code)
			if tt.status == http.StatusOK {
				require.Equal(t, tt.body, rec.Body.String())
				require.Equal(t, tt.contentType, rec.Header().Get(echo.HeaderContentType))
				require.Equal(t, "no-cache", rec.Header().Get(echo.HeaderCacheControl))
			}
		})
	}
}

func TestNoDistributionRegistersNothing(t *testing.T) {
	e := echo.New()
	RegisterRoutes(e, "")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/memogit/version.json", nil))
	require.Equal(t, http.StatusNotFound, rec.Code)
}
