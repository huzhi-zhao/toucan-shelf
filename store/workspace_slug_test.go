package store

import "testing"

func TestBuildStorageSlugBase(t *testing.T) {
	tests := []struct {
		name  string
		title string
		want  string
	}{
		{"ascii", "AI Notes", "AINotes"},
		{"chinese", "AI 知识库", "AI知识库"},
		{"digits kept", "2026 归档 v2", "2026归档v2"},
		{"punctuation and emoji dropped", "读书笔记 · 2026 📚 (草稿)", "读书笔记2026草稿"},
		{"nothing usable", "···/// ", ""},
		{"empty", "", ""},
		{"truncated to cap", repeatRune('a', maxStorageSlugRunes+10), repeatRune('a', maxStorageSlugRunes)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := BuildStorageSlugBase(tt.title); got != tt.want {
				t.Errorf("BuildStorageSlugBase(%q) = %q, want %q", tt.title, got, tt.want)
			}
		})
	}
}

func repeatRune(r rune, n int) string {
	out := make([]rune, n)
	for i := range out {
		out[i] = r
	}
	return string(out)
}
