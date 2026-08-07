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

func TestIsRootRelativeDocHref(t *testing.T) {
	tests := []struct {
		href string
		want bool
	}{
		{"/doc.md", true},
		{"/notes/doc.md", true},
		{"/设计/规范.md", true},
		{"doc.md", false},       // old relative form: retired, not a doc link
		{"notes/doc.md", false}, // old relative form: retired, not a doc link
		{"../doc.md", false},    // old relative form: retired, not a doc link
		{"", false},
		{"#section", false},
		{"/memos/abc", false}, // compat uid form, not root-relative
		{"https://example.com/x", false},
		{"mailto:a@b.com", false},
	}
	for _, tt := range tests {
		if got := IsRootRelativeDocHref(tt.href); got != tt.want {
			t.Errorf("IsRootRelativeDocHref(%q) = %v, want %v", tt.href, got, tt.want)
		}
	}
}

func TestResolveRootRelativePath(t *testing.T) {
	tree := buildTestTree()

	t.Run("resolves a root-level document", func(t *testing.T) {
		uid, ok := ResolveRootRelativePath(tree, "/Alpha")
		if !ok || uid != "a1" {
			t.Fatalf("got (%q, %v), want (a1, true)", uid, ok)
		}
	})

	t.Run("resolves a nested document", func(t *testing.T) {
		uid, ok := ResolveRootRelativePath(tree, "/notes/2026/Gamma")
		if !ok || uid != "c1" {
			t.Fatalf("got (%q, %v), want (c1, true)", uid, ok)
		}
	})

	t.Run("title match is case-insensitive and extension-agnostic", func(t *testing.T) {
		uid, ok := ResolveRootRelativePath(tree, "/ALPHA.MD")
		if !ok || uid != "a1" {
			t.Fatalf("got (%q, %v), want (a1, true)", uid, ok)
		}
	})

	t.Run("duplicate titles in different folders resolve unambiguously by folder", func(t *testing.T) {
		uid, ok := ResolveRootRelativePath(tree, "/notes/Beta")
		if !ok || uid != "b1" {
			t.Fatalf("got (%q, %v), want (b1, true)", uid, ok)
		}
		uid, ok = ResolveRootRelativePath(tree, "/archive/Beta")
		if !ok || uid != "b2" {
			t.Fatalf("got (%q, %v), want (b2, true)", uid, ok)
		}
	})

	t.Run("no tree-wide title fallback: wrong folder does not resolve", func(t *testing.T) {
		_, ok := ResolveRootRelativePath(tree, "/wrong-folder/Alpha")
		if ok {
			t.Fatalf("expected no match")
		}
	})

	t.Run("no relative-navigation support: .. is a literal folder segment, not resolved", func(t *testing.T) {
		_, ok := ResolveRootRelativePath(tree, "/notes/2026/../Beta")
		if ok {
			t.Fatalf("expected no match, since '..' is treated literally, not as navigation")
		}
	})

	t.Run("no match returns false", func(t *testing.T) {
		_, ok := ResolveRootRelativePath(tree, "/nonexistent")
		if ok {
			t.Fatalf("expected no match")
		}
	})

	t.Run("empty href returns false", func(t *testing.T) {
		_, ok := ResolveRootRelativePath(tree, "")
		if ok {
			t.Fatalf("expected no match")
		}
	})
}

func TestCanonicalHref(t *testing.T) {
	tests := []struct {
		folderPath string
		title      string
		want       string
	}{
		{"", "Alpha", "/Alpha"},
		{"notes/2026", "Gamma", "/notes/2026/Gamma"},
		// Percent-encoded, not "<...>"-wrapped: a bare destination stops at the
		// first space, so the space and the parens must not survive literally.
		{"my notes", "plan (v2)", "/my%20notes/plan%20%28v2%29"},
		// Non-ASCII is left readable — it never breaks the parse.
		{"设计", "接口 说明", "/设计/接口%20说明"},
	}
	for _, tt := range tests {
		if got := CanonicalHref(tt.folderPath, tt.title); got != tt.want {
			t.Errorf("CanonicalHref(%q, %q) = %q, want %q", tt.folderPath, tt.title, got, tt.want)
		}
	}
}

func TestRewritePathPrefix(t *testing.T) {
	tests := []struct {
		name          string
		href          string
		oldFolderPath string
		newFolderPath string
		want          string
		wantOK        bool
	}{
		{"exact folder replaced", "/设计/api", "设计", "规范", "/规范/api", true},
		{"nested doc replaced", "/设计/sub/api", "设计", "规范", "/规范/sub/api", true},
		{"unrelated path untouched", "/other/api", "设计", "规范", "", false},
		{"sibling folder with shared prefix not matched", "/设计2/api", "设计", "规范", "", false},
		{"root folder move", "/old/api", "old", "", "/api", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := RewritePathPrefix(tt.href, tt.oldFolderPath, tt.newFolderPath)
			if ok != tt.wantOK {
				t.Fatalf("RewritePathPrefix(%q, %q, %q) ok = %v, want %v", tt.href, tt.oldFolderPath, tt.newFolderPath, ok, tt.wantOK)
			}
			if ok && got != tt.want {
				t.Fatalf("RewritePathPrefix(%q, %q, %q) = %q, want %q", tt.href, tt.oldFolderPath, tt.newFolderPath, got, tt.want)
			}
		})
	}
}
