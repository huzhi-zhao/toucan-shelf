package s3

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestEncodeCopySource(t *testing.T) {
	tests := []struct {
		name         string
		sourceBucket string
		sourceKey    string
		want         string
	}{
		{
			name:         "plain key keeps its separators",
			sourceBucket: "memos",
			sourceKey:    "assets/kb/1755847231_9f3a_diagram.png",
			want:         "memos/assets/kb/1755847231_9f3a_diagram.png",
		},
		{
			name:         "spaces are escaped, separators are not",
			sourceBucket: "memos",
			sourceKey:    "assets/my notes/a b.png",
			want:         "memos/assets/my%20notes/a%20b.png",
		},
		{
			name:         "non-ascii filenames are escaped",
			sourceBucket: "memos",
			sourceKey:    "assets/kb/图片.png",
			want:         "memos/assets/kb/%E5%9B%BE%E7%89%87.png",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.Equal(t, tt.want, encodeCopySource(tt.sourceBucket, tt.sourceKey))
		})
	}
}
