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
| 1 | [Knowledge Base & Hierarchy](./01-knowledge-base.md) | Workspaces, folder trees, the Notebook home page, the Bookshelf, the reworked Explore page, document outline, and "resume where you left off". |
| 2 | [Rich Documents & Media](./02-rich-documents.md) | The four document types (Markdown / HTML / PDF / View), uploading docs vs. files, the HTML sandbox renderer, the PDF viewer with annotations & text extraction, inline audio/video, and S3 storage + backup. |
| 3 | [Gallery Views](./03-gallery-views.md) | Notion-style `view` documents: creating a gallery, scopes, sorting, cover rules, card fields, and how views stay live. |
| 4 | [Markdown Editor Optimization ](04-md-editor-optimization.md) | Callouts (including **collapsible** and **hover-popover** ones), Notion / Obsidian–style formatting shortcuts in the CodeMirror editor, frontmatter properties, highlights, **click counters**, and AI rewrite. |
| 5 | [memogit CLI](./05-memogit-cli.md) | Checking a knowledge base out to local files with the `memogit` command-line tool: install, `login` / `clone` / `pull` / `push` / `status` / `agents`, the workspace/folder-path/doc-type file layout, one-way attachment download, IDE-mergeable conflict resolution, the guide a checkout hands to AI coding agents, config & state, and troubleshooting. |
| 6 | [View Blocks](./06-view-blocks.md) | The four interactive fenced blocks — `calendar`, `kanban`, `grid`, `sheets`: their syntax, fields, formulas, interactive write-back gestures, and a [complete copy-paste demo](./demo-views.md). Plus the `toucan-secret` block: browser-side encrypted credentials set up inline in the preview, with no recovery and no server-side plaintext. |
| 7 | [HTTP API Reference](./07-api-reference.md) | The JSON/HTTP API for the knowledge-base features: `WorkspaceService`, `RagService` (hybrid search), `AIService` (writing assistants), `SecretBlockService` (encrypted blocks), and the workspace / folder / doc-type / share-link additions to `MemoService`. |
| 8 | [Text Marks & Comments](./08-document-comments.md) | Highlighting / underlining text and attaching comment threads across **Markdown / View documents, PDF, and EPUB**: the shared six-color palette and floating toolbar, bare marks vs. noted comments, text-quote anchoring and graceful degradation, heading anchoring, and the `DocAnchor` / `PdfAnnotation` / `EpubAnnotation` data model. |
| 9 | [EPUB Reader](./09-epub-reader.md) | The in-app `.epub` reader: EPUB as a previewable **attachment** (not a doc type), page-flip vs. continuous-scroll flow, typography and background presets, per-book server-persisted appearance, the table of contents, and in-book marks/comments. |

## For AI coding agents

[`pumpkin_book_for_llms.md`](./pumpkin_book_for_llms.md) is the condensed,
agent-facing version of the nine manuals above (in Chinese): the non-standard
syntax and sync contract an agent must know before editing a checked-out
knowledge base. It is embedded in the `memogit` binary and dropped into every
checkout as `.memogit/toucanshelf-guide.md`, so agents get it without this
repository — see [§5.2a](./05-memogit-cli.md). Edit it here, then re-sync the
embedded copy:

```bash
cp docs/manual/pumpkin_book_for_llms.md internal/memogit/assets/
```

`TestEmbeddedGuideMatchesManual` fails if the two drift apart.

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
