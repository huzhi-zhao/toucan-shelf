# 3. Gallery Views

A large hierarchical knowledge base has a discovery problem: the important
documents get buried under folders. This is exactly what Notion's **views**
solve — and this fork borrows the idea. A **View document** is a special
`doc_type` whose content is *configuration only*; when opened, it renders a
**live gallery** of other documents in your knowledge base.

This gives you "two worlds in one": Yuque-style hierarchical capacity **plus**
Notion-style views that connect you back to the documents that matter.

- **Concept:** `view` is the fourth document type (alongside `MARKDOWN`, `HTML`,
  `PDF`). It reuses the same "dispatch renderer by doc type" mechanism.
- **Backing type:** `Memo.DocType.VIEW`.
- **Renderer:** `web/src/components/GalleryView/GalleryViewRenderer.tsx`.
- **Config type:** `web/src/components/GalleryView/types.ts`.

---

## 3.1 What a View document *is* (and isn't)

- Its `content` holds **only** a structured JSON configuration (view type +
  scope + sort/cover/card rules) plus optional Markdown intro text.
- It **never** stores HTML or any rendered/"baked" output.
- The gallery is rendered **live** from current data every time you open it:
  rename a child document, swap a cover image, add or delete documents — the
  next open reflects it automatically. There is no "regenerate" step.
- A View document is a normal node in the folder tree: it can be opened,
  renamed, moved, and linked to like any other document.
- A View document is **excluded from the Explore feed** — it's an organizational
  node, not a content note. (This exclusion lives in the same place that decides
  which doc types appear in the feed.)

> **Deliberately out of scope:** no per-view `index.xxx` physical files, no
> "bake to HTML" persistence, no free-form multi-block (Notion-block) editor,
> no schema-driven form engine. The intro is a single fixed Markdown field
> pinned above the gallery. See the requirement doc for the full rationale.

---

## 3.2 Creating & editing a View

1. In any folder, create a new **View** document (same entry point as creating a
   note or uploading an HTML doc).
2. **Choose a view style.** Today the only style is **Gallery** (the picker is a
   list, leaving room for `calendar` and others later).
3. Fill in the **preset form** for that style. A View document may hold
   **multiple gallery blocks**, each rendered top-to-bottom separated by
   dividers, and each with its own:
   - **Intro** — optional Markdown text pinned above the block's cards.
   - **Scope** — which documents this block shows (see §3.3).
   - **Sort** — card ordering (see §3.4).
   - **Cover rule** — how each card's cover image is chosen (see §3.5).
   - **Card fields** — what text the card shows (see §3.6).
   - **Badges** — up to 3 property-filtered ribbon overlays (see §3.6a).
4. Submit → the form serializes to the configuration JSON and saves through the
   normal document-save API.
5. Re-opening the editor **re-hydrates** the form from the stored JSON.

---

## 3.3 Scope — which documents appear

Each gallery block has exactly one scope (`GalleryScope`):

| Scope | Meaning |
|-------|---------|
| **Folder** (`{ type: "folder" }`) | The direct children of the View document's own folder. |
| **Tag** (`{ type: "tag", tag }`) | All documents carrying the given tag. |
| **Property** (`{ type: "property", filters }`) | Documents matching a set of frontmatter property equalities (ANDed together; list properties match if any item equals the value). Only equality is supported. |

---

## 3.4 Sort — card ordering

`GallerySort` is either a built-in token or a frontmatter-property sort:

- Built-ins: `updated_desc`, `updated_asc`, `created_desc`, `created_asc`,
  `title_asc`.
- Property sort: `prop_asc:<key>` / `prop_desc:<key>`. Documents missing that
  property sort to the end.

---

## 3.5 Cover rule — the card image

`GalleryCoverRule`:

- `first_image` — the document's first image attachment, or its first inline
  Markdown image.
- `none` — no cover.
- `prop:<key>` — use a frontmatter property value as the image. An
  `attachments/...` resource name resolves to that attachment; anything else is
  treated as a URL.

---

## 3.6 Card fields — the card text

Each card shows two rows (`GalleryCardFields`):

- **primary** (bold) — defaults to the document title.
- **secondary** (muted) — defaults to the updated date.

Each row is a `GalleryCardField`:

- `__title__` — the document title.
- `__updated__` — the updated date.
- `__created__` — the created date.
- `prop:<key>` — a frontmatter property value.
- `""` (empty) — show nothing on that row.

---

## 3.6a Card badges — flagging matching cards

Badges are a **block-level setting** (`GalleryBlock.badges`), configured in
the View editor alongside scope/sort/cover/card-fields. A block may configure
**up to 3 badges**. Each badge has:

| Field | Meaning |
|-------|---------|
| **Style** | One of the three built-in ribbon styles: `tag`, `ribbon`, `corner` (see below). |
| **Text** | The badge's label, truncated to 5 characters. |
| **Color** | A hex color for the badge background (defaults to `#FFFFFF`). |
| **Property filter** | A `key = value` equality check (same semantics as a scope `property` rule) against the *card's own* frontmatter — e.g. `status = done`. A badge with no property key never matches anything. |

At render time, for each card in the block, its frontmatter properties are
checked against the block's badges **in order**; the first badge whose filter
matches is shown (`matchGalleryBadge` in
`web/src/components/GalleryView/types.ts`). A card that matches no badge's
filter shows none. This is a display-only overlay: matching a badge never
changes which documents the block includes, only how a matched card looks.

Styles (rendered by `GalleryCardBadge` in `GalleryViewRenderer.tsx`):

- **`tag`** — a small rectangular label pinned to the card's top-left corner.
  This is the "completed" style: in addition to showing the label, the whole
  card is rendered with reduced opacity and grayscale to visually
  de-emphasize it.
- **`ribbon`** — a vertical folded ribbon in the top-left corner (letters
  stacked top-to-bottom), no special card treatment.
- **`corner`** — a diagonal ribbon across the top-right corner, no special
  card treatment.

---

## 3.7 Preview flow

1. Opening a View document dispatches (by doc type) to `GalleryViewRenderer`.
2. For each block: if `description` is set, it's rendered with the **existing
   Markdown renderer** (same `rehype-sanitize` pipeline — no new security
   surface) above the cards.
3. The block queries its scope against **live** data and renders the cards via
   the fixed `GalleryDocCard` component.
4. Clicking a card opens the underlying document.

---

## 3.8 Roadmap (not in this release)

- More view styles (`calendar`, …) on the same doc-type-dispatch + preset-form
  skeleton.
- Optionally upgrade the intro from "single fixed field" to "fixed multi-slot"
  if usage demands it — still no free-form block editor.
- If view styles grow past ~5, revisit the form approach (likely
  `react-hook-form` + `zod`, matching the existing stack).

See the full requirement in
[`../dev/requirements/views/gallery-view.md`](../dev/requirements/views/gallery-view.md).
