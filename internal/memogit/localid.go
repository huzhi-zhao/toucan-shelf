package memogit

import (
	"fmt"
	"regexp"
	"strings"
)

// Local document identity marker.
//
// Every exported file carries the uid of the memo it came from, so `mv`/rename
// in the work tree stays a *move* on the server (UpdateMemo folder_path/title)
// instead of degrading into archive-the-old + create-a-new-one, which would
// strand the document's version history, comments, reactions, shares and
// inbound links on the archived original.
//
// The marker is strictly local: FileContent injects it on the way out, and
// every read of a work-tree file strips it before hashing or pushing, so the
// server's content never contains it. That keeps the sidecar model's promise
// (§5.2 of the plan: the file body is the user's document, nothing else) while
// still giving the file a durable identity that survives being moved by a hand,
// an editor, or an agent that has never heard of memogit.
//
// Two encodings, because a document's bytes are not always markdown:
//
//   - MARKDOWN / HTML / PDF stub: a trailing HTML comment line. It must be at
//     the END of the file — the FIRST thing in a document is reserved for the
//     user's own Obsidian frontmatter, and anything above it would stop that
//     block from parsing.
//   - VIEW (.view.json): a top-level JSON key, so the file stays valid JSON for
//     agents and linters. Unknown top-level keys are ignored by the gallery
//     parser, and the key never reaches the server anyway.
const localIDKey = "memogit-id"

// localIDComment is the marker line used for text documents.
func localIDComment(uid string) string {
	return fmt.Sprintf("<!-- %s: memos/%s -->", localIDKey, uid)
}

// localIDJSON is the marker entry used for JSON (VIEW) documents, including the
// leading newline and trailing comma so stripping it restores the exact
// original bytes.
func localIDJSON(uid string) string {
	return fmt.Sprintf("\n  %q: %q,", localIDKey, "memos/"+uid)
}

var (
	// commentRe matches a whole marker comment line (the trailing-newline
	// handling is done by the caller).
	commentRe = regexp.MustCompile(`(?m)^[ \t]*<!--[ \t]*` + localIDKey + `[ \t]*:[ \t]*(?:memos/)?([^\s>]*)[ \t]*-->[ \t]*$`)
	// jsonRe matches the marker JSON entry together with the newline that
	// precedes it, so removing it is the exact inverse of localIDJSON.
	jsonRe = regexp.MustCompile(`\n[ \t]*"` + localIDKey + `"[ \t]*:[ \t]*"(?:memos/)?([^"]*)"[ \t]*,`)
)

// ParseLocalID returns the memo uid recorded in a work-tree file's marker, or
// "" when the file carries none (an older checkout, or a marker a human or an
// agent removed). Callers must treat "" as "identity unknown", not as an error:
// push falls back to the path index, which is exactly the pre-marker behaviour.
func ParseLocalID(content string) string {
	if m := commentRe.FindStringSubmatch(content); m != nil {
		return strings.TrimSpace(m[1])
	}
	if m := jsonRe.FindStringSubmatch(content); m != nil {
		return strings.TrimSpace(m[1])
	}
	return ""
}

// StripLocalID removes the identity marker (either encoding, wherever it sits)
// and normalizes trailing newlines. This is the inverse of the injection done
// by FileContent, and every path that hashes or uploads a work-tree file must
// go through it — otherwise the marker would read as a local edit and provoke
// a phantom conflict on the very next sync.
func StripLocalID(content string) string {
	content = jsonRe.ReplaceAllString(content, "")
	content = commentRe.ReplaceAllString(content, "")
	return strings.TrimRight(content, "\n")
}

// InjectLocalID returns the file bytes for a document body, carrying the uid.
// An existing marker is replaced rather than duplicated, so re-exporting a file
// is idempotent. Returns content unchanged when uid is empty (a document that
// does not exist on the server yet).
func InjectLocalID(content, uid, docType string) string {
	if uid == "" {
		return content
	}
	body := StripLocalID(content)
	if docType == "VIEW" || docType == "BLOGVIEW" {
		return injectJSONLocalID(body, uid)
	}
	return body + "\n\n" + localIDComment(uid)
}

// injectJSONLocalID inserts the marker as the first key of a VIEW/BLOGVIEW
// document's config object. Such a body is an optional `---` frontmatter block followed by
// the config JSON, so the insertion point is the first `{` after any such block.
// When no object is found the content is returned untouched: a malformed view is
// the user's to fix, and silently rewriting it would make things worse. Such a
// file simply falls back to path-based tracking.
func injectJSONLocalID(body, uid string) string {
	start := jsonBodyStart(body)
	brace := strings.Index(body[start:], "{")
	if brace < 0 {
		return body
	}
	at := start + brace + 1
	return body[:at] + localIDJSON(uid) + body[at:]
}

// jsonBodyStart returns the offset where a VIEW document's JSON begins, skipping
// a leading `---` frontmatter block if the document opens with one.
func jsonBodyStart(body string) int {
	if !strings.HasPrefix(body, "---\n") {
		return 0
	}
	end := strings.Index(body[4:], "\n---")
	if end < 0 {
		return 0
	}
	rest := 4 + end + len("\n---")
	if nl := strings.Index(body[rest:], "\n"); nl >= 0 {
		return rest + nl + 1
	}
	return len(body)
}
