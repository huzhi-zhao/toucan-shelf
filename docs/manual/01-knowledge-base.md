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

### Document properties (frontmatter)

A Markdown document may open with a YAML **frontmatter** block — a `---` fenced
section at the very top — whose keys render as a properties panel above
the body (`web/src/components/MemoContent/PropertiesPanel.tsx`). Most keys are
free-form and shown as-is.

Properties describe **what the document is about** — its date, status, category,
tags. They deliberately do not control how the app renders the document; that is
[document settings](#document-settings), stored outside the content.

Booleans accept a real YAML boolean (`reviewed: false`) or the string forms
`"true"` / `"false"`. An absent key means "unset" — the default behavior applies.

<a id="document-settings"></a>
### Document settings

How a document is *framed* — body width, outline, folder tree, properties panel —
is per-document configuration, set from the document's **⋮ → Document settings**
menu and stored on the document record rather than in its text:

| Setting | Default | Effect |
| ------- | ------- | ------ |
| Full width | on | Off caps the body at a comfortable reading measure instead of filling the pane. |
| Show outline | on | Off opens the document with the outline panel collapsed. The toolbar toggle still overrides it for the current session. |
| Show document tree | on | Off collapses the left secondary sidebar while this document is open — a clean reading view suited to a landing / homepage document. Switching to another document restores the tree, and the sidebar toggle still overrides it. |
| Show properties | on | Off hides the properties panel above the body. The frontmatter is still stored, and still feeds gallery views, sorting and search. |

Because these live outside the content, changing one does **not** create a new
revision, bump the document's update time, produce a memogit diff, or re-index
the document for search.

They are also not the same thing as **Compact reading** in *Settings →
Preferences*, which is a per-reader, per-device choice about line spacing and
applies to every document you open.

#### Reserved single-select keys

Two keys are **reserved** for single-select values drawn from a system-defined
option list (`web/src/utils/frontmatter.ts`, `SELECT_PROPERTY_OPTIONS`):

| Property   | Options                        |
| ---------- | ------------------------------ |
| `status`   | `created`, `in-process`, `done` |
| `priority` | `p0`, `p1`, `p2`, `p3`          |

A reserved key holding one of its options renders as a coloured chip and edits
through a dropdown. Holding anything else it stays ordinary text — your own
wording is never rejected, it just doesn't get the chip.

#### Editing properties from the preview

Markdown and View documents show an **edit toggle** at the end of the property
rows in the Notebook preview. Switching it on replaces each value with a control
matched to its type — dropdown for the reserved selects, switch for booleans, date
picker for dates, tag box for lists, text field for everything else (numbers and
off-list select values included). Each change rewrites only that one frontmatter
line and saves the document; the rest of the block (key order, comments, keys the
parser doesn't understand) is left untouched. Archived documents are read-only.

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

## 1.2a Linking between documents

Three Markdown forms are **three separate mechanisms** here, and mixing them up
is the most common source of "why doesn't my link work":

| You write | You get |
| --- | --- |
| `[label](path)` | a **document link** — click to navigate |
| `![[path]]` | a **document embed** — the target's body is pulled into this document's flow |
| `![alt](path)` | **media** (image / video / audio), dispatched by file extension |

`![]()` is media only. It is not, and will not become, a way to reference a
document: the link index and the automatic link repair don't traverse image
nodes at all, so a document reference written that way is invisible to both.

### The four path forms

Say the document you are writing lives in knowledge base "技术笔记" at
`/fa/da.md`:

| Form | Example | When to use it |
| --- | --- | --- |
| **Workspace-root-relative** | `[API notes](/fa/db.md)` | The canonical form for links inside one knowledge base. Its value depends only on where the target is, never on where the link lives — that is what lets automatic repair fix every reference in one pass. |
| **Document-relative** | explicit `./db.md`, `../fb/dc.md`; bare `db.md`, `sub/dd.md` | Resolved against the **linking document's folder**. Supported so links are quick to type and so documents imported from Obsidian and friends keep working. |
| **Workspace-qualified** | `[Spec](@产品手册/fb/dc.md)` | Crossing knowledge bases: `@` + the knowledge base's title + a root-relative path inside it. |
| **UID** | `[Spec](/memos/abc123)` | The stable but unreadable form. It is what **Copy link** pastes, and what the system falls back to when no path can express the target. |

`/fa/db.md` is deliberately *not* called an "absolute path": in this codebase
`absolute` already means `/memos/{uid}`, and this form is only absolute *within
one knowledge base*.

**Spaces in a path must be percent-encoded.** A bare Markdown destination ends
at the first space, so `[x](/Notes/Long Report)` isn't parsed as a link at all —
the destination becomes `/Notes/Long` and `Report)` leaks into the visible text.
Write `[x](/Notes/Long%20Report)`. Links the app generates already do this, and
only the characters that actually break the parse are encoded — a Chinese folder
name stays readable as `/设计/接口`, not as percent-escapes.

### Which form works with which syntax

| Form | `[]()` | `![[]]` |
| --- | --- | --- |
| Workspace-root-relative | ✅ | ✅ |
| Document-relative | ✅ | ✅ |
| Workspace-qualified (`@…`) | ✅ | ❌ **not supported** |
| Document-relative *across* workspaces (`@产品手册/fb/../fc/dd.md`) | ❌ | ❌ |
| UID | ✅ | ✅ |

**Cross-workspace embedding is a deliberate non-goal**, not a missing feature.
An embed splices the target's body into the host document; the moment that host
is shared or published, another knowledge base's content goes out with it. That
needs its own visibility rules before it can exist.

**`..` is not allowed in a cross-workspace path** either — when you link across
knowledge bases you aren't standing in the target's directory, so `..` has no
intuitive meaning. The path after `@库标题/` is always root-relative.

### Explicit vs. bare relative paths

`[x](example.com/page)` (a site link with the scheme left off) and a bare
relative path `[x](db.md)` are indistinguishable as text, so they differ only in
what happens when the path resolves to nothing:

- **Explicit** (`./…`, `../…`) states the intent "this is a document". Fails to
  resolve → shown as a **broken link**.
- **Bare** (`db.md`) is tried as a document first, and if nothing matches it
  falls back to **external-link** behaviour (opens in a new tab), with no broken
  styling.

So write `./db.md` when you want a wrong path to be flagged loudly.

### Relative paths are stored as written — with one exception

What you type is what's stored; nothing is normalized on save, and reopening the
document shows the same string back. The **one** automatic rewrite happens when
the linking document itself is moved (or its folder is moved or renamed): its
relative outbound links are resolved against the **old** location and frozen
into workspace-root-relative form. The relative meaning becomes absolute at that
moment — lossy, but at a predictable time with a predictable result, which beats
silently becoming a dead link.

Renaming a knowledge base likewise rewrites the `@库标题` segment of every
workspace-qualified path pointing at it.

### Attachments don't use any of this

Attachment hrefs are uid-addressed (`/file/attachments/{uid}/…`). They have no
path component, so they work across knowledge bases on their own — never write
`@库/diagram.png`. Access is still checked against the workspace the attachment's
own document lives in, so a reader without access to that knowledge base sees a
broken image even when the document embedding it is one they can read.

### Knowledge-base titles have two rules

Because a cross-workspace path is `@` + title + `/` + path, a title may not
contain `/` and may not start with `@`. Both are rejected when you create or
rename a knowledge base. A title containing `/` was already broken for the
`/{workspaceTitle}/{docId}` URL, so this closes an older hole too.

Titles are matched **case-insensitively**, the same way the URL is:
`@career/…` finds the knowledge base titled "Career".

### Three link states

| State | How it looks |
| --- | --- |
| Target knowledge base readable, path resolves | a normal link; following a cross-workspace one switches knowledge base context |
| Target knowledge base not available | an inert restricted marker showing only the anchor text — never the target's title, path, or whether it exists |
| Target knowledge base readable, path resolves to nothing | the broken-link style |

**"Not available" deliberately covers two different situations**: the knowledge
base doesn't exist, and you have no access to it. They are indistinguishable on
purpose — if they weren't, anyone could enumerate which knowledge bases exist on
the instance just by trying titles. It is the same reason opening a knowledge
base you were never granted says "not found" rather than "no permission".

The practical consequence: a **mistyped knowledge-base name also shows the
restricted marker**, not a broken link. If a cross-workspace link comes up
restricted and you expected it to work, check the spelling of the title before
assuming it's a permissions problem. Within a knowledge base you can reach, a
wrong *path* still shows the ordinary broken-link style.

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
