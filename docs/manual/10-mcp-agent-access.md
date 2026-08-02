# 10. MCP Agent Access — Let Claude Code Read and Write the Knowledge Base Online

[memogit](./05-memogit-cli.md) hands an AI agent your knowledge base as **local
files**. This manual is the other half: an **MCP server** that lets an agent read
and write documents **over HTTP, with nothing on disk**.

The motivating case is writing code in one repository while the architecture
notes for it live in a knowledge base. Checking the whole thing out to reference
one document is heavy, and a checkout inside a code repository collides with that
repository's own git. Over MCP the agent just fetches what it needs, like reading
a web page.

---

## 10.1 memogit or MCP?

Both give an agent access to the same documents. They do not overlap much.

| | MCP (this manual) | [memogit](./05-memogit-cli.md) |
|---|---|---|
| Local files | none | full checkout |
| Interaction with a code repo's git | none | conflicts if checked out inside one |
| Good for | reading/updating a few documents while working elsewhere | bulk edits, `grep`, cross-referencing, offline work |
| Version history | server-side snapshots (§10.7) | a real local git repo |
| Attachments | not exposed | downloaded one-way |

Rule of thumb: **reaching into the knowledge base from another project → MCP.
Working on the knowledge base itself → memogit.**

## 10.2 Setup

Create a personal access token in the web UI (user settings), then register the
server with Claude Code:

```bash
claude mcp add --transport http toucanshelf https://<your-instance>/mcp --header "Authorization: Bearer ${TOUCANSHELF_PAT}"

# Globally
claude mcp add --scope user --transport http toucanshelf https://<your-instance>/mcp --header "Authorization: Bearer ${TOUCANSHELF_PAT}"
```

Verify:

```bash
claude mcp list
```

Notes:

- **Keep the token out of git.** Put it in a shell environment variable and leave
  the `${TOUCANSHELF_PAT}` form in any config file.
- `claude mcp add` writes to `~/.claude.json` (all projects). To scope it to one
  project, put the same entry in that project's `.mcp.json`.
- The endpoint works behind a reverse proxy; only the path `/mcp` is required.
- **A PAT carries the whole account.** Tokens are not scoped, and `/mcp` adds no
  permission layer of its own — it reuses the REST API's authorization exactly.
  If you want to hand a token to several project directories, create a separate
  account that only joins the relevant knowledge bases.

## 10.3 The tool set

The server does **not** expose the full API. It publishes a hand-picked list,
because every tool's JSON schema sits in the model's context for the whole
session — a full export would cost tens of thousands of tokens before any work
starts.

| Tool | Use |
|---|---|
| `workspace_list_workspaces` | which knowledge bases exist; resolve a display name to `workspaces/{uid}` |
| `workspace_get_workspace_tree` | folder/document hierarchy |
| `rag_search` | hybrid semantic + keyword search ([§7](./07-api-reference.md)) |
| `memo_list_memos` | list documents by filter |
| `memo_get_memo` | read full content |
| `memo_create_memo` | create a document |
| `memo_update_memo` | replace a document's content |
| `auth_get_current_user` | who the token belongs to |

**There is no delete tool, deliberately.** Letting an agent delete documents buys
almost nothing and risks a lot.

Comments, reactions, relations, shortcuts, and attachments are not exposed
either — they belong to the upstream Memos social-notes surface, not to
knowledge-base authoring.

### What an agent may change on a document

`memo_update_memo` is one API operation, and that operation can in principle
write any field. Over the MCP channel it is restricted to six:

| Allowed | Why |
|---|---|
| `content`, `title` | authoring — the point of the tool |
| `folder_path`, `workspace`, `state`, `pinned` | filing. An archived or moved document has lost nothing, and you can undo either by hand. |

Everything else is rejected with a permission error. The ones worth naming:
**`visibility`** (an agent must not be able to make a private document public),
the **timestamps** (moving `update_time` backwards would strand a memogit
checkout on a stale copy without any error), **`attachments`** and
**`relations`**, **`doc_type`**, and the comment anchors.

Note that `state` allows **archiving**, which removes a document from the tree
and from lists. That is deliberate — it destroys nothing and is one click to
undo — but it is the one way an agent can make a document appear to vanish.

## 10.4 What the agent is told

The server sends an **instructions** block during MCP `initialize`, which Claude
Code injects into its system prompt. Without it the tool names alone
(`memo_get_memo`, `memo_update_memo`) read like a flat note API, and the agent has
no way to know this is a hierarchical knowledge base.

It covers four things the tool schemas cannot express:

1. The hierarchy: **workspace → folder tree → document**, and that a "memo" is a
   document.
2. The lookup order: `list_workspaces` → `get_workspace_tree` → `get_memo`, with
   `rag_search` when only the topic is known.
3. The addressing rules of §10.5 — resolve display names to `workspaces/{uid}`,
   folders materialize from the path, titles carry no extension.
4. That **`memo_update_memo` replaces the entire content field** — it is not an
   incremental patch, so the agent must read the document, edit the full text,
   and write it back.

That last point is the one that silently destroys documents when an agent assumes
otherwise.

**Anything that is true of every write belongs here, not in your prompt.** The
dividing line: unchanging operating knowledge goes in the instructions, and your
prompt carries only the intent for this particular task.

## 10.5 Addressing documents, and prompts that work

Three fields on a document determine where it lives:

| Field | Value | Notes |
|---|---|---|
| `workspace` | `workspaces/{uid}` | **not** the display name — resolve it via `workspace_list_workspaces` first |
| `folder_path` | `"folder a/folder b"` | slash-separated, relative to the workspace root; empty means root |
| `title` | `"plan"` | the display title, i.e. the filename — **without an extension** |

**Folders are implicit.** They are path prefixes ([README](./README.md)), so
writing a document to a path that does not exist yet makes the folders appear in
the tree. There is no "create folder" step and no folder tool in the set.

**Titles carry no extension.** The extension comes from `doc_type` and is only
added when memogit writes the document to disk as `<title>.<ext>`
([§5.1](./05-memogit-cli.md)). Passing `plan.md` as the title produces a document
literally named "plan.md", which memogit then checks out as `plan.md.md`.

**All three rules live in the server instructions (§10.4), so your prompt does not
have to restate them.** Saying what you want is enough:

```
Compress the high-quality information from this session into a document and
save it to the "<workspace name>" knowledge base under folder a/folder b via
the toucanshelf MCP, titled "plan".
```

The agent resolves the workspace name, creates the folders by writing to the
path, and leaves the title extensionless on its own. Spelling out the call
sequence in the prompt is redundant — and worse, it goes stale the moment the
tool set changes.

**When the document already exists, paste its address instead of describing it.**
The **⋯ menu** on any folder or document in the sidebar has **Copy → Copy info**,
which puts this on the clipboard:

```
Use the toucanshelf MCP to work on the document at the location below.

ToucanShelf document location
workspace: "Research notes" (workspaces/ws-abc123)
folder_path: "folder a/folder b"
title: "plan"
memo: memos/uid789

Read other related documents in this knowledge base when necessary.
```

Drop that block into your prompt and the agent can call `memo_get_memo` straight
away. It carries the address and nothing else — what to *do* with the document is
still yours to write above it. A folder copies the same block without the `title`
and `memo` lines.

Two habits worth keeping:

- **Ask to see the content first.** Write tools prompt for confirmation anyway
  (§10.6), but a long document is hard to review inside a tool-call parameter
  dialog.
- **For edits, expect a full rewrite.** `memo_update_memo` replaces the whole
  content field. The server instructions (§10.4) already tell the agent to read
  before writing, but a prompt that says "append a section" is still asking for a
  read-modify-write of the entire document, not a patch.

## 10.6 Permission allowlist

By default every MCP tool call asks for confirmation, which is noisy while
reading. Allow the read-only tools in `~/.claude/settings.json` or a project's
`.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "mcp__toucanshelf__workspace_list_workspaces",
      "mcp__toucanshelf__workspace_get_workspace_tree",
      "mcp__toucanshelf__memo_get_memo",
      "mcp__toucanshelf__rag_search"
    ]
  }
}
```

**Leave `memo_update_memo` and `memo_create_memo` out**, so writes keep prompting.

## 10.7 What protects your writing

### Human baseline snapshots

Documents you edit yourself do not create versions automatically — that stays a
manual action ([§1](./01-knowledge-base.md)). But when an **agent** writes through
MCP, the server checks whether the document's current content was last written by
a human. If it was, it snapshots that content into the version history **before**
applying the agent's write.

The consequence is that the history holds **one snapshot per human editing
session**, not one per agent iteration. An agent can rewrite a document fifty
times and add exactly one version: the state you last left it in. Those snapshots
are labelled **AI 编辑前** to distinguish them from versions you named yourself,
and you restore them the same way.

Rolling a document back counts as a human edit: the next agent write snapshots
the version you restored to before touching it.

A document only ever written by hand accumulates no automatic versions at all.

### There is no concurrency check — this part is on you

**Do not edit a document in the web UI while an agent is writing to it.** There is
no lock and no conflict detection. If you save an edit between the agent's read
and its write, your edit is silently overwritten, and once an agent session is
already open on that document the overwrite produces no snapshot either.

This is a deliberate trade-off, [recorded as ADR-5](../plans/2026-07-31-mcp-agent-authoring/requirement.md).
Sequence your work instead: let the agent finish, then edit.

The `.md` files that memogit checks out are unaffected — that channel has its own
conflict resolution ([§5.7a](./05-memogit-cli.md)).

## 10.8 Limits

- **No `@` mentions.** The server advertises tools only, not MCP *resources*, so
  you cannot attach a document with `@toucanshelf:<something>` in the composer.
  Everything happens through natural-language tool calls.
- **No path-addressed lookup in one call.** Each tool maps 1:1 onto an API
  operation, so reaching a document by path costs a tree call plus a get.
- **No folder filter on `memo_list_memos`.** `folder_path` is not yet part of the
  filter grammar, so "list everything under `architecture/`" goes through the
  workspace tree rather than one filtered list call.
- **No attachments, comments, or relations.** Read those in the web UI or through
  a memogit checkout.
