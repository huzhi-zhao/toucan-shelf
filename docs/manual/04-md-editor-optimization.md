# 4. Markdown Editor Optimization 

## 4.1  Callout

```markdown

> [!NOTE] this is a note

> [!INFO] info

> [!TODO] todo

> [!ASIDE] aside

> [!IMPORTANT] important

> [!CHECK] check

> [!DONE] done

> [!SUCCESS] success

> [!TIP] tip

> [!HINT] hint

> [!IMPORTANT] important

> [!WARNING] this is warning

> [!CAUTION] this is caution

> [!ATTENTION] attention

> [!ERROR] error

> [!FAILURE] failure

> [!FAIL] fail

> [!MISSING] missing

> [!DANGER] danger

> [!BUG] bug

> [!EXAMPLE] example

> [!QUOTE] quote

> [!CITE] cite

> [!ABSTRACT] abstract

> [!SUMMARY] summary

> [!TLDR] tldr

> [!QUESTION] question

> [!HELP] help

> [!FAQ] faq

> [!IMPORTANT(📜)] this is a piece of important information , with a customed icon.

> [!NOTE(🎯)] this is a note with a customized target icon.

> [!TIP(💡)] this is a tip with a customized light bulb icon.

```
## 4.2 Keyboard Shortcuts

The home-page editor (`MemoEditor`) is built on CodeMirror 6 and provides
Notion / Obsidian–style formatting shortcuts. Throughout this page, **`Mod`**
means **`Cmd` on macOS** and **`Ctrl` on Windows / Linux**.

- **Command catalog:** `web/src/components/MemoEditor/formatting/commands.ts` —
  shared by both the toolbar buttons and the shortcuts, so a single command
  definition drives both.
- **Execution & keymap:**
  `web/src/components/MemoEditor/Editor/formatting.ts` — `applyCommand` runs a
  formatting command; `createFormattingKeymap` binds the keys.
- **Wiring:** `web/src/components/MemoEditor/Editor/extensions.ts` feeds
  `createFormattingKeymap()` into CodeMirror's `keymap.of([...])`.
- **Editor-level shortcuts:**
  `web/src/components/MemoEditor/hooks/useKeyboard.ts` — global keys at the
  editor level (currently just `Mod-Enter` to save).

---

## 4.1 Supported shortcuts

| Shortcut | Action | Notes |
| --- | --- | --- |
| `Mod-Enter` | Publish / save memo | Requires the editor to be focused. |
| `Mod-B` | Bold `**text**` | Toggles off when the cursor is already inside bold text. |
| `Mod-I` | Italic `*text*` | Toggles, same as above. |
| `Mod-E` | Inline code `` `text` `` | Toggles, same as above. |
| `Mod-K` | Insert / remove link `[text](url)` | With the cursor already inside a link, it expands back to plain text; when creating a new link you fill in the URL manually (the toolbar button behaves the same — there is no URL input popover yet). |
| `Mod-Shift-7` | Ordered list | Applies to all selected lines at once. |
| `Mod-Shift-8` | Bulleted list | Same as above. |
| `Mod-Shift-9` | Task list `- [ ]` | Same as above. |
| `Mod-Shift-0` | Insert checked task `- [x] ` | Inserts directly at the cursor; not a toggle and not wired into the command catalog. |
| `Mod-Alt-0` | Body text (clear heading) | |
| `Mod-Alt-1` / `Mod-Alt-2` / `Mod-Alt-3` | Heading 1 / 2 / 3 | Matches the toolbar's addressable range (H1–H3). |
| `Mod-Alt-4` / `Mod-Alt-5` | Heading 4 / 5 | Shortcut-only; not wired into the command catalog (`EditorCommandId` stops at heading3), so the toolbar and active-state highlight won't show H4/H5 — but the rendering and Markdown output are correct. |
| `Tab` / `Shift-Tab` | Indent / outdent list item | Pre-existing, not added in this pass. |
| `Escape` | Blur the editor | Pre-existing, not added in this pass. |
| `Mod-Z` / `Mod-Shift-Z` | Undo / redo | Comes from CodeMirror's `historyKeymap`. |

---

## 4.2 Not supported (intentionally deferred)

The Notion / Obsidian formats below have no toggle logic in the current
Markdown command catalog (`formatting/commands.ts`) yet, so they were left out
to avoid introducing new formatting capabilities that haven't been confirmed
with the product:

- Strikethrough (`~~text~~`)
- Underline
- Blockquote (`> `)
- Fenced code block (```` ``` ````)

Highlight (`==text==` / `===text===`) is a partial exception: the Markdown
syntax itself renders (see [4.4](#44-highlight)), it just has no toolbar
button or keyboard shortcut to insert/toggle it yet — you type the `=`
delimiters by hand.

To add one, you first extend `formatting/commands.ts` with the matching
`EditorCommandId` and `ActiveFormatState` field, implement the toggle in
`Editor/formatting.ts` (following the existing `toggleMark` / `toggleListLine`),
and then register the key binding in `createFormattingKeymap`.

---

## 4.3 Frontmatter properties

A document can open with an Obsidian-style YAML frontmatter block — a `---`
line, one `key: value` line per property, and a closing `---` line — before
the Markdown body:

```markdown
---
title: AI Ethics Week 1
tags: [ai, ethics]
status: completed
date: 2026-07-11
---

# body starts here
```

- **Parser:** `web/src/utils/frontmatter.ts` (`parseFrontmatter`) — line-based,
  not a full YAML engine. Frontmatter must be the very first thing in the
  document. Only flat scalar/list values are recognised (Obsidian's subset);
  nested maps, arrays of objects, and malformed lines are silently ignored and
  never rendered.
- **Supported value types:** `text`, `list` (`[a, b, c]`), `number`, `checkbox`
  (`true` / `false`), `date` (`YYYY-MM-DD`), `datetime`.
- **Rendering:** `web/src/components/MemoContent/PropertiesPanel.tsx` shows the
  parsed properties as a read-only key/value panel above the body — this panel
  never writes back to the document; editing a property means editing the raw
  frontmatter text.

Properties are free-form — you can add any key. They describe the document's
content (date, status, category, tags); how the app *renders* the document —
width, outline, folder tree, whether the properties panel shows at all — is
document configuration, set from the document's **⋮ → Document settings** menu and
stored on the memo rather than in the text (`web/src/utils/docConfig.ts`).

---

## 4.4 Highlight

Two Obsidian-flavored inline highlight delimiters are supported in rendered
Markdown:

| Syntax | Result |
| --- | --- |
| `==text==` | `text` on a light yellow background |
| `===text===` | `text` on a light pink background (this project's own extension — not part of Obsidian) |

```markdown
This is ==important== and this is ===also important, differently===.
```

- **Parser:** `web/src/utils/remark-plugins/remark-highlight.ts` — a remark
  plugin that scans text nodes left to right, preferring the longer `===`
  delimiter so `===text===` isn't misread as `=` + `==text==` + `=`. A bare
  run of `=` (e.g. `====`) or an empty pair never opens a highlight, and
  content inside inline code / fenced code blocks is left untouched (the
  plugin only rewrites plain `text` mdast nodes).
- **Rendering:** the plugin emits a `<mark class="highlight highlight-yellow">`
  / `<mark class="highlight highlight-pink">` node; `MemoMarkdownRenderer.tsx`
  maps `mark` to Tailwind background classes (with dark-mode variants).
  `rehype-sanitize`'s schema (`MemoContent/constants.ts`) explicitly allows the
  `mark` tag and its `className`.
- **No editor shortcut yet:** unlike bold/italic/strikethrough, there's no
  toolbar button or keyboard toggle for highlight — type the `=` delimiters
  directly in the editor. See the note in [4.2](#42-not-supported-intentionally-deferred).

## 4.5 AI Rewrite (润色)

Select any text in the editor and rewrite it with your instance's AI provider —
polish the wording, tighten it, expand it, fix grammar, or follow a free-form
instruction of your own. The rewrite replaces the selection in place, and a
plain **Cmd/Ctrl-Z** undoes it.

### Prerequisites

An AI provider must be configured for the instance. The instance owner sets one
up under **Settings → AI** (BYOK: an OpenAI-compatible or Gemini key) and marks
it as the **default provider**. Without a default provider the rewrite call
fails with *"no default AI provider is configured"*. This is the same provider
used by audio transcription and PDF "Format with AI".

### How to use it

1. **Select** the text you want to rewrite (a phrase, a sentence, or several
   paragraphs). A floating **✨ AI** button appears just above the selection.
2. **Click it** to open the rewrite popover.
3. Pick a **preset**, or type a **custom instruction** and run it:

   | Preset | What it does |
   | --- | --- |
   | **Polish** | Improves clarity, flow, and word choice; keeps the meaning. |
   | **Make concise** | Removes redundancy and tightens wording without dropping key information. |
   | **Expand** | Adds detail and elaboration, faithful to the original intent. |
   | **Fix grammar** | Corrects grammar, spelling, and punctuation only. |
   | **Adjust tone** | Makes the tone more natural and appropriate. |

   For anything a preset doesn't cover, type an instruction in the box
   (e.g. *"make it more formal"*, *"cut the length in half"*, *"改写成要点列表"*)
   and press the **Rewrite** button or **Cmd/Ctrl-Enter**.
4. The result **replaces your selection** directly. If you don't like it, press
   **Cmd/Ctrl-Z** once to restore the original text.

### Language behavior

The rewrite is returned in **the same language as the selected text**,
regardless of the language of your instruction or the preset labels. So an
English instruction like "make it formal" applied to a Chinese selection still
returns Chinese. Write your instruction in whichever language is convenient —
only the selection's language decides the output.

### Notes & limits

- **Selection cap:** up to 128 KiB of selected text per request.
- **Custom instruction wins:** if you type an instruction, the preset is
  ignored for that run.
- **Not streaming:** the popover shows a spinner while the request runs and then
  swaps in the full result at once.
- **Formatting preserved:** existing Markdown in the selection (bold, links,
  lists, …) is kept.
- **Undo integration:** the replacement is a single editor edit, so one
  Cmd/Ctrl-Z reverts it. External document syncs (loading/switching a memo) are
  kept out of the undo history, so undo never rewinds past your own edits into a
  blank editor.

Under the hood this calls `AIService.PolishText`; see
[Manual 7.4](./07-api-reference.md#74-aiservice--writing-assistants) for the
HTTP shape.

---

## 4.6 Collapsible callouts

Two callout families that **hide their body until you ask for it** — a folding
card and a hover popover. They use the same `> [!TYPE]` blockquote syntax as the
callouts in [4.1](#41--callout), so anything you can write in a callout body
(lists, code, tables, images, nested Markdown) works inside them.

Insert either from the editor toolbar's **Collapsible** button (the
`ListCollapse` icon, immediately right of the **Callout** button), which drops a
ready-to-edit snippet at the cursor.

### Syntax

| Syntax | Renders as |
| --- | --- |
| `> [!Collapse]- Title` | A card with a bold header + chevron. Click the header to fold/unfold the body. |
| `> [!Popover] Title` | A pill button. **Hovering** (or tabbing to) it floats the body above it. |

The text after the marker is the **title**; every following `>` line is the
**body**. Omit the title and the family name is used instead ("Collapse").

```markdown
> [!Collapse]- Deployment Steps
> 1. Build image
> 2. Push to registry
> 3. Rolling restart
>
> See [O&M Manual](https://example.com) for more details.

> [!Popover] What is a workspace?
> The top-level container for a knowledge base; every document belongs to and only to one workspace.
```

### The `+` / `-` fold marker

A `+` or `-` **directly after the closing `]`** sets whether a **Collapse**
starts open or folded — the same convention Obsidian uses:

| Marker | Initial state |
| --- | --- |
| `> [!Collapse]-` | **Folded** (click to reveal) |
| `> [!Collapse]+` | **Open** |
| `> [!Collapse]` (no marker) | Folded |

The marker is **per-render, not persisted**: folding or unfolding in the preview
never rewrites your Markdown, and reopening the document returns to whatever the
marker says. It has no effect on **Popover**, which is hover-driven and has no
folded state.

### Notes & limits

- **Popover is hover-driven**, so it is awkward on touch devices — prefer
  **Collapse** for content that must be reachable on mobile.
- **Popover bodies should stay short.** The panel is capped at `max-w-sm` and
  floats *above* the button; a long body is better served by a Collapse.
- **Hidden text is still in the document.** A folded body is present in the
  Markdown source, so search, `memogit`, and export all see it — collapsing is
  presentation, not access control.

Under the hood: `remark-alert.ts` parses the marker (including the `+`/`-` fold
flag, emitted as `data-alert-fold`), `alertFamilies.ts` maps the type to the
`collapse` / `popover` family, and `SpecialCallouts.tsx` renders the card.

---

## 4.7 Click counters

A tally you can bump by clicking, stored **in the Markdown itself**. Useful for
habit tracking, "how many times did I reach for this", spaced-repetition counts,
or any lightweight running total you want to live next to the note.

### Syntax

Write a list item whose first token is a bracketed number:

```markdown
- [1] Used this command
- [12] Review Rust lifetimes
- [0] Things not started yet
```

Each renders as a clickable badge showing the number, followed by the label.
**Clicking the badge increments it and saves the document** — `- [1]` becomes
`- [2]` in the source, so the count survives reloads and is visible to
`memogit`, export, and anything else that reads the Markdown.

This is deliberately the same shape as a task list (`- [x] done`), and the two
mix freely in one list:

```markdown
- [x] Completed task
- [3] Click count
- Normal list item
```

### Where clicking works

The badge is only clickable where the document is **writable by you** — your own
documents (or any document, if you are an instance super-user), in the Markdown
and View document preview. On someone else's document the badge still renders,
showing the count, but is inert.

### Notes & limits

- **The space is required.** `- [1] label` is a counter; `-[1] label` (no space
  after the bullet) is plain text, and `- [1]label` (no space after the bracket)
  is left alone too.
- **Only digits.** `- [x]` / `- [ ]` / `- [/]` stay task checkboxes; `- [abc]`
  is not a counter.
- **Not confused by look-alikes.** A link definition (`- [1]: https://…`) or a
  link (`- [1](https://…)`) is never treated as a counter.
- **Code is untouched.** A `- [1]` inside a fenced or inline code block renders
  literally and is never counted.
- **Leading zeros are normalized.** `- [01]` increments to `- [2]`, not `- [02]`.
- **No decrement or reset from the UI** — edit the number in the source to
  adjust or zero it.

Under the hood: `remark-counter.ts` lifts the `[N]` onto the `<li>` as
`data-counter` (mirroring how `remark-task-status.ts` handles extended task
markers), `List.tsx` renders the badge, and `incrementCounterAtIndex`
(`markdown-manipulation.ts`) rewrites the matching line on click.
