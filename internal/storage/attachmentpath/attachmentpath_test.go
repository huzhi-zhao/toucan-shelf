package attachmentpath

import (
	"strings"
	"testing"
	"time"
)

func TestExpandWorkspace(t *testing.T) {
	tests := []struct {
		name     string
		template string
		pathCtx  Context
		want     string
	}{
		{
			name:     "workspace slug fills the placeholder",
			template: "assets/{workspace}/{filename}",
			pathCtx:  Context{Filename: "a.png", WorkspaceSlug: "AI知识库"},
			want:     "assets/AI知识库/a.png",
		},
		{
			name:     "no workspace falls back to the shared prefix",
			template: "assets/{workspace}/{filename}",
			pathCtx:  Context{Filename: "a.png"},
			want:     "assets/" + UnassignedWorkspaceSlug + "/a.png",
		},
		{
			name:     "local storage drops the segment entirely",
			template: "assets/{workspace}/{filename}",
			pathCtx:  Context{Filename: "a.png", WorkspaceSlug: "AI知识库", DropWorkspace: true},
			want:     "assets/a.png",
		},
		{
			name:     "dropping keeps an absolute template absolute",
			template: "/var/data/{workspace}/{filename}",
			pathCtx:  Context{Filename: "a.png", DropWorkspace: true},
			want:     "/var/data/a.png",
		},
		{
			name:     "template without the placeholder is untouched",
			template: "assets/{filename}",
			pathCtx:  Context{Filename: "a.png", WorkspaceSlug: "AI知识库"},
			want:     "assets/a.png",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := Expand(tt.template, tt.pathCtx); got != tt.want {
				t.Errorf("Expand() = %q, want %q", got, tt.want)
			}
		})
	}
}

// The other placeholders must keep working now that the signature takes a context struct.
func TestExpandOtherPlaceholders(t *testing.T) {
	got := Expand("assets/{year}/{uuid}_{filename}", Context{Filename: "a.png"})
	if !strings.HasPrefix(got, "assets/20") || !strings.HasSuffix(got, "_a.png") {
		t.Errorf("unexpected expansion: %q", got)
	}
	if strings.Contains(got, "{") {
		t.Errorf("placeholder left unexpanded: %q", got)
	}
}

func TestExpandUsesSuppliedInstant(t *testing.T) {
	at := time.Date(2026, 8, 26, 14, 5, 6, 0, time.UTC)
	got := Expand("assets/{year}/{month}/{day}/{filename}", Context{Filename: "a.png", At: at})
	if got != "assets/2026/08/26/a.png" {
		t.Errorf("Expand() = %q, want assets/2026/08/26/a.png", got)
	}
	// Same input, same output: the migration depends on this to be re-runnable.
	if again := Expand("assets/{year}/{month}/{day}/{filename}", Context{Filename: "a.png", At: at}); again != got {
		t.Errorf("Expand() is not deterministic: %q vs %q", again, got)
	}
}

func TestDir(t *testing.T) {
	tests := []struct{ template, want string }{
		{"assets/{workspace}/{timestamp}_{uuid}_{filename}", "assets/{workspace}"},
		{"assets/{filename}", "assets"},
		{"{filename}", ""},
		// A template naming only directories gets an implicit {filename} segment appended,
		// so the whole thing is the directory part.
		{"assets/{workspace}", "assets/{workspace}"},
	}
	for _, tt := range tests {
		if got := Dir(tt.template); got != tt.want {
			t.Errorf("Dir(%q) = %q, want %q", tt.template, got, tt.want)
		}
	}
}

func TestUnstableDirPlaceholder(t *testing.T) {
	tests := []struct{ template, want string }{
		{"assets/{workspace}/{timestamp}_{uuid}_{filename}", ""},
		{"assets/{year}/{month}/{filename}", ""},
		// {uuid} in a directory makes the target path random, so the migration cannot re-run.
		{"assets/{uuid}/{filename}", "{uuid}"},
		{"assets/{filename}/{timestamp}_{filename}", "{filename}"},
	}
	for _, tt := range tests {
		if got := UnstableDirPlaceholder(tt.template); got != tt.want {
			t.Errorf("UnstableDirPlaceholder(%q) = %q, want %q", tt.template, got, tt.want)
		}
	}
}
