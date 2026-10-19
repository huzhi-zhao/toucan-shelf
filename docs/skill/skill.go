// Package skill embeds the agent-facing manual in this directory — SKILL.md,
// references/*.md and bootstrap.md — so Go code can ship it without keeping a
// copy. This directory is the only place the manual lives; edit the Markdown
// here and every binary that embeds it picks the change up on its next build.
package skill

import "embed"

// FS holds the manual, rooted at this directory: "SKILL.md",
// "references/memogit.md", "bootstrap.md" and so on.
//
//go:embed *.md references
var FS embed.FS
