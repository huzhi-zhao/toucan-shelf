# 5. memogit CLI — Check Out Your Knowledge Base as Files

Everything else in this manual is about working *inside* the app. `memogit` is
the opposite: a small command-line tool that **checks a knowledge base out to
local Markdown files**, so you (or an AI agent like Claude Code) can `grep`,
bulk-edit, and cross-reference documents with ordinary filesystem tools, then
sync changes back to the server. A checkout ships with its own agent manual
(§5.2a), so those agents learn the file format's rules before they touch
anything.

It borrows git's vocabulary — `clone`, `pull`, `push`, `status` — but it does
**not** implement the git network protocol. It is a thin **DB ↔ local file**
bridge over the existing Memos API; version history is delegated to a real local
git repo that `memogit` initializes for you.

> **Status:** `login`, `clone`, `pull`, `push`, `status`, and `agents` are implemented,
> with **one-way attachment download** (attachments and PDF bytes are pulled down
> so tools/LLMs have the full context) and **IDE-mergeable conflict resolution**
> via `.remote` sidecars (§5.7a). You can pull the knowledge base down, edit
> locally, and push changes back. Not yet available: attachment *upload* and
> relation write-back (see §5.11).

---

## 5.1 Core model (how the local tree maps to the server)

One **checkout directory = one workspace** (knowledge base). Documents live under
a subfolder named after the workspace (see §5.2), and within it each document is
written to a path that mirrors the server hierarchy:

```
<workspace>/<folder_path>/<title>.<ext>
```

- **`folder_path`** — the document's slash-separated folder path becomes the
  local directory (workspace-root documents land directly in the workspace
  subfolder).
- **`title`** — the document title becomes the filename.
- **`.<ext>`** — chosen by the document's `doc_type`:

| `doc_type` | Extension | Local file holds |
|------------|-----------|------------------|
| `MARKDOWN` | `.md` | the Markdown content, verbatim |
| `HTML` | `.html` | the raw HTML source |
| `PDF` | `.pdf.md` | a small reference stub linking to the downloaded PDF bytes under `_attachments/` (§5.6a) |
| `VIEW` | `.view.json` | the gallery view's configuration JSON |

The server enforces uniqueness on `(workspace, folder_path, title)`, so this path
is unique on its own — no ID is baked into the filename.

### Files hold your content, nothing else

`memogit` does **not** wrap files in its own metadata header. A document's file
contains exactly its content — including any Obsidian-style `---` frontmatter you
wrote yourself (the properties that feed Gallery Views). All bookkeeping
(document ID, doc type, visibility, sync hashes, relations) lives separately in
`.memogit/state/<workspace>.json`, keyed by document ID. This keeps files clean and
avoids a confusing second frontmatter block.

---

## 5.2 Layout of a checkout

```
my-kb/                        ← the checkout root (metadata only)
├── .memogit/
│   ├── config.yaml           ← server URL, token, cloned workspaces (chmod 600)
│   ├── state/                ← one sync baseline per knowledge base
│   │   ├── Default.json      ← (ID ↔ path, hashes…)
│   │   └── Life.json
│   └── skill/                ← the agent manual, written on clone/pull
│       ├── SKILL.md          ←   (router — the rules every edit must follow)
│       └── references/       ←   (one file per topic, read on demand)
├── .git/                     ← a real local git repo (snapshots only, no remote)
├── .gitignore                ← excludes .memogit/config.yaml (it holds a token)
├── AGENTS.md                 ← agent entry point (Codex, Cursor, …) — see §5.2a
├── CLAUDE.md                 ← agent entry point (Claude Code)
├── .cursor/rules/            ← agent entry point (Cursor project rule)
├── Default/                  ← one document tree per workspace, named after it
│   ├── AGENTS.md             ← same entry points, for agents started in here
│   ├── CLAUDE.md             ←   (they link up to ../.memogit/skill/SKILL.md)
│   ├── garden/notes/todo.md
│   ├── papers/attention.pdf.md
│   ├── dashboards/all.view.json
│   └── _attachments/         ← downloaded attachment bytes, by attachment uid
│       └── <uid>/attention.pdf
└── Life/
    └── journal/2026.md
```

One checkout root holds the server credentials once and tracks **any number of
that account's knowledge bases**, each in its own subfolder named after the
workspace, with its own sync baseline under `.memogit/state/`. The root itself
holds only metadata, and a single git repo covers every knowledge base, so one
commit history spans them all. Paths recorded in a state file are relative to
that workspace's content subfolder. (If a workspace title has no filesystem-safe
characters, its subfolder falls back to `work/`.)

`.memogit/config.yaml` is git-ignored because it contains your Personal Access
Token; the rest of the tree (including `.memogit/state/`) is tracked so your
baseline is captured in git history.

---

## 5.2a The checkout explains itself to AI coding agents

A checkout looks like an ordinary Markdown folder but isn't one: identity
markers, `.view.json` documents, PDF stubs and the pull/push contract are all
invisible to an agent that just starts editing files. So `clone` (and every
later `pull`) writes the agent manual and the entry points each tool reads by
itself:

| File | Read automatically by |
| --- | --- |
| `.memogit/skill/SKILL.md` + `references/*.md` | the full manual — the other three link to it |
| `AGENTS.md` | Codex, and any agent following the AGENTS.md convention |
| `CLAUDE.md` | Claude Code |
| `.cursor/rules/toucanshelf-memogit.mdc` | Cursor (`alwaysApply: true`) |

`.memogit/skill/` is a byte-for-byte copy of [`docs/skill/`](../skill/) —
**the** agent-facing documentation, shared with the [MCP channel](10-mcp-agent-access.md)
(§10.4) — compiled into the `memogit` binary at build time
(`internal/memogit/assets/skill/`, regenerated by
`scripts/sync-agent-skill-docs.sh`; never hand-edit the compiled copy). A
checkout carries its own instructions without needing this repository. The
three entry points hold a short brief — the identity-marker rule, "no
frontmatter header", the special document types, and the
`pull → edit → status → push` loop — plus a link to `SKILL.md`, which itself
links out to `references/*.md` for anything more specific, read on demand.

### One guide at the root, entry points in every knowledge base

The guide exists once, in `.memogit/`, because that is where the checkout's
identity lives. But an agent is usually started **inside one knowledge base**
(`my-kb/Default/`), not at the checkout root, so `AGENTS.md`, `CLAUDE.md` and
`.cursor/rules/` are written into each workspace subfolder as well, linking up
to `../.memogit/skill/SKILL.md` and stating which knowledge base the
folder is and where the credentials live. Nothing outside the entry points is
duplicated. (A `--sparse-checkout` clone maps its content onto the root itself,
so it gets the root copy only.)

`push` skips files named `AGENTS.md` and `CLAUDE.md` inside the content tree, so
these entry points are never uploaded as knowledge-base documents — **unless the
path is already a tracked document**. A knowledge base cloned before these files
existed may genuinely contain a document titled "AGENTS"; that document keeps
winning, memogit writes no entry point over it, and push still syncs it
normally.

### Upgrading a checkout made with an older memogit

Nothing to migrate — install the new binary and run either command in the
checkout root:

```bash
memogit pull      # syncs and writes the guide as a side effect
```

```bash
memogit agents    # just the guide + entry points, no network
```

Both are idempotent, and both leave anything you wrote outside the managed
blocks alone.

In `AGENTS.md` and `CLAUDE.md`, memogit only owns the text between its
`<!-- BEGIN memogit … -->` / `<!-- END memogit -->` markers. Add your own
project instructions above or below the block; they survive regeneration.

```bash
memogit agents
```

Rewrites all four files. `clone` and `pull` already do it — run this by hand for
a checkout made with an older memogit, or to restore a file you deleted.

---

## 5.3 Install

`memogit` builds from the Memos repository as a single self-contained binary.
Use `scripts/build-memogit.sh` rather than a bare `go build` — it syncs
`docs/skill/` into the embedded copy first (§5.2a), so the binary never ships
a stale agent manual:

```bash
# From the repo root
./scripts/build-memogit.sh && sudo cp ./build/memogit /usr/local/bin/
```

Verify:

```bash
memogit --help
```

---

## 5.4 Authenticate (`login`)

Generate a **Personal Access Token** in the app:
**Settings → My Account → Access Tokens → Create**. A PAT is long-lived and
suited to CLI use (no 15-minute refresh dance).

Then, from the directory you want to use as your knowledge-base checkout:

```bash
mkdir my-kb && cd my-kb
memogit login --server http://localhost:5230 --token memos_pat_xxxxxxxx
```

This writes `.memogit/config.yaml` (mode 600). Environment variables
`MEMOGIT_SERVER` / `MEMOGIT_TOKEN` override the file when set (useful for CI).

You can also skip this step: when you run `clone` in a directory that isn't
configured yet, it prompts for the server URL and token interactively and saves
them for you (see §5.5a).

> **The `--server` URL must point at the Memos backend**, not a frontend dev
> server. See §5.12 if you're unsure which port that is.

---

## 5.5 Check out a knowledge base (`clone`)

Knowledge bases are always addressed **by title** — you never need to know or
type a workspace id. To see what your account has and what is already checked
out here:

```bash
memogit workspaces      # alias: memogit ws
```

```
Knowledge bases for "james" on https://memos.example.com:

  ✓ MPNP                     → MPNP/
    Wuxia                    (not cloned — `memogit clone Wuxia`)

1 checked out here, 1 available to clone.
```

```bash
# If your account has exactly one workspace, the name is optional:
memogit clone

# Otherwise name the workspace (its display title):
memogit clone Life

# Optionally restrict what gets pulled with a CEL filter:
memogit clone Life --filter '"work" in tags'
```

`clone`:

1. Resolves the workspace (by title) and appends it to the `workspaces` list in
   `config.yaml` so later `pull`/`push` reuse it.
2. Fetches **your own** documents in that workspace (see §5.8).
3. Writes each to `<workspace>/<folder_path>/<title>.<ext>` and downloads their
   attachments (§5.6a).
4. Runs `git init` (once per root) and commits a **baseline snapshot**.

If the account has several workspaces and you don't name one, `clone` stops and
lists the candidates rather than guessing.

Run `clone` again in the same root to add another knowledge base alongside the
first — each lands in its own subfolder and existing ones are untouched:

```bash
cd my-kb
memogit clone Life      # adds Life/ next to Default/
```

`clone` refuses only if *that* workspace is already checked out here (or its
target directory is taken) — use `pull` to update it.

---

## 5.5a Sparse checkout — one folder into its own directory

Sometimes you don't want the whole knowledge base, just **one folder** of it,
checked out into a **dedicated directory** whose config lives *inside* it (rather
than alongside sibling workspaces under a shared root). That's a **sparse
checkout**. Two flags drive it in every case:

- **`--sparse-checkout <folder>`** — the server `folder_path` prefix to map. Only
  documents at that folder or beneath it are checked out.
- **`--dir <path>`** — the target directory. It becomes a **standalone checkout
  root**: `.memogit/`, `.gitignore`, and `.git` all live **inside** it, not in a
  parent. (You can use `--dir` on its own for a non-sparse checkout too, to place
  a knowledge base's root at a specific path — see §5.5 for a plain full-workspace
  checkout, which doesn't need any of this.)

A third flag, **`--sparse-subdir`**, picks between the two ways the mapped
folder can land locally. Both scenarios below check out the *same* folder; only
this flag differs.

### Scenario 1 — the folder becomes the checkout root (default)

```bash
cd /Users/Jimmy/
memogit clone Life --sparse-checkout Home --dir ./LifeHome
```

This checks out only the `Home` folder of the `Life` knowledge base into
`./LifeHome`, and nothing else is downloaded. If the directory has no config yet,
`clone` prompts on the console for the **server URL** and **token** (the token is
read without echo), saves them into `./LifeHome/.memogit/config.yaml`, and
continues — so you don't need a separate `login` step for a fresh directory.

The sparse folder prefix is **stripped** locally, so the target directory *is*
that folder — you don't get a redundant `Home/` nesting:

```
server folder_path            local file
──────────────────            ──────────────────────────
Home                (root)  → LifeHome/Index.md
Home/Journal/2024.md        → LifeHome/Journal/2024.md
Home/Recipes/Soup.md        → LifeHome/Recipes/Soup.md
Work/... (out of scope)       not checked out
```

Layout of the example above:

```
LifeHome/                     ← the sparse checkout root (== the Home folder)
├── .memogit/
│   ├── config.yaml
│   └── state/
│       └── Life.json         ← state file named after the workspace
├── .git/  .gitignore
├── Index.md                  ← Home/Index.md, prefix stripped
├── Journal/2024.md
└── Recipes/Soup.md
```

In `config.yaml` a sparse workspace records the folder prefix and a content dir
of `.`:

```yaml
workspaces:
  - workspace: workspaces/8650daea...
    workspace_title: Life
    dir: "."                 # content sits at the root itself
    name: Life                # identifies the state file (dir "." can't)
    sparse: Home              # the mapped server folder, stripped locally
```

Use this when you want the checkout to read like its own small, self-contained
knowledge base — the destination directory *is* the folder, nothing above it.

### Scenario 2 — keep the folder's own path (`--sparse-subdir`)

```bash
cd /Users/Jimmy/
memogit clone Life --sparse-checkout Home/Journal --sparse-subdir --dir ./LifeHome
```

Same idea, but this time the mapped folder (`Home/Journal`, one level deeper to
show it isn't limited to top-level folders) keeps its **own path** under the
checkout root instead of being promoted to it — the local tree mirrors the
server `folder_path` exactly, just scoped to that subtree:

```
server folder_path                   local file
───────────────────                  ─────────────────────────────────
Home/Journal            (root)     → LifeHome/Home/Journal/Index.md
Home/Journal/2024.md               → LifeHome/Home/Journal/2024.md
Home/Recipes/... (out of scope)      not checked out
```

```
LifeHome/
├── .memogit/
│   ├── config.yaml
│   └── state/
│       └── Life.json
├── .git/  .gitignore
└── Home/
    └── Journal/
        ├── Index.md
        └── 2024.md
```

```yaml
workspaces:
  - workspace: workspaces/8650daea...
    workspace_title: Life
    dir: "."                 # content still sits at the root itself
    name: Life                # identifies the state file (dir "." can't)
    sparse: Home/Journal      # the mapped server folder, kept (not stripped)
    sparse_subdir: true
```

Use this when the checkout is meant to sit *inside* something else — e.g. handed
to an agent that also needs to reason about where the folder lives in the
knowledge base, or kept ready to compare 1:1 against the server's `folder_path`
later.

### Both scenarios, in every case

`pull`, `push`, and `status` all honor the scope automatically — no extra flags,
and the same in both scenarios:

- `pull` only brings down documents under the mapped folder; a document that is
  **moved out** of it on the server is reconciled as a local removal.
- `push` derives the right server `folder_path` for new documents from their
  local path — re-adding the stripped prefix in scenario 1, or using the local
  path as-is in scenario 2 — so a new file always lands back under the mapped
  folder on the server.

A sparse checkout is a standalone, single-folder root; run `pull`/`push`/`status`
from inside it (they find `.memogit` by walking up).

> **Note:** the server's folder scoping is applied **client-side** (its query
> filter has no `folder_path` support), so `clone`/`pull` list the workspace and
> then keep only in-scope documents. The *content* of out-of-scope documents is
> never written to disk.

---

## 5.6 Sync down changes (`pull`)

```bash
# Every knowledge base in this checkout:
memogit pull

# Just one, by workspace title:
memogit pull Life
```

With no argument `pull` syncs every cloned knowledge base in turn. Naming a
workspace that isn't cloned here is an error, so a typo never silently syncs a
different one.

`pull` fetches everything changed on the server since the last sync
(incrementally, by update time), reconciles it against your local files, and
makes a git commit. For each changed document:

| Situation | What `pull` does |
|-----------|------------------|
| New on server | writes the file (`+`) |
| Changed on server, unchanged locally | overwrites the file, relocating it if its folder/title changed (`~`) |
| Changed on **both** sides | **conflict** (`⚠`) — keeps your file, writes the server version to `<path>.remote` for you to merge (see §5.7a) |
| Local file deleted | skipped (`!`), to be resolved on a future `push` |
| Deleted/archived on server | removes the local file (`-`); if the file has unpushed local edits it is **kept** and reported for you to resolve |

`pull` reconciles server-side deletions by doing a full current listing after
the incremental fetch: any tracked document that no longer exists (deleted or
archived) is removed locally, along with its downloaded attachments — unless you
have unpushed edits to it, in which case the file is left in place.

`pull` also downloads any new/changed attachments for the documents it touches
(see §5.6a), reporting the count.

### 5.6a Attachments (one-way download)

`clone` and `pull` download every document's attachments — images, PDFs, audio,
any uploaded file — into a per-workspace `_attachments/<attachment-uid>/<filename>`
folder, so local tools and LLMs can read the full context of a note. Downloads
are **one-way**: bytes are pulled *down* only, never uploaded back, and are
skipped when an unchanged copy already exists locally.

- **PDF documents** (`.pdf.md`) are a reference stub with no editable body; the
  stub now links to the downloaded PDF bytes under `_attachments/`.
- **Inline images/attachments** in Markdown keep their original in-content
  reference (memogit does **not** rewrite the reference — rewriting would make
  the file look locally edited and trigger false push conflicts). The bytes are
  downloaded alongside so you can open them by attachment uid.

## 5.7 Sync local edits back (`push`)

```bash
memogit push            # send local changes from every knowledge base
memogit push Life       # just one, by workspace title
memogit push --dry-run  # print the plan without sending anything
```

`push` walks your local document tree, compares each file against the last-sync
baseline in `.memogit/state/<dir>.json`, and reconciles with the server:

| Situation | What `push` does |
|-----------|------------------|
| New local file | creates a memo (`+`), deriving `folder_path`/`title`/`doc_type` from the path & extension; visibility defaults to PRIVATE |
| Edited tracked file, server unchanged | updates the memo's content (`~`, `update_mask=[content]`) |
| Edited on **both** sides | **conflict** (`⚠`) — keeps your file, writes the server version to `<path>.remote` for you to merge (see §5.7a) |
| Tracked file deleted locally | **archives** the memo (`-`, soft delete — recoverable, never a hard delete) |
| PDF stubs & downloaded attachments | ignored (generated / download-only) |

Before overwriting a changed memo, `push` re-reads the server copy: if it also
changed since your last sync, that file becomes a conflict — your local file is
left untouched and the server version is written to `<path>.remote` for you to
merge (§5.7a) rather than clobbering either side. On success `push` updates the
baseline and makes a git commit. **`push` never uploads attachments** and never
hard-deletes.

### 5.7a Resolving conflicts with your editor (the `.remote` sidecar)

When either `pull` or `push` detects a conflict (a document changed on both
sides), memogit writes the **server's version** next to your file as
`<path>.remote`, so you can merge in your IDE — memos is a REST API, not a git
remote, so `git fetch` can't produce this "theirs" side; memogit materializes it
for you. These sidecars are git-ignored.

To resolve:

1. Open `foo.md` (yours) and `foo.md.remote` (the server's) and diff/merge them
   in your editor (e.g. IntelliJ → select both → **Compare Files**). Edit `foo.md`
   into the merged result you want.
2. **Delete `foo.md.remote`.** Its absence is how memogit knows you've resolved.
3. Run `memogit push`. It confirms the server hasn't changed again, pushes your
   merged `foo.md`, and advances the baseline. (If the server *did* change again
   in the meantime, a fresh `foo.md.remote` is written and you merge once more.)

While `foo.md.remote` still exists, `push` treats the document as an unresolved
conflict and skips it.

---

## 5.8 Why only *your* documents?

Memos' visibility model lets any signed-in user read another user's `PROTECTED`
or `PUBLIC` documents (this is the sharing/Explore feature — a PAT doesn't change
it). So `memogit` deliberately scopes `clone`/`pull` to documents **you created**
(`creator == <your-username>`). Without that, your local knowledge base would
fill up with other people's shared notes that you can't sync back anyway.

---

## 5.9 See what's out of sync (`status`)

```bash
memogit status          # every knowledge base in this checkout
memogit status Life     # just one, by workspace title
```

`status` is read-only: it queries the server and compares against your local
tree and the sync baseline, then prints two layers of information:

- **Local changes to push** — files you modified (`~`), added (`+`), or deleted
  (`-`, will archive on push).
- **Remote changes to pull** — documents updated (`~`), added (`+`), or
  deleted/archived (`-`) on the server since your last sync.
- **Conflicts** (`⚠`) — documents changed on both sides; resolve them with the
  `.remote` sidecar workflow (§5.7a).

It also reports the number of uncommitted entries in the local git working tree,
so the two notions of "status" (memogit sync state vs. `git status`) stay
distinct. `status` never writes anything.

---

## 5.10 Config & state files

**`.memogit/config.yaml`**

```yaml
server: http://localhost:5230
token: memos_pat_xxxxxxxx
workspaces:                             # appended to by each clone
  - workspace: workspaces/8650daea...
    workspace_title: Default            # selects this KB on the command line
    dir: Default                        # checkout subfolder, fixed at clone time
    filter: ""                          # optional CEL clause, per workspace
  - workspace: workspaces/91f2c0bb...
    workspace_title: Life
    dir: Life
```

`workspace` (the resource id) is recorded by `clone` — you never type it. It is
the **stable anchor**: titles can be changed on the server, ids cannot. Tracking
by id means a renamed knowledge base stays bound to the same local files, and
`pull` simply refreshes the recorded `workspace_title`:

```
  workspace renamed on the server: "MPNP" → "Immigration" (folder MPNP/ unchanged)
```

The checkout folder keeps its original name on purpose — renaming it would move
every tracked file and break git history. `dir` is likewise fixed at clone time.

Were the binding by title instead, a server-side rename would break the
checkout, and — worse — creating a *new* knowledge base with the old title would
silently redirect the sync to it. If a tracked workspace is deleted on the
server, `pull` says so and leaves your local files alone rather than treating it
as "every document was deleted".

**`.memogit/state/<dir>.json`** — one per knowledge base, the single source of
truth for document metadata: for each document ID, its local path, doc type,
visibility, pin state, relations (read-only export), downloaded attachments, and
the server `update_time` + content hash at last sync. `pull`/`push` compare
against these hashes to decide who changed.

> **Upgrading from a single-workspace checkout:** the first command you run
> migrates it automatically — the old top-level `workspace:` keys fold into the
> `workspaces` list and `.memogit/sync-state.json` moves to
> `.memogit/state/<dir>.json`. Your document folder is already in the right
> place and is not touched.

---

## 5.11 What's not implemented yet

| Feature | Status |
|---------|--------|
| Attachment **upload** (local → server) | planned (download is one-way for now) |
| Relations written back to the server | out of scope for v1 (read-only export) |

Conflict resolution *is* supported via the `.remote` sidecar (see §5.7a) — your
IDE does the merge, memogit supplies the server's version.

---

## 5.12 Troubleshooting

**`connection refused` on `clone`/`pull`.** The `--server` port is wrong or
points at the frontend. Find the **backend** port:

```bash
lsof -nP -iTCP -sTCP:LISTEN | grep -i memos    # e.g. "memos ... TCP *:8081 (LISTEN)"
ps aux | grep -i memos                          # look for --port
```

A dev setup often runs the Vite **frontend** on one port (e.g. 3001) and the
Memos **backend** on another (e.g. 8081); `memogit` must target the backend. If
you see `dial tcp [::1]:<port>: connection refused`, that's an ordinary refused
connection to the IPv6 `localhost` — fix the port, then re-run `login` with the
correct `--server`. Confirm connectivity first with:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8081/api/v1/workspaces \
  -H "Authorization: Bearer memos_pat_xxxxxxxx"     # expect 200
```

**`clone` reports "Cloned 0 memos".** The workspace resolved and authenticated,
but no documents matched. If you built the binary before 2026-07-16, this was a
`creator`-filter bug (it queried the bare username instead of the `users/…`
resource name) — rebuild from source. If it persists on a current build, the
documents may not be associated with the named workspace yet. Check without the
workspace filter:

```bash
curl -s -G http://localhost:8081/api/v1/memos \
  --data-urlencode 'filter=creator == "YourUsername"' \
  -H "Authorization: Bearer memos_pat_xxxxxxxx" | head -c 500
```

If that returns documents but `clone` doesn't, the documents need to be assigned
to a workspace in the app first.

**Re-login to change server/token.** Just run `memogit login …` again; it
overwrites `.memogit/config.yaml`.

**No `AGENTS.md` / `CLAUDE.md` in the checkout.** The checkout predates them, or
they were deleted. Run `memogit agents` in the checkout root (§5.2a) — it needs
no network. If one folder stays empty, check the command's output: memogit
refuses to overwrite a path that is one of your own documents, and says so.

**An agent edited files without following the rules anyway.** The entry points
carry a short brief and a link; the full guide is only read if the agent follows
that link. For a large or risky refactor, tell it explicitly to read
`.memogit/skill/SKILL.md` first, and check `memogit status` before pushing.
