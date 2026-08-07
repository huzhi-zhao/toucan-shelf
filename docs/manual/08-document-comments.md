# 8. Text Marks & Comments

**Marks and comments** let you highlight or underline text and attach a
discussion thread to it while you read — in a Notebook **Markdown** or **View**
document, in a **PDF**, or in an **EPUB** book. It is *one* feature with a shared
palette, a shared floating toolbar, and a shared "comment is a child memo"
storage model; the three surfaces differ only in **how a location is pinned to
their content**.

- **Shared palette:** `web/src/utils/markColors.ts`.
- **Shared floating toolbar:** `web/src/components/MarkToolbar.tsx`.
- **Shared overlay + text anchoring (Markdown/View/PDF):**
  `web/src/components/DocComments/DocMarkLayer.tsx`,
  `web/src/components/DocComments/textAnchor.ts`.
- **Markdown/View host:** `web/src/components/Notebook/DocumentView.tsx`,
  panels in `web/src/components/DocComments/`.
- **PDF host:** `web/src/components/PdfViewer/` (`PdfDocumentView.tsx`,
  `PdfPageCanvas.tsx`, `usePdfAnnotations.ts`).
- **EPUB host:** `web/src/components/EpubViewer/` — the reading experience has
  its own manual, [Manual 9 · EPUB Reader](./09-epub-reader.md); this manual
  covers only its marks/comments.

---

## 8.1 The shared model (read this first)

Everything below is true on **all three surfaces**.

### A mark is a comment memo

Every mark and every comment is an ordinary **child comment memo** of the
document (or, for PDF/EPUB, of the memo the file is attached to). They are
created with the same `createMemoComment` call and listed with the same
`listMemoComments` call the comment section already uses — so they also appear
wherever comments appear (e.g. the memo detail page). What makes a comment a
*mark* is an **anchor** stored on its payload (`doc_anchor` / `pdf_annotation` /
`epub_annotation`); see §8.5.

### Two independent things a comment can carry

1. **Styling** — a background **highlight** in one of six colors, and/or an
   **underline**. The two are independent and can stack (a colored underline is
   a highlight *plus* an underline on the same span).
2. **A written note** — Markdown body text.

This gives two kinds of comment:

| | Styling | Note | Shown in the notes panel? |
|---|---------|------|---------------------------|
| **Bare mark** | ✅ | empty | ❌ — it lives only as the colored text |
| **Noted comment** | ✅ (a note always highlights its text too) | ✅ | ✅ |

A **bare mark** is pure styling on the text (like a highlighter swipe). It has
no card in the notes panel — an empty card would be noise — so the *only* way to
recolor or remove it is to **click the mark itself** and use the floating
toolbar (§8.1, toolbar). Writing a note onto a bare mark later is a plain
comment edit; the anchor and color ride along untouched.

Conversely, **writing a note always also highlights its text** (in the default
color) when the selection has anchorable text: commenting on a passage and
highlighting it are one act, not two.

### The palette

Six presets, shared everywhere so a "yellow" made in a book and one made in a
document mean and look the same:

| key | | key | |
|-----|--|-----|--|
| `yellow` *(default)* | 🟡 | `pink` | 🌸 |
| `green` | 🟢 | `red` | 🔴 |
| `blue` | 🔵 | `purple` | 🟣 |

The stored value is the **key**, not the concrete hex (`markColors.ts`), so the
palette can be retuned later without rewriting stored marks. Highlights are
drawn **semi-transparent over** the text (≈0.32 alpha, brighter when selected)
rather than behind it, so the text stays readable and the mark stays clickable.

### The floating mark toolbar

The same toolbar (`MarkToolbar.tsx`) appears in two situations:

- **Finishing a text selection** → create a mark: a **note** button (💬), the
  **six color swatches**, and an **underline** toggle.
- **Clicking an existing mark** → restyle it: the same controls plus an
  **eraser** (clear this mark), with the active color ringed and the underline
  button reflecting its on/off state.

Picking a color always *applies* that color — clicking the active color again is
a no-op, not a toggle-off. Removing styling is the **eraser**'s job. Erasing a
**bare** mark deletes the comment outright; erasing a mark that carries a
**note** keeps the note (the valuable part) and just drops the visual — removed
entirely on Markdown/PDF, reset to the default highlight on EPUB so it stays
locatable in the book.

### Anchoring & graceful degradation

A document's text is edited freely, so a mark can't be pinned by character
offset. Instead every text mark stores a **quote selector** — the exact marked
text plus a bounded window of the text on each side (`textAnchor.ts`,
`CONTEXT_LENGTH = 32`) — and is re-located by **searching the freshly rendered
text** for that quote (the surrounding context disambiguates a phrase that
repeats). Text inserted or deleted *elsewhere* doesn't move the quote relative
to its own neighbours, so the mark survives; only rewriting the marked passage
itself loses it. When that happens the mark **degrades to a coarser fallback**
rather than vanishing:

| Surface | Precise anchor | Fallback when the text is gone |
|---------|----------------|--------------------------------|
| Markdown / View | quote selector | nearest **heading** above it |
| PDF | quote selector (over the text layer) | the **page + rectangle** the selection covered |
| EPUB | **CFI** range (the file never changes) | the stored text **snippet** |

---

## 8.2 Markdown & View documents (Notebook)

Available on the **Notebook document preview** — the home page (`/`) with a
Markdown or View document open, in **Preview** mode. (PDF documents use §8.3;
HTML documents have no marks or comments: `const supportsComments = !isPdf &&
!isHtml`.)

> **Marking is a comments-panel activity.** Marks are always *drawn*, but
> selecting text to mark, and clicking a mark to restyle it, **only work while
> the comment panel is open**. With the panel closed the document is just a
> document. Open the panel first (the 💬 speech-bubble icon in the title bar),
> then mark. The panel shares the right-hand dock with the outline — opening one
> closes the other.

### Making a mark or comment

With the comment panel **open**, in Preview mode:

1. **Select text.** The floating toolbar appears above the selection.
2. Pick a **color** (creates a bare highlight), toggle **underline** (creates a
   bare underline), or click the **note** button to open the comment editor
   anchored to that selection (which also highlights it in the default color).

You can also start a note without selecting: the panel's **+ (new comment)**
button anchors to the nearest heading *above the top of the viewport* — use it
when you don't need to pin a specific passage.

### Restyling / erasing / annotating a mark

Click any existing mark. Its comment is selected (the mark brightens, the panel
scrolls to it) and the toolbar opens over it, where you can recolor it, toggle
its underline, add/edit its note, or erase it.

### Heading anchoring & jumping

Because Markdown documents have a clear heading structure, every mark also
records **which heading it sits under** (`docAnchor.ts`), using the same DOM
`id` slug the [document outline](./01-knowledge-base.md) uses. In the notes
panel each card labels itself with its **marked text** (or its heading, for a
heading-only comment) and shows a color dot. **Clicking a card jumps** the
document to the marked passage, falling back to the heading if the text was
edited away. A comment above the first heading anchors to "top of document".

If a mark's text is later rewritten, its card stays in the panel — flagged
**"Original text changed"** (struck-through label) — rather than disappearing
along with the note it carries.

> **Rule — keep punctuation out of headings so they make valid anchors.** A
> heading's anchor id is a **slugified** copy of its text (`slugify` in
> `web/src/utils/markdown-manipulation.ts`), and slugifying **strips every
> punctuation mark**, keeping only letters, numbers, and spaces-turned-hyphens.
> Two consequences follow, so **prefer punctuation-free heading text**:
>
> - Headings that differ *only* in punctuation collide to the same slug (e.g.
>   `Setup (macOS)` and `Setup / macOS` both become `setup-macos`). The
>   duplicate then gets a positional `-1`/`-2` suffix, so its anchor is fragile —
>   reordering or editing sibling headings renumbers it and the comment jumps to
>   the wrong section.
> - A heading made **entirely** of punctuation (e.g. `?!` or `---`) slugifies to
>   an empty string and is given **no `id` at all**, so it can never be an anchor
>   target — a comment "under" it falls back to the top of the document.

### View documents

A View (gallery) document has no headings of its own, but each block can carry
an **intro** (`description`) and **footer** Markdown snippet, and their headings
are anchorable just like a Markdown document's (heading ids are made globally
unique per block, e.g. `vb<index>-desc-…`). A View's **card walls are excluded
from anchoring** (`data-mark-exclude`) — they are live query results whose text
appears and vanishes as data changes, so a mark must never latch onto a card a
later query drops. Gallery **card titles are not headings** and can't be
anchors.

---

## 8.3 PDF documents

PDF documents (and PDF **attachments** previewed on the standalone reader page)
use their own annotation sidebar, but marking works the same way and shares the
same toolbar and palette.

- **Annotate mode is on by default** (the 💬 toolbar icon starts selected), so
  you can select text and mark immediately — no need to open a panel first
  (this is the one behavioral difference from Markdown). Turn annotate mode off
  when you just want to select text to copy it.
- **Select text on a page** → the floating toolbar appears: pick a color,
  toggle underline, or write a note (which also highlights the passage).
- Marks are painted over the **words themselves**, anchored to the page's text
  layer with the same quote selector as documents. A **scanned PDF has no text
  layer**, so a selection there falls back to a **rectangle** over the region —
  a box, not a colorable text mark.
- **Click a mark** to recolor / underline / annotate / erase it in place.
- The **comments panel** (toolbar panel-toggle) lists noted annotations grouped
  by page; clicking one jumps to that page. It opens automatically on arrival
  when the PDF already has notes.

### PDF everywhere it needs to appear

A PDF document is a link/reference, so it renders differently by context (see
[Manual 2 · §2.3](./02-rich-documents.md)): full viewer in the Notebook and on
the detail page; a jump-to-detail card in the Explore feed.

---

## 8.4 EPUB books

EPUB files are **attachments** (there is no EPUB `doc_type`); opening one on the
standalone reader page gives an e-reader with the same marks/comments. Because
an EPUB file never changes under the reader, marks are pinned by **CFI** rather
than a quote selector, and are drawn by epub.js as an SVG highlight (`fill`) or
underline (`stroke`). Annotate mode is on by default; a separate sidebar lists
noted annotations. See **[Manual 9 · EPUB Reader](./09-epub-reader.md)** for the
full reading experience (flow, fonts, backgrounds, TOC) — its annotation UX is
covered there.

---

## 8.5 Data model

A mark/comment is a child memo whose anchor lives on the memo payload
(`proto/store/memo.proto` → mirrored in `proto/api/v1/memo_service.proto`).
There are three anchor shapes, one per surface:

| Payload field | Surface | Key fields |
|---------------|---------|------------|
| `doc_anchor` (`DocAnchor`) | Markdown / View | `heading_slug`, `heading_text`, `text_exact`/`text_prefix`/`text_suffix`, `color`, `underline` |
| `pdf_annotation` (`PdfAnnotation`) | PDF | `attachment_name`, `page`, `x/y/width/height`, `text_snippet`, `text_exact`/`text_prefix`/`text_suffix`, `color`, `underline` |
| `epub_annotation` (`EpubAnnotation`) | EPUB | `attachment_name`, `cfi_range`, `text_snippet`, `color`, `underline` |

- **`color`** is a palette **key** (e.g. `"yellow"`), not a hex. Empty means "no
  fill" (for `DocAnchor`, "the default").
- **`underline`** draws an underline instead of / in addition to a fill.
- The text-quote fields (`text_exact` + `text_prefix`/`text_suffix`) are the
  precise anchor; the coarse fields (`heading_slug` / rect / `text_snippet`) are
  the fallback.
- Create path: `CreateMemoComment` copies the anchor into the payload. Restyling
  a mark is an `UpdateMemo` with the relevant `update_mask` path
  (`doc_anchor` / `pdf_annotation` / `epub_annotation`).

Because the anchor lives on the payload (not derived from content),
`RebuildMemoPayload` — which recomputes only tags and properties on every
content edit — leaves it intact.

---

## 8.6 Notes & limitations

- **HTML documents** have no marks or comments.
- **Scanned PDFs** (no text layer) can only be annotated with a rectangle, not a
  colored text mark.
- **Markdown/View marking requires the comment panel to be open**; PDF/EPUB use
  an always-available *annotate mode* toggle instead.
- Erasing a mark that carries a note keeps the note; on Markdown/PDF the visual
  is removed, on EPUB it resets to the default highlight (so the note stays
  findable in the book).
- Only signed-in users can create marks/comments. They respect the same
  visibility and permission model as any other memo comment.
- **`memogit`-checked-out files do not contain marks or comments** — they live
  on separate child memos, not in the document's `.md`/attachment bytes. An
  agent editing a checked-out file won't see them, and **rewriting a marked
  passage detaches its highlight** (it degrades to the heading/rect/snippet
  fallback). See
  [`docs/skill/references/markdown-syntax.md`](../skill/references/markdown-syntax.md).
