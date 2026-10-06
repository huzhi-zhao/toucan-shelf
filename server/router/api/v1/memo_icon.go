package v1

import (
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/pkg/errors"
)

// maxMemoIconBytes bounds a document icon. A single emoji grapheme can run long — a kiss
// sequence with two skin tones is 35 bytes — so the cap leaves headroom for one emoji while
// still refusing anything that is plainly text.
const maxMemoIconBytes = 64

// normalizeMemoIcon validates a document icon. Empty clears it back to the doc-type default.
//
// Deciding what counts as an emoji is the picker's job (it accepts a single pictographic
// grapheme); the server only refuses what can never be one, so it does not carry its own copy
// of the Unicode emoji tables. Letters are refused outright — that is what keeps "icon" from
// turning into a second title.
func normalizeMemoIcon(icon string) (string, error) {
	icon = strings.TrimSpace(icon)
	if icon == "" {
		return "", nil
	}
	if len(icon) > maxMemoIconBytes || !utf8.ValidString(icon) {
		return "", errors.New("icon must be a single emoji")
	}
	for _, r := range icon {
		if unicode.IsSpace(r) || unicode.IsControl(r) || unicode.IsLetter(r) {
			return "", errors.New("icon must be a single emoji")
		}
	}
	return icon, nil
}
