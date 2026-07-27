package v1

import "testing"

// The Home document lives in a reserved folder that GetWorkspaceTree hides, so
// the Home page's own configuration never shows up as a document in the
// notebook tree.
func TestIsHomeFolder(t *testing.T) {
	for _, tc := range []struct {
		path string
		want bool
	}{
		{".home", true},
		{"/.home/", true},
		{" .home ", true},
		{"", false},
		{"home", false},
		{".home/sub", false},
		{"notes/.home", false},
	} {
		if got := isHomeFolder(tc.path); got != tc.want {
			t.Errorf("isHomeFolder(%q) = %v, want %v", tc.path, got, tc.want)
		}
	}
}
