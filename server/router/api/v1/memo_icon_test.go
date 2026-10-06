package v1

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNormalizeMemoIcon(t *testing.T) {
	accepted := map[string]string{
		"":           "",
		"  ":         "",
		"🏆":          "🏆",
		" 🏆 ":        "🏆",
		"❤️":         "❤️",
		"1️⃣":        "1️⃣",
		"🇨🇦":         "🇨🇦",
		"👨‍👩‍👧‍👦":    "👨‍👩‍👧‍👦",
		"👩🏽‍❤️‍💋‍👨🏿": "👩🏽‍❤️‍💋‍👨🏿",
		"🏴󠁧󠁢󠁳󠁣󠁴󠁿":    "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
	}
	for input, want := range accepted {
		got, err := normalizeMemoIcon(input)
		require.NoError(t, err, "input %q", input)
		assert.Equal(t, want, got, "input %q", input)
	}

	for _, input := range []string{"a", "温", "🏆 温尼伯", "🏆\n🏆", "🏆🏆🏆🏆🏆🏆🏆🏆🏆🏆🏆🏆🏆🏆🏆🏆🏆", "\x01", "\xff", string(make([]byte, 65))} {
		_, err := normalizeMemoIcon(input)
		assert.Error(t, err, "input %q", input)
	}
}
