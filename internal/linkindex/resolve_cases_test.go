package linkindex

import (
	"encoding/json"
	"os"
	"testing"
)

// The cases in testdata/resolve_cases.json are shared with the frontend's twin
// resolver (web/tests/document-link-resolve-cases.test.ts reads the same file).
// This pairing is the only thing keeping the two hand-maintained
// implementations from drifting apart, so a case added here must stay readable
// from both sides: no Go-specific or TS-specific fields.
type resolveCaseFile struct {
	Trees map[string][]struct {
		UID        string `json:"uid"`
		Title      string `json:"title"`
		FolderPath string `json:"folderPath"`
	} `json:"trees"`
	Cases []struct {
		Name string  `json:"name"`
		Tree string  `json:"tree"`
		Base string  `json:"base"`
		Href string  `json:"href"`
		Form string  `json:"form"`
		UID  *string `json:"uid"`
		// Workspace-qualified cases only: the title and root-relative path
		// ParseWorkspaceQualifiedHref must split the href into. "tree" then
		// names the *target* workspace's tree, which "uid" is resolved in.
		WorkspaceTitle *string `json:"workspaceTitle"`
		Path           *string `json:"path"`
	} `json:"cases"`
}

func TestSharedResolveCases(t *testing.T) {
	raw, err := os.ReadFile("testdata/resolve_cases.json")
	if err != nil {
		t.Fatalf("read cases: %v", err)
	}
	var file resolveCaseFile
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatalf("parse cases: %v", err)
	}
	if len(file.Cases) == 0 {
		t.Fatal("no cases loaded")
	}

	trees := map[string][]*TreeNode{}
	for name, docs := range file.Trees {
		refs := make([]DocRef, 0, len(docs))
		for _, d := range docs {
			refs = append(refs, DocRef{UID: d.UID, Title: d.Title, FolderPath: d.FolderPath})
		}
		trees[name] = BuildTree(refs)
	}

	for _, c := range file.Cases {
		treeName := c.Tree
		if treeName == "" {
			treeName = "default"
		}
		tree, ok := trees[treeName]
		if !ok {
			t.Fatalf("%s: unknown tree %q", c.Name, treeName)
		}

		t.Run(c.Name, func(t *testing.T) {
			if got := string(ClassifyDocHref(c.Href)); got != c.Form {
				t.Fatalf("ClassifyDocHref(%q) = %q, want %q", c.Href, got, c.Form)
			}

			var gotUID string
			var resolved bool
			switch HrefForm(c.Form) {
			case FormAbsoluteMemo:
				gotUID, resolved = ResolveAbsoluteMemoHref(c.Href)
			case FormRootRelative:
				gotUID, resolved = ResolveRootRelativePath(tree, c.Href)
			case FormRelativeExplicit, FormRelativeBare:
				gotUID, resolved = ResolveRelativePath(tree, c.Base, c.Href)
			case FormWorkspaceQualified:
				title, path, ok := ParseWorkspaceQualifiedHref(c.Href)
				if !ok {
					t.Fatalf("ParseWorkspaceQualifiedHref(%q) failed but the form says it should parse", c.Href)
				}
				if c.WorkspaceTitle == nil || c.Path == nil {
					t.Fatalf("%s: a workspaceQualified case must state workspaceTitle and path", c.Name)
				}
				if title != *c.WorkspaceTitle || path != *c.Path {
					t.Fatalf("ParseWorkspaceQualifiedHref(%q) = %q, %q; want %q, %q", c.Href, title, path, *c.WorkspaceTitle, *c.Path)
				}
				// The path inside the target workspace is an ordinary
				// root-relative path — the same resolver, a different tree.
				gotUID, resolved = ResolveRootRelativePath(tree, path)
			case FormExternal:
				// Nothing to resolve; the classification assertion is the test.
			}

			if c.UID == nil {
				if resolved {
					t.Fatalf("resolved %q to %q, want no match", c.Href, gotUID)
				}
				return
			}
			if !resolved {
				t.Fatalf("%q did not resolve, want %q", c.Href, *c.UID)
			}
			if gotUID != *c.UID {
				t.Fatalf("%q resolved to %q, want %q", c.Href, gotUID, *c.UID)
			}
		})
	}
}

// ResolveRelativeToCanonical has no frontend twin (fossilization is
// backend-only), so it is covered here rather than in the shared cases.
func TestResolveRelativeToCanonical(t *testing.T) {
	resolvable := []struct {
		base string
		href string
		want string
	}{
		{"fa", "./db.md", "/fa/db.md"},
		{"fa", "db.md", "/fa/db.md"},
		{"fa", "../fb/dc.md", "/fb/dc.md"},
		{"fa/sub", "../../Alpha", "/Alpha"},
		{"", "./Alpha", "/Alpha"},
		{"fa", "./sub/../db.md", "/fa/db.md"},
		{"fa", "./db.md#sec", "/fa/db.md#sec"},
		// Escaping only touches what breaks a bare markdown destination: the
		// space is encoded, the Chinese folder name is left readable.
		{"设计", "./Long Report", "/设计/Long%20Report"},
	}
	for _, c := range resolvable {
		got, ok := ResolveRelativeToCanonical(c.base, c.href)
		if !ok || got != c.want {
			t.Errorf("ResolveRelativeToCanonical(%q, %q) = %q, %v; want %q", c.base, c.href, got, ok, c.want)
		}
	}

	// Climbing above the workspace root fails rather than clamping, so a
	// fossilized href can never address anything outside its own workspace.
	for _, c := range [][2]string{{"fa", "../../../fb/dc.md"}, {"", "../fb/dc.md"}} {
		if got, ok := ResolveRelativeToCanonical(c[0], c[1]); ok {
			t.Errorf("ResolveRelativeToCanonical(%q, %q) = %q; want no result", c[0], c[1], got)
		}
	}
}
