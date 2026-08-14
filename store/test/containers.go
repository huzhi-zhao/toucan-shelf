package test

import (
	"context"
	"fmt"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/moby/moby/api/types/container"
	"github.com/pkg/errors"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/network"
	"github.com/testcontainers/testcontainers-go/wait"
)

const (
	// Memos container settings for migration testing.
	MemosDockerImage   = "neosmemo/memos"
	StableMemosVersion = "stable" // Always points to the latest stable release
)

var (
	// Network for container communication.
	testDockerNetwork atomic.Pointer[testcontainers.DockerNetwork]
	testNetworkOnce   sync.Once
)

// getTestNetwork creates or returns the shared Docker network for container communication.
func getTestNetwork(ctx context.Context) (*testcontainers.DockerNetwork, error) {
	var networkErr error
	testNetworkOnce.Do(func() {
		nw, err := network.New(ctx, network.WithDriver("bridge"))
		if err != nil {
			networkErr = err
			return
		}
		testDockerNetwork.Store(nw)
	})
	return testDockerNetwork.Load(), networkErr
}

func requireTestNetwork(ctx context.Context) (*testcontainers.DockerNetwork, error) {
	nw, err := getTestNetwork(ctx)
	if err != nil {
		return nil, errors.Wrap(err, "failed to create test network")
	}
	if nw == nil {
		return nil, errors.New("test network is unavailable")
	}
	return nw, nil
}

func skipIfContainerProviderUnavailable(t *testing.T) {
	t.Helper()
	if os.Getenv("SKIP_CONTAINER_TESTS") == "1" {
		t.Skip("skipping container-based test (SKIP_CONTAINER_TESTS=1)")
	}
	testcontainers.SkipIfProviderIsNotHealthy(t)
}

// TerminateContainers cleans up the shared network.
// This is typically called from TestMain.
func TerminateContainers() {
	ctx := context.Background()
	if network := testDockerNetwork.Load(); network != nil {
		_ = network.Remove(ctx)
	}
}

// MemosContainerConfig holds configuration for starting a Memos container.
type MemosContainerConfig struct {
	Version string // Memos version tag (e.g., "0.24.0")
	DataDir string // Host directory to mount for SQLite data
}

// MemosStartupWaitStrategy defines the wait strategy for Memos container startup.
// Uses regex to match various log message formats across versions.
var MemosStartupWaitStrategy = wait.ForAll(
	wait.ForLog("(started successfully|has been started on port)").AsRegexp(),
	wait.ForListeningPort("5230/tcp"),
).WithDeadline(180 * time.Second)

// StartMemosContainer starts a Memos container for migration testing.
// The dataDir is mounted at /var/opt/memos so the SQLite file is reachable
// from the host after the container exits.
func StartMemosContainer(ctx context.Context, cfg MemosContainerConfig) (testcontainers.Container, error) {
	env := map[string]string{
		"MEMOS_MODE":   "prod",
		"MEMOS_DRIVER": "sqlite",
	}

	nw, err := requireTestNetwork(ctx)
	if err != nil {
		return nil, err
	}

	opts := []testcontainers.ContainerCustomizer{
		testcontainers.WithHostConfigModifier(func(hc *container.HostConfig) {
			hc.Binds = append(hc.Binds, fmt.Sprintf("%s:%s", cfg.DataDir, "/var/opt/memos"))
		}),
	}

	req := testcontainers.ContainerRequest{
		Image:        fmt.Sprintf("%s:%s", MemosDockerImage, cfg.Version),
		Env:          env,
		ExposedPorts: []string{"5230/tcp"},
		WaitingFor:   MemosStartupWaitStrategy,
		User:         fmt.Sprintf("%d:%d", os.Getuid(), os.Getgid()),
	}

	// Use local image if specified
	if cfg.Version == "local" {
		if os.Getenv("MEMOS_TEST_IMAGE_BUILT") == "1" {
			req.Image = "memos-test:local"
		} else {
			req.Image = ""
			req.FromDockerfile = testcontainers.FromDockerfile{
				Context:    "../../",
				Dockerfile: "scripts/Dockerfile",
			}
		}
	}

	genericReq := testcontainers.GenericContainerRequest{
		ContainerRequest: req,
		Started:          true,
	}

	// Apply options
	opts = append(opts, network.WithNetwork(nil, nw))
	for _, opt := range opts {
		if err := opt.Customize(&genericReq); err != nil {
			return nil, errors.Wrap(err, "failed to apply container option")
		}
	}

	ctr, err := testcontainers.GenericContainer(ctx, genericReq)
	if err != nil {
		return nil, errors.Wrap(err, "failed to start memos container")
	}

	return ctr, nil
}
