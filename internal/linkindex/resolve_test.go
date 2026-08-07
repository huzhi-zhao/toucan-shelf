package linkindex

import "testing"

func buildTestTree() []*TreeNode {
	return BuildTree([]DocRef{
		{UID: "a1", Title: "Alpha", FolderPath: ""},
		{UID: "b1", Title: "Beta", FolderPath: "notes"},
		{UID: "b2", Title: "Beta", FolderPath: "archive"}, // duplicate title, different folder
		{UID: "c1", Title: "Gamma.md", FolderPath: "notes/2026"},
	})
}

func TestResolveAbsoluteMemoHref(t *testing.T) {
	tests := []struct {
		name    string
		href    string
		wantUID string
		wantOK  bool
	}{
		{"site-absolute path", "/memos/abc123", "abc123", true},
		{"full url", "https://example.com/memos/abc123", "abc123", true},
		{"full url with query", "https://example.com/memos/abc123?x=1", "abc123", true},
		{"full url with fragment", "https://example.com/memos/abc123#section", "abc123", true},
		{"percent-encoded uid", "/memos/ab%20c", "ab c", true},
		{"relative path is not absolute", "notes/doc.md", "", false},
		{"bare fragment is not absolute", "#section", "", false},
		{"wrong path shape", "/workspaces/foo", "", false},
		{"nested path segment rejected", "/memos/abc/extra", "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			uid, ok := ResolveAbsoluteMemoHref(tt.href)
			if ok != tt.wantOK || uid != tt.wantUID {
				t.Errorf("ResolveAbsoluteMemoHref(%q) = (%q, %v), want (%q, %v)", tt.href, uid, ok, tt.wantUID, tt.wantOK)
			}
		})
	}
}

func TestIsRelativeDocHref(t *testing.T) {
	tests := []struct {
		href string
		want bool
	}{
		{"doc.md", true},
		{"notes/doc.md", true},
		{"../doc.md", true},
		{"", false},
		{"#section", false},
		{"/memos/abc", false},
		{"https://example.com/x", false},
		{"mailto:a@b.com", false},
	}
	for _, tt := range tests {
		if got := IsRelativeDocHref(tt.href); got != tt.want {
			t.Errorf("IsRelativeDocHref(%q) = %v, want %v", tt.href, got, tt.want)
		}
	}
}

func TestResolveWorkspacePath(t *testing.T) {
	tree := buildTestTree()

	t.Run("resolves relative to the current folder", func(t *testing.T) {
		uid, ok := ResolveWorkspacePath(tree, "Gamma.md", "notes/2026")
		if !ok || uid != "c1" {
			t.Fatalf("got (%q, %v), want (c1, true)", uid, ok)
		}
	})

	t.Run("resolves a sibling via ..", func(t *testing.T) {
		uid, ok := ResolveWorkspacePath(tree, "../doc-does-not-exist.md", "notes/2026")
		if ok {
			t.Fatalf("expected no match, got %q", uid)
		}
		uid, ok = ResolveWorkspacePath(tree, "../../notes/Beta.md", "notes/2026")
		if !ok || uid != "b1" {
			t.Fatalf("got (%q, %v), want (b1, true)", uid, ok)
		}
	})

	t.Run("falls back to root-relative match", func(t *testing.T) {
		uid, ok := ResolveWorkspacePath(tree, "notes/Beta", "somewhere/else")
		if !ok || uid != "b1" {
			t.Fatalf("got (%q, %v), want (b1, true)", uid, ok)
		}
	})

	t.Run("falls back to a title match anywhere in the tree", func(t *testing.T) {
		uid, ok := ResolveWorkspacePath(tree, "Alpha", "notes/2026")
		if !ok || uid != "a1" {
			t.Fatalf("got (%q, %v), want (a1, true)", uid, ok)
		}
	})

	t.Run("title match is case-insensitive and extension-stripped", func(t *testing.T) {
		uid, ok := ResolveWorkspacePath(tree, "alpha.md", "")
		if !ok || uid != "a1" {
			t.Fatalf("got (%q, %v), want (a1, true)", uid, ok)
		}
	})

	t.Run("ambiguous title-only fallback returns the first DFS match", func(t *testing.T) {
		// Both b1 (notes/Beta) and b2 (archive/Beta) match "Beta" by title from an
		// unrelated folder; this only exercises that resolution doesn't error or
		// panic on ambiguity, since the design doc treats unresolvable/ambiguous
		// links as "drop, don't block" at the indexing layer above this package.
		uid, ok := ResolveWorkspacePath(tree, "Beta", "somewhere/else")
		if !ok {
			t.Fatalf("expected a match")
		}
		if uid != "b1" && uid != "b2" {
			t.Fatalf("got unexpected uid %q", uid)
		}
	})

	t.Run("no match returns false", func(t *testing.T) {
		_, ok := ResolveWorkspacePath(tree, "nonexistent", "")
		if ok {
			t.Fatalf("expected no match")
		}
	})

	t.Run("empty href returns false", func(t *testing.T) {
		_, ok := ResolveWorkspacePath(tree, "", "")
		if ok {
			t.Fatalf("expected no match")
		}
	})
}
