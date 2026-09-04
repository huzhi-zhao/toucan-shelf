# User Manual

Operation manuals for the knowledge-base features this project adds on top of
[usememos/memos](https://github.com/usememos/memos). Upstream Memos is a
timeline-first, single-note capture tool; this fork keeps everything Memos does
and layers a **hierarchical, Yuque-like knowledge base** and **Notion-style
views** on top of it.

If you are new here, read the manuals in order — each builds on the previous
one.

| # | Manual | What it covers |
|---|--------|----------------|
| 1 | [Knowledge Base & Hierarchy](./01-knowledge-base.md) | Workspaces, folder trees, the Notebook home page, **linking between documents** (the four path forms, `[]()` vs `![[]]`, what happens to relative links when a document moves), the Bookshelf, the reworked Explore page, document outline, and "resume where you left off". |
| 2 | [Rich Documents & Media](./02-rich-documents.md) | The four document types (Markdown / HTML / PDF / View), uploading docs vs. files, the HTML sandbox renderer, the PDF viewer with annotations & text extraction, inline audio/video, and S3 storage + backup. |
| 3 | [Gallery Views](./03-gallery-views.md) | Notion-style `view` documents: creating a gallery, scopes, sorting, cover rules, card fields, and how views stay live. |
| 4 | [Markdown Editor Optimization ](04-md-editor-optimization.md) | Callouts (including **collapsible**, **hover-popover** and **tag-row** ones), Notion / Obsidian–style formatting shortcuts in the CodeMirror editor, frontmatter properties, highlights, **click counters**, and AI rewrite. |
| 5 | [memogit CLI](./05-memogit-cli.md) | Checking a knowledge base out to local files with the `memogit` command-line tool: install, `login` / `clone` / `pull` / `push` / `status` / `agents`, the workspace/folder-path/doc-type file layout, one-way attachment download, IDE-mergeable conflict resolution, the guide a checkout hands to AI coding agents, config & state, and troubleshooting. |
| 6 | [View Blocks](./06-view-blocks.md) | The four interactive fenced blocks — `calendar`, `kanban`, `grid`, `sheets`: their syntax, fields, formulas, interactive write-back gestures, and a [complete copy-paste demo](./demo-views.md). Plus the `toucan-secret` block: browser-side encrypted credentials set up inline in the preview, with no recovery and no server-side plaintext. |
| 7 | [HTTP API Reference](./07-api-reference.md) | The JSON/HTTP API for the knowledge-base features: `WorkspaceService`, `RagService` (hybrid search), `AIService` (writing assistants), `SecretBlockService` (encrypted blocks), and the workspace / folder / doc-type / share-link additions to `MemoService`. |
| 8 | [Text Marks & Comments](./08-document-comments.md) | Highlighting / underlining text and attaching comment threads across **Markdown / View documents, PDF, and EPUB**: the shared six-color palette and floating toolbar, bare marks vs. noted comments, text-quote anchoring and graceful degradation, heading anchoring, and the `DocAnchor` / `PdfAnnotation` / `EpubAnnotation` data model. |
| 9 | [EPUB Reader](./09-epub-reader.md) | The in-app `.epub` reader: EPUB as a previewable **attachment** (not a doc type), page-flip vs. continuous-scroll flow, typography and background presets, per-book server-persisted appearance, the table of contents, and in-book marks/comments. |
| 10 | [MCP Agent Access](./10-mcp-agent-access.md) | Letting Claude Code read and write the knowledge base **over HTTP with nothing on disk**: PAT setup and registration, the curated knowledge-base tool set, addressing documents by workspace / folder path / title, prompts that actually work, the permission allowlist, automatic human-baseline snapshots — and the one rule you must follow yourself (don't edit in the web UI while an agent writes). |
| 11 | [Backup & Object Storage](./11-backup-and-storage.md) | Backing the SQLite database up to S3-compatible storage: **why a backup file is equivalent to your account** (it carries PATs and SSO secrets in plaintext and cannot be sanitized), the two mandatory hardening steps (private bucket, single-bucket-scoped access key with a copy-paste IAM policy), credentials via environment variables for local single-machine deploys, path templates, and the single-instance rule. |

## For AI coding agents

An agent can reach the knowledge base through **two channels**, and they are
documented separately because their failure modes differ:

- **Files** — a [memogit](./05-memogit-cli.md) checkout. Best for bulk edits,
  `grep`, and cross-referencing.
- **HTTP** — the [MCP server](./10-mcp-agent-access.md). Best for reaching into
  the knowledge base from a *different* project, with nothing written to disk and
  no interference with that project's git.

[`docs/skill/`](../skill/) is the condensed, agent-facing version of the manuals
above (in Chinese): the non-standard syntax and sync contract an agent must know
before touching a knowledge base. `SKILL.md` is a router — the rules that apply
to every edit — and `references/` holds one file per topic (hierarchy & doc
types, custom Markdown syntax, view blocks & gallery views, attachments,
memogit, MCP), read on demand rather than up front. **This is where agent-facing
documentation goes from now on.**

`docs/skill/` covers both channels. `memogit` embeds it verbatim
(`internal/memogit/assets/skill/`, a generated mirror kept in sync by
`scripts/sync-agent-skill-docs.sh` — building with `scripts/build-memogit.sh`
runs that automatically; `go test ./internal/memogit/...` also fails loudly if
the two have drifted) and drops it into every checkout as `.memogit/skill/`,
see [§5.2a](./05-memogit-cli.md). Agents on the MCP
channel never see a file tree, so they are additionally briefed by the
server's own `initialize` instructions — a hand-written summary of `SKILL.md`,
short enough to stay resident in every session, maintained next to the tool
list in [`server/router/mcp/`](../../server/router/mcp/), see
[§10.4](./10-mcp-agent-access.md). **Editing `docs/skill/SKILL.md` or
`references/*.md` means checking whether that summary needs updating too** —
see the root [`AGENTS.md`](../../AGENTS.md) Change Routing table.

## Core concepts at a glance

- **Workspace (knowledge base)** — the top-level container. Every document
  belongs to exactly one workspace. Think of it as a Yuque knowledge base or an
  Obsidian vault.
- **Folder path** — documents live under a slash-separated path inside a
  workspace (e.g. `garden/notes`). Folders are path prefixes, so moving or
  renaming a folder is a prefix update.
- **Document (memo)** — one record = one document. A document has a `doc_type`:
  `MARKDOWN`, `HTML`, `PDF`, or `VIEW`.
- **View** — a special document whose content is *configuration only*. It
  renders a live gallery of other documents each time it is opened.

## Terminology note

Throughout these manuals, **"knowledge base"**, **"workspace"**, and
**"project"** refer to the same thing. The code and API call it `workspace`;
the product UI calls it a knowledge base. The word "project" survives only
because tools like Obsidian and JetBrains use it for the same idea.
