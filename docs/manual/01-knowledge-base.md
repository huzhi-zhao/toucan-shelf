# 1. Knowledge Base & Hierarchy

Upstream Memos organizes notes as a single flat timeline — great for quick
capture, weak for building a structured body of knowledge. This fork adds a
**workspace + folder-path** hierarchy so your documents can be organized like a
Yuque knowledge base, while keeping Memos' fast single-record model (one memo =
one document, no heavyweight database wrapper).

- **Concept:** every document belongs to exactly one **workspace** (knowledge
  base) and lives under a slash-separated **folder path** inside it.
- **Where:** the **Notebook** home page (`/`), the **Bookshelf** (`/shelf`), and
  the reworked **Explore** page (`/explore`).
- **Backing API:** `WorkspaceService` (`proto/api/v1/workspace_service.proto`)
  plus new `workspace`, `folder_path`, `title`, and `doc_type` fields on
  `MemoService`.

---

## 1.1 The Notebook home page (`/`)

The home page is a **three-pane document workspace**, not a feed:

```
┌───────────────┬─────────────────────────────────────┬──────────────┐
│  Secondary    │           Main content              │   Outline    │
│  Sidebar      │        (single document view)       │   (Markdown  │
│               │                                     │    only)     │
│  • Workspace  │   Header: title · path · date       │              │
│    selector   │           Preview / Edit · Save     │  • Heading 1 │
│  • Search     │           · outline toggle · ⋮      │    • H2      │
│  • File tree  │                                     │  • Heading 2 │
│  • Calendar   │   Body: rendered document           │              │
│  • Tags       │                                     │              │
│  • Archived ☑ │                                     │              │
└───────────────┴─────────────────────────────────────┴──────────────┘
```

Key behaviors:

- **Preview first.** Opening a document always shows the rendered preview. Use
  the **Preview / Edit** toggle in the header to switch to editing.
- **Filters vs. structure.** The calendar, tags, and search box are *filters*
  over the current workspace. The **file tree is the primary navigator.**
- **Resume where you left off.** The app remembers the last workspace and
  document you had open (stored as the `LAST_OPENED` user setting). Returning to
  `/` reopens them automatically.

### Selecting / managing a workspace

The **workspace selector** sits at the top of the sidebar. Its menu lets you:

- Switch the active knowledge base.
- Create a new workspace.
- Rename the current workspace.
- Jump to the Bookshelf (see §1.3).

### The file tree

The tree (`web/src/components/Notebook/`) shows folders and documents for the
active workspace. Document icons distinguish the type (Markdown / HTML / PDF /
View).

Per-node actions (hover or right-click):

- **Rename** — for both folders and documents.
- **Move** — relocate a document (`Move Document`) or a folder (`Move Folder`)
  to another path. Moving a folder rewrites the path prefix of everything under
  it in a single transaction.
- **Archive** — hide a document from the default view (see §1.4).
- **Delete** — remove a document, or an *empty* folder.

### Creating documents & folders

Use the **`+` button** next to the search box, or the **⋯ menu** on a folder
row (which drops the new item directly inside that folder). Options:

- **New document** — a blank Markdown document.
- **New folder** — including empty folders (tracked in the `workspace_folder`
  table so they persist without any document inside).
- **Upload doc** — import a `.md` or `.html` file as an editable document.
- **Upload file** — import a `.pdf` as a render-only document. See
  [Rich Documents & Media](./02-rich-documents.md).

> **Every document is organized.** Unlike upstream Memos, there is no such thing
> as an unfiled note here. Creating a document always resolves a
> `workspace` + `folder_path`; if an API client omits them, the server falls
> back to the caller's **default** workspace root so older clients keep working.

### Document outline (Markdown only)

For Markdown documents, an **Outline** panel on the right lists the headings
extracted from the document. Click a heading to scroll to it. The header's
**outline toggle** (next to Save) collapses/expands the panel. HTML, PDF, and
View documents have no outline and no toggle.

---

## 1.2 Folder-path model (how hierarchy is stored)

Hierarchy is intentionally lightweight:

- The `memo` table gains `workspace_id`, `folder_path`, `title`, and `doc_type`
  columns.
- **Folders are path prefixes**, not rows to join. `garden/notes/todo.md` is a
  document whose `folder_path` is `garden/notes`.
- Renaming or moving a folder is a **prefix `UPDATE`** across the affected rows.
- Empty folders (with no document yet) are recorded in a small
  `workspace_folder` table so they still appear in the tree.
- Uniqueness is enforced by a DB index on `(workspace_id, folder_path, title)` —
  two documents can't share a name in the same folder.

This gives Yuque-style organizing power without Notion's heavyweight per-page
database, and without upstream Memos' flat namespace.

---

## 1.3 The Bookshelf (`/shelf`)

The Bookshelf displays every knowledge base as a **book on a shelf** — a visual
launcher for your workspaces.

- Each spine shows the workspace title and creation date.
- A dashed **"New workspace"** card creates a knowledge base.
- Clicking a book opens it on the Notebook page (`/`) and records it as your
  last-opened workspace.

This release keeps the Bookshelf deliberately simple: just the shelf and
navigation. Cover colors and other customization are out of scope for now.

---

## 1.4 Archiving

The sidebar has an **Archived** checkbox at the bottom:

- **Unchecked (default):** only active documents are shown.
- **Checked:** only archived documents are shown.

Archiving reuses Memos' existing `row_status` mechanism, so archived documents
stay out of your working tree but are never deleted.

---

## 1.5 The reworked Explore page (`/explore`)

Upstream Memos' original home feed and Explore page were nearly identical (the
only real difference: Explore hides private notes). This fork **merges them**:
the timeline/feed now lives at `/explore`, and its main content is unchanged.

What's enhanced is the Explore **sidebar filters**:

1. **Workspace selector** above the search box — including an **"All
   workspaces"** option to browse across every knowledge base at once.
2. **Visibility multi-select** — filter by any combination of `private`,
   `protected`, and `public`.
3. **Archived checkbox** — same semantics as §1.4.

All three feed into the `ListMemos` filter. `VIEW` documents are excluded from
the Explore feed (they are organizational nodes, not content). See
[Gallery Views](./03-gallery-views.md).

---

## 1.6 Left navigation rail

The three primary destinations, in order:

| Icon | Route | Purpose |
|------|-------|---------|
| 📖 Reading | `/` | **Notebook** — hierarchical folders + single-document preview/edit. |
| 📚 Bookshelf | `/shelf` | Knowledge bases arranged as books. |
| 🗓 Calendar | `/explore` | The merged feed/timeline with enhanced filters. |

Other Memos entry points (Archived, Settings, etc.) remain in place.

---

## 1.7 Quick reference — the workspace API

`WorkspaceService` (`proto/api/v1/workspace_service.proto`):

| RPC | Purpose |
|-----|---------|
| `CreateWorkspace` / `GetWorkspace` / `ListWorkspaces` / `UpdateWorkspace` / `DeleteWorkspace` | Knowledge-base CRUD. |
| `GetWorkspaceTree` | Return the folder + document hierarchy for a workspace. |
| `CreateWorkspaceFolder` | Create a (possibly empty) folder. |
| `RenameWorkspaceFolder` | Rename a folder and move everything under it. |
| `DeleteWorkspaceFolder` | Delete an empty folder. |

`MemoService` documents carry `workspace`, `folder_path`, `title`, and
`doc_type`; `ListMemos` accepts `workspace`, folder-path prefix, and `doc_type`
filters.

> These are stable, generated gRPC + REST endpoints — the same surface the
> [`memogit` CLI](./05-memogit-cli.md) wraps into `clone` / `pull` / `push`
> commands so AI agents can collaborate on a knowledge base from a local folder.
