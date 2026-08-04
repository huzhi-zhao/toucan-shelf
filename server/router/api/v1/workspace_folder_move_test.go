package v1

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/store"
)

func TestMovedFolderDestination(t *testing.T) {
	tests := []struct {
		name              string
		path              string
		destinationParent string
		want              string
	}{
		{"into the root", "notes/2026", "", "2026"},
		{"into a folder", "notes/2026", "archive", "archive/2026"},
		{"into a nested folder", "notes/2026", "archive/old", "archive/old/2026"},
		{"top-level folder keeps its name", "notes", "archive", "archive/notes"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.Equal(t, tt.want, movedFolderDestination(tt.path, tt.destinationParent))
		})
	}
}

func TestMovedFolderPath(t *testing.T) {
	tests := []struct {
		name    string
		path    string
		oldRoot string
		newRoot string
		want    string
	}{
		{"the root itself", "notes", "notes", "archive/notes", "archive/notes"},
		{"a descendant", "notes/2026/q1", "notes", "archive/notes", "archive/notes/2026/q1"},
		{"unrelated path is untouched", "notebook", "notes", "archive/notes", "notebook"},
		{"a prefix match that is not a path boundary", "notes-old/x", "notes", "archive", "notes-old/x"},
		{"surrounding slashes are normalized", "/notes/a/", "notes", "archive", "archive/a"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.Equal(t, tt.want, movedFolderPath(tt.path, tt.oldRoot, tt.newRoot))
		})
	}
}

func TestFolderMoveConflicts(t *testing.T) {
	moving := []*store.Memo{
		{FolderPath: "notes", Title: "index"},
		{FolderPath: "notes/2026", Title: "plan"},
		{FolderPath: "notes/2026", Title: "unique"},
	}

	t.Run("reports every colliding title, not just the first", func(t *testing.T) {
		destination := []*store.Memo{
			{FolderPath: "archive/notes", Title: "index"},
			{FolderPath: "archive/notes/2026", Title: "plan"},
		}
		require.Equal(t, []string{"index", "plan"}, folderMoveConflicts(moving, destination, "notes", "archive/notes"))
	})

	t.Run("an empty destination never conflicts", func(t *testing.T) {
		require.Empty(t, folderMoveConflicts(moving, nil, "notes", "archive/notes"))
	})

	t.Run("same title under a different folder is not a conflict", func(t *testing.T) {
		destination := []*store.Memo{{FolderPath: "elsewhere", Title: "index"}}
		require.Empty(t, folderMoveConflicts(moving, destination, "notes", "archive/notes"))
	})

	t.Run("destination paths are compared after normalization", func(t *testing.T) {
		destination := []*store.Memo{{FolderPath: "/archive/notes/", Title: "index"}}
		require.Equal(t, []string{"index"}, folderMoveConflicts(moving, destination, "notes", "archive/notes"))
	})
}
