# 6. View Blocks (calendar / kanban / grid / sheets)

Beyond the four **document types**, this fork adds four **interactive view
blocks** you embed *inside* a Markdown document with a fenced code block. They
all share one mechanism: the code-block renderer dispatches on the fence
language and hands the block off to a dedicated component.

- **Dispatch:** `web/src/components/MemoContent/CodeBlock.tsx` — `language ===`
  `"calendar" | "kanban" | "grid" | "sheets"`.
- Each block **degrades gracefully**: malformed input renders an empty-state or
  the raw source rather than breaking the document, and an `ErrorBoundary`
  contains any remaining throw to the block.
- **Editing is contextual.** Blocks that write back (calendar, kanban, sheets)
  only allow direct manipulation when you open **your own** document in a context
  that can save it. In the Explore feed, shared views, or someone else's
  document, they render read-only.

> 📋 **Copy-paste playground:** every syntax feature and edge case below is
> demonstrated end-to-end in **[View Blocks — Complete Demo](./demo-views.md)**.
> Open it as a memo to see all four blocks render live.

| Block | Fence | Body format | Write-back | Renderer |
|-------|-------|-------------|-----------|----------|
| Calendar | ` ```calendar ` | date groups + checklist/event lines | checkbox toggle, add items, event dots | `CalendarBlock.tsx` |
| Kanban | ` ```kanban ` | YAML | checkbox, drag, add task | `KanbanBlock.tsx` |
| Grid | ` ```grid ` | `key: value` config + cards | — (display only) | `GridBlock.tsx` |
| Sheets | ` ```sheets ` | CSV + `view:` | cell edits (debounced) | `SheetsBlock.tsx` |

---

## 6.1 Calendar

A month grid with a per-day detail panel, driven by dated checklist lines.

- **Parser:** `web/src/components/MemoContent/calendar/parseCalendarBlock.ts`.
- **Write-back:** `web/src/components/MemoContent/calendar/upsertCalendarItem.ts`.

### Syntax

```calendar
events: 瑜伽, 早睡, 喝水
- 2026-07-20
- [ ] Kick off sprint planning
- [x] Send calendar invites
- @瑜伽
- @早睡
- 全天：团队 offsite（纯文本，无 checkbox）
```

- A line `events: a, b, c` (逗号或中文逗号分隔) **declares the event set**. Each
  event gets a fixed color by its index (see `calendar/eventColors.ts`).
- A line `- YYYY-MM-DD` **opens a date group**.
- Following lines attach to the current group:
  - `- [ ] text` → unchecked box, `- [x]` / `- [X]` → checked box,
  - `- @name` → an **event occurrence** for that day (`name` must be a declared event),
  - `- text` (no box) → plain text entry.
- Item lines **before any date** collect into an *Ungrouped* section shown above
  the month grid.
- A line `showTaskDot: true` **enables the blue "has tasks" dot** drawn next to the
  day number on narrow screens. Omitted or `false` → no dot (the default).
- A line `allowMaxUpdateDays: N` **limits editing** to the last `N` days (today
  included) and the future; older cells render read-only.
- A line `weekStartDay: N` **sets the first weekday of the grid** — `1` = Monday …
  `6` = Saturday, `7` = Sunday. Omitted → the instance's week-start setting.
- The leading/trailing cells from the neighbouring months are drawn (day number,
  task previews, event dots) but **dimmed and not clickable**.
- Blank lines and non-matching prose are ignored. Non-adjacent groups with the
  same date merge; an empty body shows a friendly empty state.

### Interactions (your own editable document)

- **Toggle a checkbox** in the day-detail panel → rewrites `- [ ]` ↔ `- [x]`.
- **Add items** for the selected day → appends lines under that date (creating the
  date group if needed). Both save via `updateMask: ["content", "update_time"]`.
- **Events.** The "add" popover lists every declared event with a checkbox
  (checking one writes/removes a `- @name` line). The day-detail panel shows
  events (colored dots) above a divider, tasks below. Each calendar cell renders
  the day's events as colored dots on its bottom row, below the (max 2) task
  preview lines.

---

## 6.2 Kanban

A board with columns, cards, and drag/checkbox/add gestures that write straight
back into the YAML.

- **Parser:** `web/src/components/MemoContent/kanban/parseKanbanBlock.ts`.
- **Write-back:** `web/src/components/MemoContent/kanban/serializeKanbanBlock.ts`.

### Syntax

The body is **YAML** with three top-level keys:

| Key | Meaning |
|-----|---------|
| `items` | The list of task cards (see fields below). |
| `view` | Board configuration. |
| `statusOrder` | Explicit left-to-right column order for the `groupBy` field. |

### Task fields

All optional **except `title`** — an item without a title is skipped.

| Field | Type | Used for |
|-------|------|----------|
| `id` | string | Stable identity for write-back. Auto-minted on first edit when missing. |
| `title` | string | Card heading. **Required.** |
| `link` | string | Makes the title a link — an in-workspace relative doc path (`milestones/M-008.md`) or an absolute URL (`https://…`, new tab). |
| `status` | string | Which column the card sits in (when `groupBy` is `status`). |
| `priority` | enum | Colored badge: `highest`, `high`, `medium`, `low`, `lowest`. |
| `done` | boolean | Completion — greyed out, struck-through, checked box. |
| `order` | number | Sort position within its column (default sort key). |
| `tags` | list or comma-string | Chips (`[BigData]` or `"a, b"`). |
| `due` | string | Due date with a calendar icon. |
| `createAt` / `updateAt` | string | Timestamps. `updateAt` is bumped on every write-back. |

**Custom fields.** Any key beyond the built-ins (e.g. `owner`, `estimate`) is
preserved and shown in the **task detail panel** when you click the card.

### View configuration

| Key | Default | Meaning |
|-----|---------|---------|
| `type` | `kanban` | View style identifier. |
| `groupBy` | `status` | The field used to form columns. |
| `orderBy` | `order` | The field used to sort cards **within** a column. |
| `descending` | `false` | Reverse the within-column sort. |
| `lock` | `false` | When `true`, the board is **view-only** — freeze a finished board. |

**Column ordering:** columns in `statusOrder` render first, in that order,
**including empty ones**; grouping values not listed append in first-seen order;
cards missing the `groupBy` field collect in a trailing **Ungrouped** column.

### Interactions (your own editable document)

| Gesture | Effect | Field written |
|---------|--------|---------------|
| **Click a card's checkbox** | Toggle completion | `done` (+ `updateAt`) |
| **Drag a card to another column** | Move between statuses | `status` (+ `updateAt`) |
| **"Add task" at a column bottom** | Create a card in that column | new item with `id`, `title`, `status`, `createAt`, `updateAt` |

Drag-to-move and Add are available **only when `groupBy` is `status`** and only on
real columns (never *Ungrouped*). Clicking elsewhere on a card opens its detail
panel. Reordering within a column, inline field editing, and deleting cards are
**not in this release**.

### How write-back works

Edits rewrite the YAML **inside** the fence (surrounding Markdown untouched) via
the `yaml` document API (parse → mutate → stringify), which **preserves comments
and key order**. Cards are addressed by `id` (falling back to source position);
a missing `id` is minted so future edits stay stable. Because the block is
re-serialized, its own indentation/quote style is normalized after the first
write — an accepted trade-off for a machine-oriented block.

---

## 6.3 Grid

A responsive gallery of cover cards (or two-line text strips). **Display only —
no write-back.**

- **Parser:** `web/src/components/MemoContent/grid/parseGridBlock.ts`.

### Syntax

Block config lines come **before** the first `- ` card entry; cards follow.

```grid
columns: 3

- title: 带封面 + 链接的卡片
  subtitle: 副标题（muted）
  cover: https://picsum.photos/seed/one/400/300
  url: https://example.com
  作者: 赵华
```

**Block config** (top-level `key: value`, before the first card):

| Key | Meaning |
|-----|---------|
| `style` (alias `type`) | `card` (default) or `longbar` — longbar = two-line title + subtitle strips, never showing a cover. |
| `nocover` | `true` hides covers on **every** card. |
| `columns` | Fixed column count, clamped **1–8**. Undefined = auto-fill by width. |

**Card fields** (each card starts with `- title:`):

| Key | Meaning |
|-----|---------|
| `title` | **Required** — card heading. |
| `subtitle` | Muted second line. |
| `cover` | An `attachments/…` resource name, or a URL. |
| `url` | Makes the whole card a link. |
| `nocover` | Per-card — force a text card even when a cover is set. |
| *anything else* | Collected in source order as a display field under the subtitle (empty values dropped). |

Cards without a `title` are dropped.

---

## 6.4 Sheets

An interactive spreadsheet (canvas grid) with formulas and debounced write-back.

- **Parser:** `web/src/components/MemoContent/sheets/parseSheetsBlock.ts`.
- **Write-back:** `web/src/components/MemoContent/sheets/serializeSheetsBlock.ts`.
- **Grid engine:** [`x-data-spreadsheet`](https://github.com/myliang/x-spreadsheet)
  — a pure front-end, canvas-rendered editable grid.

### Syntax

CSV-based. `sheet:<name>` starts a named tab; a `view:` section holds block-level
display config.

```sheets
sheet:销售数据
name,price,qty
苹果,3.5,10
香蕉,2.1,20
,,,总价,=B2*C2+B3*C3

view:
  lock: false
```

- **`sheet:<name>`** — starts a tab. Multiple markers → multiple tabs; a block
  with no marker is one unnamed sheet.
- **CSV rows** — parsed with papaparse, first row is the header. A cell starting
  with `=` is a **formula**; everything else is literal text or a number.
- **`view:`** — `lock: true|false` (read-only even in an editable doc). The
  viewport height is *not* written here: drag the handle at the bottom of the
  grid and the height is saved with the block (in the memo's node overlays,
  alongside cell styles), then restored on the next load.

Edits (edit mode only) are debounced (~600 ms) and serialized back into the
` ```sheets ` block, so the grid and the raw source never drift apart.

> **Theming note.** x-spreadsheet draws to a `<canvas>` with hard-coded light
> colors and ships no dark theme / runtime theming API, so the block is
> deliberately pinned to a light card in dark mode. This is a grid-engine
> limitation, not a bug.

### Formulas — what actually works

x-spreadsheet v1.1.9 builds in only **eight** functions:

```
SUM   AVERAGE   MAX   MIN   IF   AND   OR   CONCAT
```

`web/src/components/MemoContent/sheets/formulaPatch.ts` registers **fallbacks**
so more compute or at least don't crash — `PRODUCT`, `DIVIDE`, `SUBTRACT`,
`COUNT`, `COUNTA`, `ABS`, `INT`, `SQRT`, `ROUND`, `LEN`, and others. Functions
that are neither built in nor implemented (e.g. `VLOOKUP`, `SUMPRODUCT`,
`COUNTIF`) fall back to a safe `#N/A` marker instead of throwing. Plain
arithmetic on **individual** cell references works: `=B2*C2+B3*C3`.

**What does NOT work — range / array arithmetic.** The engine expands `A1:A3`
into a flat argument list with no element-wise math, so `=SUM(B2:B3*C2:C3)` and
`=SUMPRODUCT(B2:B3,C2:C3)` do **not** compute row-wise `price × qty`. Expand it
explicitly instead: `=B2*C2+B3*C3`.

### AI formula assistant

In edit mode, the right-click menu gains a **✨ AI formula** entry: pick a cell,
describe the formula in natural language, and the instance's AI provider returns
a single formula inserted into the cell.

- **Endpoint:** `AIService.GenerateFormula` (`POST /api/v1/ai:generateFormula`) —
  see the [API reference](./07-api-reference.md). The request carries the prompt
  plus a `context` string (target cell + active sheet as CSV).
- **Server guard rails** (`server/router/api/v1/ai_service.go`): the system
  prompt constrains the model to supported functions and A1 references and
  forbids range arithmetic; `normalizeFormula` strips fences/prose to a single
  `=`-line; `validateFormula` **rejects** replies that leave the grammar.
- **Client guard rails** (`SheetsBlock.tsx`): the returned formula is checked
  against the supported set before insertion; if the engine still throws while
  rendering, the cell is re-inserted as **literal text** (leading `'`) so you see
  what the model produced instead of a crash.

> **Transport note.** The web client talks to the API over **Connect binary
> protobuf**, so in dev-tools the `GenerateFormula` bodies show as byte streams
> (Chinese text looks like mojibake). This is expected — use *View parsed* or
> switch the transport to JSON to read them.

---

## 6.5 Secret block (`toucan-secret`)

A block that holds credentials — MinIO logins, API tokens, `.env` fragments —
encrypted with a passphrase only you know. Unlike the four view blocks above, its
fence body is **not** the data: it is a reference plus a label.

````
```toucan-secret
v: 1
id: 7Kq2vX9mNb
hint: MinIO setup steps
```
````

- `v` is the body's format version. A client that does not recognise it says so
  instead of guessing — if a later format gave `id` a different meaning, silently
  honouring it could open the wrong record.
- `id` points at the stored ciphertext.
- `hint` is plain text and doubles as the block's **title**. It is what tells a
  reader — including you, months later, reading the raw file in a memogit checkout —
  what this block is for. It describes the secret; it is not part of it.

### Setting one up

Everything happens in the preview; there is no separate dialog.

1. In the editor, insert a block from **Collapsible → Secret block**. It arrives with
   a local placeholder id and is not yet set up.
2. Switch to preview. The card shows **Set passphrase** rather than *Unlock*, with
   fields for the passphrase (twice) and the title.
3. Setting the passphrase creates the record and writes its real id and title back
   into the document. The card opens, empty.
4. Use the **pencil** button to write the content, then save. The payload is
   rendered with the same Markdown renderer as the rest of the document.
5. The **key** button changes the passphrase: the content is re-encrypted and the
   stored envelope is overwritten, so the old passphrase stops working — see below
   for why that only works because the ciphertext lives outside the document.
6. Reload the page — or anything else that remounts the block — and it is locked
   again. Nothing is remembered.

Encryption happens in your browser. The passphrase never leaves it and the server
never sees the plaintext, so **there is no recovery**: forget the passphrase and the
content is gone. That is why setup asks for it twice.

### Why the ciphertext is not in the document

Because a document body is append-only in practice: every edit is snapshotted into
version history, and `memogit` pushes it into git. An inline envelope would mean that
re-encrypting under a new passphrase leaves the **old** passphrase's ciphertext
readable forever in history — making a passphrase change useless. Storing it
separately lets a rotation actually overwrite.

The consequence is deliberate: a document exported out of this instance keeps the
reference and the title but not the ciphertext, so the block is inert elsewhere.

### What to expect

| Situation | What you see |
|---|---|
| Wrong passphrase | "Incorrect passphrase." |
| Ciphertext altered or truncated | A distinct message telling you to restore from a backup — **not** a passphrase error, so you do not waste time retrying |
| Document synced from another instance | "This secret block does not exist in the current instance." |
| Document opened via a public share link, not signed in | "Sign in to open it" — the ciphertext is never served to anonymous readers, so no passphrase field is offered either |

Secrets belong to **you**, not to the document. Deleting or duplicating a document
never destroys a secret, and two documents may reference the same one.

### Limits worth knowing

- Once decrypted, the plaintext is in the page — any browser extension with page
  access can read it. This is inherent to decrypting in a browser.
- The app's own JavaScript is served by the instance, so you are ultimately trusting
  whoever operates it.
- Only the reference is indexable, so secret content never appears in search. The
  title does appear in the raw markdown, so keep it descriptive, not sensitive.

Good fits: passwords, tokens, certificates, recovery codes — things a human reads and
pastes elsewhere. A poor fit is an SSH private key, which is better kept in a keychain
or an `age`-encrypted file: it needs to be consumed by `ssh-agent`, rotated, and
revoked, none of which copy-paste supports well.

---

## 6.6 Roadmap (not in this release)

- **Kanban:** reorder within a column, inline field editing, delete cards, column
  management (add / rename / reorder via `statusOrder`).
- More block types on the same fence-dispatch skeleton.

See the complete, runnable examples in
[View Blocks — Complete Demo](./demo-views.md).
