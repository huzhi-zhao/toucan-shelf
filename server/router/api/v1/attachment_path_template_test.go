package v1

import (
	"strings"
	"testing"
)

func TestReplaceFilenameWithPathTemplateWorkspace(t *testing.T) {
	tests := []struct {
		name     string
		template string
		pathCtx  attachmentPathContext
		want     string
	}{
		{
			name:     "workspace slug fills the placeholder",
			template: "assets/{workspace}/{filename}",
			pathCtx:  attachmentPathContext{filename: "a.png", workspaceSlug: "AI知识库"},
			want:     "assets/AI知识库/a.png",
		},
		{
			name:     "no workspace falls back to the shared prefix",
			template: "assets/{workspace}/{filename}",
			pathCtx:  attachmentPathContext{filename: "a.png"},
			want:     "assets/" + unassignedWorkspaceSlug + "/a.png",
		},
		{
			name:     "local storage drops the segment entirely",
			template: "assets/{workspace}/{filename}",
			pathCtx:  attachmentPathContext{filename: "a.png", workspaceSlug: "AI知识库", dropWorkspace: true},
			want:     "assets/a.png",
		},
		{
			name:     "dropping keeps an absolute template absolute",
			template: "/var/data/{workspace}/{filename}",
			pathCtx:  attachmentPathContext{filename: "a.png", dropWorkspace: true},
			want:     "/var/data/a.png",
		},
		{
			name:     "template without the placeholder is untouched",
			template: "assets/{filename}",
			pathCtx:  attachmentPathContext{filename: "a.png", workspaceSlug: "AI知识库"},
			want:     "assets/a.png",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := replaceFilenameWithPathTemplate(tt.template, tt.pathCtx); got != tt.want {
				t.Errorf("replaceFilenameWithPathTemplate() = %q, want %q", got, tt.want)
			}
		})
	}
}

// The other placeholders must keep working now that the signature takes a context struct.
func TestReplaceFilenameWithPathTemplateOtherPlaceholders(t *testing.T) {
	got := replaceFilenameWithPathTemplate("assets/{year}/{uuid}_{filename}", attachmentPathContext{filename: "a.png"})
	if !strings.HasPrefix(got, "assets/20") || !strings.HasSuffix(got, "_a.png") {
		t.Errorf("unexpected expansion: %q", got)
	}
	if strings.Contains(got, "{") {
		t.Errorf("placeholder left unexpanded: %q", got)
	}
}
