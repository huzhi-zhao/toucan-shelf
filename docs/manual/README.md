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
| 4 | [Markdown Editor Optimization ](04-md-editor-optimization.md) | Notion / Obsidian–style formatting shortcuts in the CodeMirror editor: bold, italic, code, links, lists, headings, and what's intentionally deferred. |
| 5 | [memogit CLI](./05-memogit-cli.md) | Checking a knowledge base out to local files with the `memogit` command-line tool: install, `login` / `clone` / `pull` / `push` / `status`, the workspace/folder-path/doc-type file layout, one-way attachment download, IDE-mergeable conflict resolution, config & state, and troubleshooting. |

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
