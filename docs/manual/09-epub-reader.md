# 9. EPUB Reader

An **in-app EPUB reader** (built on [epub.js](https://github.com/futurepress/epub.js/))
renders `.epub` books with page-flip or continuous-scroll layout, adjustable
typography, per-book appearance that follows you across devices, and the same
**highlight / underline / comment** marks as the rest of the app.

- **Reader:** `web/src/components/EpubViewer/EpubDocumentView.tsx` (+ the hooks
  `useEpubBook.ts`, `useEpubRendition.ts`, `useEpubAnnotations.ts`).
- **Toolbar & settings:** `EpubToolbar.tsx`, `EpubSettingsMenu.tsx`,
  `epubSettings.ts`.
- **Marks/comments:** shared with the rest of the app — see
  [Manual 8 · Text Marks & Comments](./08-document-comments.md).

---

## 9.1 EPUB is an attachment, not a doc type

There is **no `EPUB` `doc_type`**. The four document types stay Markdown / HTML /
PDF / View (see [Manual 2](./02-rich-documents.md)). An EPUB is an ordinary
**attachment** (`application/epub+zip`) on a memo. You get the reader by
**previewing the attachment**: open the attachment's preview page (a standalone,
new-tab reader at `AttachmentPreview.tsx`), just as you would preview a PDF or
HTML attachment.

Two things flow from this:

- **To read a book, upload the `.epub` as an attachment** to any memo, then open
  its preview.
- **Annotations need a parent memo.** The reader can author marks/comments only
  when the attachment belongs to a memo (it anchors them to that memo,
  `parentMemoName` + `attachmentName`). An attachment with no parent memo is
  read-only.

---

## 9.2 The toolbar

The reader's controls are **portaled into the preview page's title bar**
(`EpubToolbar.tsx`), left to right:

| Control | What it does |
|---------|--------------|
| **Contents** (list icon) | The book's table of contents, flattened with indentation for sub-chapters. Selecting an entry jumps to that chapter. |
| **Flow toggle** | Switches between **paginated** (book icon) and **continuous scroll** (scroll icon) — see §9.3. |
| **‹ / ›** | Previous / next page (also **← / →** arrow keys, except while typing in a field). |
| **A- / A+** | Font size, shown as a percentage. Range **70 %–200 %**, in 10 % steps. |
| **Annotate mode** (💬+) | On by default. While on, selecting text raises the mark toolbar. Turn off to select text just to copy it. |
| **Annotations panel** (💬 text) | Opens the side list of noted annotations. |
| **Settings** (gear) | The appearance popover — see §9.4. |

---

## 9.3 Reading layout (flow)

- **Continuous scroll** (`scrolled-doc`, the **default**) — one long vertical
  scroll, like a web page. epub.js scrolls its *own* inner container, so the
  page bridges that scroll out to hide the title bar on scroll-down and to power
  the "back to top" button.
- **Paginated** — left/right page flipping in columns, like a physical book.
  Arrow keys and the ‹ / › buttons flip pages; this mode never scrolls.

---

## 9.4 Appearance settings

The gear popover (`EpubSettingsMenu.tsx`) adjusts, from `epubSettings.ts`:

- **Background** — `theme` (follows the app's light/dark theme, the default),
  `paper`, `sepia`, `green`, `night`. A fixed background also tints the page
  **gutters** around the book so the reading surface reads as one color.
- **Font family** — `default` (the book's own fonts) plus well-known system
  stacks: System, Arial, Helvetica, Verdana, Georgia, Times, and CJK families
  (宋体 / 黑体 / 楷体). The browser can't enumerate installed fonts, so each is a
  font *stack* that resolves if the OS has it and falls back otherwise.
- **Letter spacing** — −0.10em to 0.30em (negative tightens loosely-tracked
  books).
- **Line height** — 1.2 to 2.4.
- **Paragraph spacing** — 0 to 2em between paragraphs.
- **Font size** — via the toolbar A- / A+ (70 %–200 %).

### Settings are saved per book, on the server

Appearance is **persisted per attachment** on the server
(`Attachment.reader_settings`, an opaque JSON blob), debounced ~500 ms after a
change. So each book keeps its own theme / font / spacing, and it **follows you
across devices** — not a browser-local or reader-wide preference. A failed save
just means that one device's tweak won't sync; it still applies locally.

Reading **position** is cached separately (per attachment, as a CFI) so a book
reopens where you left off.

---

## 9.5 Marks & comments in a book

Marking works exactly like the rest of the app (full details in
[Manual 8](./08-document-comments.md)); the EPUB-specific points:

- **Select text** (annotate mode on) → the floating toolbar: pick a **color**
  (highlight), toggle **underline**, or write a **note** (which also highlights
  the passage in the default color). A note opens an editor prefilled with the
  quoted text.
- **Click an existing mark** → the same toolbar over it, to recolor / underline
  / annotate / erase it.
- **Bare marks** (no note) show only in the book; **noted** annotations also
  appear in the annotations panel, where clicking one **jumps to its location**.
- Marks are pinned by **CFI** (an EPUB file never changes under the reader), so
  they don't need the quote-selector re-location that documents and PDFs use.
  epub.js draws a highlight as an SVG `fill` and an underline as an SVG
  `stroke`; the two can stack.
- **Erasing** a bare mark deletes it; erasing a mark that carries a note keeps
  the note and **resets it to the default highlight** (so it stays visible and
  locatable in the book), rather than removing the visual entirely.

Annotations are ordinary **comment memos** anchored to the parent memo via
`payload.epub_annotation` (`attachment_name`, `cfi_range`, `text_snippet`,
`color`, `underline`) — the same MemoRelation/COMMENT plumbing as PDF and
document comments (§8.5).

---

## 9.6 Notes & limitations

- No EPUB `doc_type` — books are attachments, previewed like PDF/HTML.
- Annotations require the attachment to have a **parent memo**.
- Appearance is **per-book** and server-persisted; reading position is cached
  per-book as a CFI.
- Like all attachment bytes, an EPUB is **not editable** and its marks/comments
  are **not** part of the file — `memogit` downloads the bytes read-only and
  never sees the annotations (see
  [`docs/skill/references/attachments.md`](../skill/references/attachments.md)).
