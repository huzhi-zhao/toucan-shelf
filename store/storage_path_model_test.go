package store

import (
	"testing"

	storepb "github.com/usememos/memos/proto/gen/store"
)

func TestSplitFilepathTemplate(t *testing.T) {
	tests := []struct {
		name             string
		template         string
		wantRootPrefix   string
		wantFilenameTmpl string
	}{
		{
			name:             "current default splits at the workspace placeholder",
			template:         defaultInstanceFilepathTemplate,
			wantRootPrefix:   "assets",
			wantFilenameTmpl: "{timestamp}_{uuid}_{filename}",
		},
		{
			name:             "flat historical layout keeps its whole directory part",
			template:         "assets/{timestamp}_{filename}",
			wantRootPrefix:   "assets",
			wantFilenameTmpl: "{timestamp}_{filename}",
		},
		{
			name:             "nested prefix without a workspace placeholder",
			template:         "toucan/prod/assets/{uuid}_{filename}",
			wantRootPrefix:   "toucan/prod/assets",
			wantFilenameTmpl: "{uuid}_{filename}",
		},
		{
			name:             "bucket root layout yields an empty prefix",
			template:         "{timestamp}_{filename}",
			wantRootPrefix:   "",
			wantFilenameTmpl: "{timestamp}_{filename}",
		},
		{
			name:             "workspace placeholder at the very front yields an empty prefix",
			template:         "{workspace}/{uuid}_{filename}",
			wantRootPrefix:   "",
			wantFilenameTmpl: "{uuid}_{filename}",
		},
		{
			// Directories written after {workspace} survive inside the file name. Ugly but
			// harmless: it only affects how an old config reads back, and the first migration
			// recomputes the keys anyway.
			name:             "directories after the placeholder land in the file name",
			template:         "assets/{workspace}/{year}/{month}/{filename}",
			wantRootPrefix:   "assets",
			wantFilenameTmpl: "{year}/{month}/{filename}",
		},
		{
			name:             "stray slashes are normalized away",
			template:         "/assets/{workspace}/{filename}",
			wantRootPrefix:   "assets",
			wantFilenameTmpl: "{filename}",
		},
		{
			name:             "empty template falls back to the defaults",
			template:         "",
			wantRootPrefix:   defaultInstanceRootPrefix,
			wantFilenameTmpl: defaultInstanceFilenameTemplate,
		},
		{
			name:             "template that is nothing but the placeholder still names a file",
			template:         "assets/{workspace}",
			wantRootPrefix:   "assets",
			wantFilenameTmpl: defaultInstanceFilenameTemplate,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rootPrefix, filenameTemplate := splitFilepathTemplate(tt.template)
			if rootPrefix != tt.wantRootPrefix {
				t.Errorf("root prefix = %q, want %q", rootPrefix, tt.wantRootPrefix)
			}
			if filenameTemplate != tt.wantFilenameTmpl {
				t.Errorf("filename template = %q, want %q", filenameTemplate, tt.wantFilenameTmpl)
			}
		})
	}
}

func TestDecomposeStorageFilepathTemplate(t *testing.T) {
	t.Run("old S3 setting gains both halves", func(t *testing.T) {
		setting := &storepb.InstanceStorageSetting{
			StorageType:      storepb.InstanceStorageSetting_S3,
			FilepathTemplate: defaultInstanceFilepathTemplate,
			S3Config:         &storepb.StorageS3Config{Bucket: "toucan"},
		}
		decomposeStorageFilepathTemplate(setting)
		if got, want := setting.S3Config.RootPrefix, "assets"; got != want {
			t.Errorf("root prefix = %q, want %q", got, want)
		}
		if got, want := setting.FilenameTemplate, "{timestamp}_{uuid}_{filename}"; got != want {
			t.Errorf("filename template = %q, want %q", got, want)
		}
	})

	t.Run("an already-decomposed setting is left alone", func(t *testing.T) {
		// The whole point of using filename_template as the marker: an empty root prefix is a
		// legitimate choice (the bucket root), so a second pass must not overwrite it from the
		// legacy template.
		setting := &storepb.InstanceStorageSetting{
			StorageType:      storepb.InstanceStorageSetting_S3,
			FilepathTemplate: defaultInstanceFilepathTemplate,
			FilenameTemplate: "{uuid}_{filename}",
			S3Config:         &storepb.StorageS3Config{Bucket: "toucan", RootPrefix: ""},
		}
		decomposeStorageFilepathTemplate(setting)
		if setting.S3Config.RootPrefix != "" {
			t.Errorf("root prefix = %q, want it left empty", setting.S3Config.RootPrefix)
		}
		if got, want := setting.FilenameTemplate, "{uuid}_{filename}"; got != want {
			t.Errorf("filename template = %q, want %q", got, want)
		}
	})

	t.Run("no S3 config means only the file name half is filled", func(t *testing.T) {
		setting := &storepb.InstanceStorageSetting{
			StorageType:      storepb.InstanceStorageSetting_LOCAL,
			FilepathTemplate: defaultInstanceFilepathTemplate,
		}
		decomposeStorageFilepathTemplate(setting)
		if got, want := setting.FilenameTemplate, "{timestamp}_{uuid}_{filename}"; got != want {
			t.Errorf("filename template = %q, want %q", got, want)
		}
		if setting.S3Config != nil {
			t.Error("decomposition must not invent an S3 config")
		}
	})
}
