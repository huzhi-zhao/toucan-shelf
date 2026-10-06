package markdown

import (
	"bytes"
	"sort"
	"strings"

	gast "github.com/yuin/goldmark/ast"
	east "github.com/yuin/goldmark/extension/ast"

	"github.com/usememos/memos/internal/markdown/renderer"
)

// In-place link edits.
//
// The Rewrite* functions change links inside documents the user is not
// editing — a move repairs every document that references the moved one. They
// used to edit the AST and re-render the whole document through
// MarkdownRenderer, which does not round-trip: tables came back as one line of
// run-together cell text and list continuation lines lost their indentation.
// The damage landed in documents nobody had touched.
//
// So the AST is only used to FIND links; the edit is spliced into the original
// bytes and everything outside the link's own brackets and parentheses is left
// exactly as written. A link whose source span cannot be located with
// certainty is left alone rather than guessed at: a stale link is recoverable,
// a corrupted document is not.

// linkSpan is where one link or image sits in the source.
type linkSpan struct {
	start      int // '[' of the label ('!' for an image)
	labelStart int // first byte inside the label brackets
	labelEnd   int // the closing ']' of the label
	// Inline links only: the destination as written, including a "<...>"
	// wrapper when there is one.
	destStart, destEnd int
	// Reference links only: the end of the reference part ("[ref]", "[]", or
	// nothing for a shortcut link).
	refEnd int
}

// spliceEdit replaces source[start:end] with text.
type spliceEdit struct {
	start, end int
	text       string
}

// applySplices applies non-overlapping edits to source.
func applySplices(source []byte, edits []spliceEdit) string {
	sort.Slice(edits, func(i, j int) bool { return edits[i].start < edits[j].start })
	var out bytes.Buffer
	out.Grow(len(source))
	pos := 0
	for _, e := range edits {
		out.Write(source[pos:e.start])
		out.WriteString(e.text)
		pos = e.end
	}
	out.Write(source[pos:])
	return out.String()
}

// locateLink finds the source span of a link or image node. ok is false when
// the bytes at the node's position do not read back as the link the parser
// produced, in which case the caller must not edit it.
func locateLink(source []byte, n gast.Node, destination []byte, reference *gast.ReferenceLink) (linkSpan, bool) {
	start := n.Pos()
	open := start
	if _, isImage := n.(*gast.Image); isImage {
		open++
	}
	if start < 0 || open >= len(source) || source[open] != '[' {
		return linkSpan{}, false
	}
	labelEnd, ok := matchLabel(source, open)
	if !ok {
		return linkSpan{}, false
	}
	span := linkSpan{start: start, labelStart: open + 1, labelEnd: labelEnd}

	if reference != nil {
		switch reference.Type {
		case gast.ReferenceLinkShortcut:
			span.refEnd = labelEnd + 1
		case gast.ReferenceLinkCollapsed:
			if !bytes.HasPrefix(source[labelEnd+1:], []byte("[]")) {
				return linkSpan{}, false
			}
			span.refEnd = labelEnd + 3
		default:
			if labelEnd+1 >= len(source) || source[labelEnd+1] != '[' {
				return linkSpan{}, false
			}
			closeRef := bytes.IndexByte(source[labelEnd+2:], ']')
			if closeRef < 0 {
				return linkSpan{}, false
			}
			span.refEnd = labelEnd + 2 + closeRef + 1
		}
		return span, true
	}

	i := labelEnd + 1
	if i >= len(source) || source[i] != '(' {
		return linkSpan{}, false
	}
	i = skipLinkWhitespace(source, i+1)
	span.destStart = i
	if i < len(source) && source[i] == '<' {
		end := bytes.IndexByte(source[i:], '>')
		if end < 0 || !bytes.Equal(source[i+1:i+end], destination) {
			return linkSpan{}, false
		}
		span.destEnd = i + end + 1
		return span, true
	}
	end := i + len(destination)
	if end > len(source) || !bytes.Equal(source[i:end], destination) {
		return linkSpan{}, false
	}
	span.destEnd = end
	return span, true
}

// matchLabel returns the index of the ']' closing the label opened at open,
// honouring backslash escapes, nested brackets and code spans the way the
// CommonMark link-label rules do.
func matchLabel(source []byte, open int) (int, bool) {
	depth := 0
	for i := open; i < len(source); {
		switch c := source[i]; c {
		case '\\':
			i += 2
			continue
		case '`':
			run := countRun(source, i, '`')
			if closer := findBacktickRun(source, i+run, run); closer >= 0 {
				i = closer + run
			} else {
				i += run
			}
			continue
		case '[':
			depth++
		case ']':
			depth--
			if depth == 0 {
				return i, true
			}
		}
		i++
	}
	return 0, false
}

func countRun(source []byte, i int, c byte) int {
	n := 0
	for i+n < len(source) && source[i+n] == c {
		n++
	}
	return n
}

// findBacktickRun finds the next run of exactly n backticks at or after from.
func findBacktickRun(source []byte, from, n int) int {
	for i := from; i < len(source); {
		if source[i] != '`' {
			i++
			continue
		}
		run := countRun(source, i, '`')
		if run == n {
			return i
		}
		i += run
	}
	return -1
}

// skipLinkWhitespace skips the spaces, tabs and (at most one) line ending
// CommonMark allows between "(" and a link destination.
func skipLinkWhitespace(source []byte, i int) int {
	newline := false
	for i < len(source) {
		switch source[i] {
		case ' ', '\t':
			i++
		case '\n', '\r':
			if newline {
				return i
			}
			newline = true
			i++
		default:
			return i
		}
	}
	return i
}

// inTableCell reports whether n sits inside a GFM table cell, where an
// unescaped "|" in replacement text would split the cell.
func inTableCell(n gast.Node) bool {
	for p := n.Parent(); p != nil; p = p.Parent() {
		if _, ok := p.(*east.TableCell); ok {
			return true
		}
	}
	return false
}

// escapeLabel makes plain text safe to place between a link's brackets.
func escapeLabel(text string, inTable bool) string {
	var b strings.Builder
	for _, r := range text {
		switch r {
		case '\\', '[', ']':
			b.WriteByte('\\')
		case '|':
			if inTable {
				b.WriteByte('\\')
			}
		}
		b.WriteRune(r)
	}
	return b.String()
}

// linkEdits returns the edits that turn the link at span into one with
// newHref and newText. Unchanged parts are not rewritten.
func linkEdits(source []byte, n gast.Node, span linkSpan, oldHref, newHref, oldText, newText string, title []byte, reference *gast.ReferenceLink) []spliceEdit {
	hrefChanged := newHref != oldHref
	textChanged := newText != oldText
	label := string(source[span.labelStart:span.labelEnd])
	if textChanged {
		label = escapeLabel(newText, inTableCell(n))
	}

	if reference != nil {
		if !hrefChanged {
			if !textChanged {
				return nil
			}
			return []spliceEdit{{start: span.labelStart, end: span.labelEnd, text: label}}
		}
		// The definition may be shared with other links that are not being
		// repointed, so this one occurrence becomes an inline link instead of
		// the definition being edited.
		inline := "[" + label + "](" + renderer.EscapeDestination(newHref)
		if _, isImage := n.(*gast.Image); isImage {
			inline = "!" + inline
		}
		if len(title) > 0 {
			inline += ` "` + strings.ReplaceAll(string(title), `"`, `\"`) + `"`
		}
		inline += ")"
		return []spliceEdit{{start: span.start, end: span.refEnd, text: inline}}
	}

	var edits []spliceEdit
	if textChanged {
		edits = append(edits, spliceEdit{start: span.labelStart, end: span.labelEnd, text: label})
	}
	if hrefChanged {
		edits = append(edits, spliceEdit{start: span.destStart, end: span.destEnd, text: renderer.EscapeDestination(newHref)})
	}
	return edits
}
