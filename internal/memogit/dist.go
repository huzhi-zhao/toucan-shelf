package memogit

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// DistPath is where a server publishes the memogit build that matches it
// (see server/router/memogitdist and scripts/build-memogit.sh --dist).
const DistPath = "/memogit"

// Distribution is the server's /memogit/version.json.
type Distribution struct {
	// Version is what `memogit -v` of these binaries prints after "memogit ".
	Version string `json:"version"`
	// Files maps "<goos>-<goarch>" to that platform's binary.
	Files map[string]DistFile `json:"files"`
}

// DistFile is one platform binary in a Distribution.
type DistFile struct {
	// Name is the file name under /memogit/.
	Name string `json:"name"`
	// SHA256 is the hex digest of the file.
	SHA256 string `json:"sha256"`
}

// Platform is this binary's key in Distribution.Files.
func Platform() string {
	return runtime.GOOS + "-" + runtime.GOARCH
}

// DistURL is the URL of a file in server's distribution.
func DistURL(server, name string) string {
	return strings.TrimRight(server, "/") + DistPath + "/" + name
}

// FetchDistribution reads server's version.json. Servers without a
// distribution answer 404, which comes back as an error like any other
// failure; callers that only want to nag about versions should stay quiet on
// error.
func FetchDistribution(ctx context.Context, server string, timeout time.Duration) (*Distribution, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	body, err := httpGet(ctx, DistURL(server, "version.json"))
	if err != nil {
		return nil, err
	}
	defer body.Close()
	var d Distribution
	if err := json.NewDecoder(body).Decode(&d); err != nil {
		return nil, fmt.Errorf("parse version.json: %w", err)
	}
	if d.Version == "" {
		return nil, fmt.Errorf("version.json has no version")
	}
	return &d, nil
}

// SelfUpdate replaces the running executable with server's build for this
// platform, verified against the checksum in version.json. The new file is
// written next to the old one and renamed over it, so a failed download never
// leaves a broken binary behind.
func SelfUpdate(ctx context.Context, server string, out io.Writer) (*Distribution, error) {
	exe, err := os.Executable()
	if err != nil {
		return nil, fmt.Errorf("locate running executable: %w", err)
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	return updateBinary(ctx, server, Platform(), exe, out)
}

// updateBinary replaces the file at exe with server's build for platform.
func updateBinary(ctx context.Context, server, platform, exe string, out io.Writer) (*Distribution, error) {
	dist, err := FetchDistribution(ctx, server, 30*time.Second)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", DistURL(server, "version.json"), err)
	}
	file, ok := dist.Files[platform]
	if !ok {
		return nil, fmt.Errorf("server has no memogit build for %s", platform)
	}

	dlCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	body, err := httpGet(dlCtx, DistURL(server, file.Name))
	if err != nil {
		return nil, fmt.Errorf("download %s: %w", file.Name, err)
	}
	defer body.Close()

	tmp, err := os.CreateTemp(filepath.Dir(exe), ".memogit-update-*")
	if err != nil {
		return nil, fmt.Errorf("cannot write next to %s (try sudo, or reinstall with install.sh): %w", exe, err)
	}
	defer os.Remove(tmp.Name()) // no-op once renamed
	hash := sha256.New()
	_, copyErr := io.Copy(io.MultiWriter(tmp, hash), body)
	closeErr := tmp.Close()
	if copyErr != nil {
		return nil, fmt.Errorf("download %s: %w", file.Name, copyErr)
	}
	if closeErr != nil {
		return nil, closeErr
	}
	if got := hex.EncodeToString(hash.Sum(nil)); !strings.EqualFold(got, file.SHA256) {
		return nil, fmt.Errorf("checksum mismatch for %s: got %s, want %s", file.Name, got, file.SHA256)
	}
	if err := os.Chmod(tmp.Name(), 0o755); err != nil {
		return nil, err
	}
	if err := os.Rename(tmp.Name(), exe); err != nil {
		return nil, fmt.Errorf("replace %s: %w", exe, err)
	}
	fmt.Fprintf(out, "Updated %s to memogit %s\n", exe, dist.Version)
	return dist, nil
}

func httpGet(ctx context.Context, url string) (io.ReadCloser, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, fmt.Errorf("%s: HTTP %d", url, resp.StatusCode)
	}
	return resp.Body, nil
}
