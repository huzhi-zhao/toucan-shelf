package v1

import (
	"regexp"
	"testing"

	storepb "github.com/usememos/memos/proto/gen/store"
)

// The file name segment carries a timestamp and a uuid, so assert on shape rather than value.
var s3KeyPattern = regexp.MustCompile(`^(.*/)?\d+_[0-9a-fA-F-]+_[^/]+$`)

func TestBuildS3ObjectKeyThreeLevels(t *testing.T) {
	tests := []struct {
		name          string
		rootPrefix    string
		filenameTmpl  string
		workspaceSlug string
		filename      string
		wantPrefix    string
	}{
		{
			name:          "root prefix, workspace directory, file name",
			rootPrefix:    "assets",
			filenameTmpl:  "{timestamp}_{uuid}_{filename}",
			workspaceSlug: "ai-kb",
			filename:      "a.png",
			wantPrefix:    "assets/ai-kb/",
		},
		{
			name:          "empty root prefix means the bucket root",
			rootPrefix:    "",
			filenameTmpl:  "{timestamp}_{uuid}_{filename}",
			workspaceSlug: "ai-kb",
			filename:      "a.png",
			wantPrefix:    "ai-kb/",
		},
		{
			name:          "nested root prefix",
			rootPrefix:    "toucan/prod/assets",
			filenameTmpl:  "{timestamp}_{uuid}_{filename}",
			workspaceSlug: "ai-kb",
			filename:      "a.png",
			wantPrefix:    "toucan/prod/assets/ai-kb/",
		},
		{
			name:          "upload with no workspace lands in the shared directory",
			rootPrefix:    "assets",
			filenameTmpl:  "{timestamp}_{uuid}_{filename}",
			workspaceSlug: "",
			filename:      "a.png",
			wantPrefix:    "assets/" + unassignedWorkspaceSlug + "/",
		},
		{
			name:          "stray slashes in the root prefix do not double up",
			rootPrefix:    "/assets/",
			filenameTmpl:  "{timestamp}_{uuid}_{filename}",
			workspaceSlug: "ai-kb",
			filename:      "a.png",
			wantPrefix:    "assets/ai-kb/",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			setting := &storepb.InstanceStorageSetting{
				StorageType:      storepb.InstanceStorageSetting_S3,
				FilenameTemplate: tt.filenameTmpl,
				S3Config:         &storepb.StorageS3Config{Bucket: "toucan", RootPrefix: tt.rootPrefix},
			}
			key := buildS3ObjectKey(setting, tt.workspaceSlug, tt.filename)
			if got := key[:min(len(key), len(tt.wantPrefix))]; got != tt.wantPrefix {
				t.Fatalf("key = %q, want prefix %q", key, tt.wantPrefix)
			}
			if !s3KeyPattern.MatchString(key) {
				t.Fatalf("key = %q does not look like <dirs>/<timestamp>_<uuid>_<filename>", key)
			}
		})
	}
}

// A file name template that forgets {filename} still has to produce a usable object name;
// the S3 write path relied on this before the three-level split and still does.
func TestBuildS3ObjectKeyAppendsMissingFilenamePlaceholder(t *testing.T) {
	setting := &storepb.InstanceStorageSetting{
		StorageType:      storepb.InstanceStorageSetting_S3,
		FilenameTemplate: "{timestamp}",
		S3Config:         &storepb.StorageS3Config{Bucket: "toucan", RootPrefix: "assets"},
	}
	key := buildS3ObjectKey(setting, "ai-kb", "a.png")
	if want := "assets/ai-kb/"; key[:len(want)] != want {
		t.Fatalf("key = %q, want prefix %q", key, want)
	}
	if key[len(key)-len("/a.png"):] != "/a.png" {
		t.Fatalf("key = %q, want it to end with the file name", key)
	}
}
