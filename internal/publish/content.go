package publish

import "strings"

// SecretBlockLanguage is the info string of the fenced block that references an
// encrypted record. Its body holds only an id, never the ciphertext — see
// docs/dev/requirements/editor/secret-block.md.
const SecretBlockLanguage = "toucan-secret"

// StripSecretBlocks removes every `toucan-secret` fenced block from content and
// reports how many it removed.
//
// The snapshot must not contain the block at all — not a hidden one, not an
// empty placeholder. The body only carries a pointer, but leaving the pointer in
// hands an anonymous page the id it needs to ask for the ciphertext and KDF
// parameters, which is why SecretBlockService must also refuse anonymous callers.
// Stripping the block is only half of that pair.
//
// The scan is line-based rather than an AST round-trip on purpose: re-rendering
// the document through the markdown renderer would reformat parts of the body
// the author never touched, and the snapshot should differ from the source only
// where the pipeline meant it to.
func StripSecretBlocks(content string) (string, int) {
	lines := strings.Split(content, "\n")
	out := make([]string, 0, len(lines))
	removed := 0

	var (
		inFence     bool
		fenceMarker byte
		fenceLen    int
		dropping    bool
	)
	for _, line := range lines {
		marker, length, info, isFence := parseFenceLine(line)
		switch {
		case !inFence && isFence:
			inFence, fenceMarker, fenceLen = true, marker, length
			dropping = strings.EqualFold(firstWord(info), SecretBlockLanguage)
			if dropping {
				removed++
				continue
			}
		case inFence && isFence && marker == fenceMarker && length >= fenceLen && info == "":
			// A closing fence must be at least as long as the opening one and
			// carry no info string.
			inFence, fenceMarker, fenceLen = false, 0, 0
			if dropping {
				dropping = false
				continue
			}
		case inFence && dropping:
			continue
		}
		out = append(out, line)
	}

	return strings.Join(out, "\n"), removed
}

// parseFenceLine reports whether line opens or closes a fenced code block, and
// returns the fence character, its run length and the info string.
func parseFenceLine(line string) (marker byte, length int, info string, ok bool) {
	trimmed := strings.TrimLeft(line, " ")
	if len(trimmed) < 3 {
		return 0, 0, "", false
	}
	marker = trimmed[0]
	if marker != '`' && marker != '~' {
		return 0, 0, "", false
	}
	for length < len(trimmed) && trimmed[length] == marker {
		length++
	}
	if length < 3 {
		return 0, 0, "", false
	}
	info = strings.TrimSpace(trimmed[length:])
	// A backtick fence's info string may not itself contain a backtick.
	if marker == '`' && strings.Contains(info, "`") {
		return 0, 0, "", false
	}
	return marker, length, info, true
}

// firstWord returns the leading token of a fence info string, which is the
// language.
func firstWord(info string) string {
	if i := strings.IndexAny(info, " \t"); i >= 0 {
		return info[:i]
	}
	return info
}
