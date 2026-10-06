package main

import (
	"runtime/debug"
	"time"
)

// buildVersion is the version stamped in with
// `-ldflags "-X main.buildVersion=..."` for builds that have no git checkout
// to read it from — the server image builds the published memogit inside
// Docker, whose build context excludes .git. It is the same string version()
// would compute from the checkout (scripts/build-memogit.sh derives it there).
var buildVersion string

// version describes which source this binary was built from. memogit has no
// release numbers; the version is the commit date plus the commit hash,
// e.g. "2026.10.05-14c6f2b35". `go build` inside the repo
// already stamps it into the build info (vcs.revision / vcs.time /
// vcs.modified), so a normal build needs no ldflags; buildVersion covers the
// builds that can't see the repo.
func version() string {
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return fallbackVersion()
	}
	var revision, commitTime string
	var modified bool
	for _, s := range info.Settings {
		switch s.Key {
		case "vcs.revision":
			revision = s.Value
		case "vcs.time":
			commitTime = s.Value
		case "vcs.modified":
			modified = s.Value == "true"
		}
	}
	if revision == "" {
		// Built outside a git checkout (or with -buildvcs=false).
		return fallbackVersion()
	}
	if len(revision) > 9 {
		revision = revision[:9]
	}
	if modified {
		// Uncommitted changes went into this build, so the commit alone does
		// not say what it contains.
		revision += "-dirty"
	}
	// Lead with the commit date so two versions compare at a glance; the
	// commit hash after it says exactly what went in.
	if t, err := time.Parse(time.RFC3339, commitTime); err == nil {
		return t.UTC().Format("2006.01.02") + "-" + revision
	}
	return revision
}

func fallbackVersion() string {
	if buildVersion != "" {
		return buildVersion
	}
	return "unknown"
}
