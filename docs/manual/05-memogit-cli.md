# 5. memogit CLI — Check Out Your Knowledge Base as Files

Everything else in this manual is about working *inside* the app. `memogit` is
the opposite: a small command-line tool that **checks a knowledge base out to
local Markdown files**, so you (or an AI agent like Claude Code) can `grep`,
bulk-edit, and cross-reference documents with ordinary filesystem tools, then
sync changes back to the server.

It borrows git's vocabulary — `clone`, `pull`, `push`, `status` — but it does
**not** implement the git network protocol. It is a thin **DB ↔ local file**
bridge over the existing Memos API; version history is delegated to a real local
git repo that `memogit` initializes for you.

> **Status:** `login`, `clone`, `pull`, `push`, and `status` are implemented,
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
`.memogit/sync-state.json`, keyed by document ID. This keeps the files clean and
avoids a confusing second frontmatter block.

---

## 5.2 Layout of a checkout

```
my-kb/                        ← the checkout root (metadata only)
├── .memogit/
│   ├── config.yaml           ← server URL, token, bound workspace (chmod 600)
│   └── sync-state.json       ← per-document sync baseline (ID ↔ path, hashes…)
├── .git/                     ← a real local git repo (snapshots only, no remote)
├── .gitignore                ← excludes .memogit/config.yaml (it holds a token)
└── Default/                  ← document tree, in a subfolder named after the workspace
    ├── garden/notes/todo.md
    ├── papers/attention.pdf.md
    ├── dashboards/all.view.json
    └── _attachments/          ← downloaded attachment bytes, by attachment uid
        └── <uid>/attention.pdf
```

Documents live under a subfolder named after the workspace (`Default/` above),
so the checkout root holds only metadata and each knowledge base's notes sit
under their own named folder. Paths recorded in `sync-state.json` are relative
to that content subfolder. (If the workspace title has no filesystem-safe
characters, the subfolder falls back to `work/`.)

`.memogit/config.yaml` is git-ignored because it contains your Personal Access
Token; the rest of the tree (including `sync-state.json`) is tracked so your
baseline is captured in git history.

---

## 5.3 Install

`memogit` builds from the Memos repository as a single self-contained binary:

```bash
# From the repo root
go build -o memogit ./cmd/memogit/

# Put it on your PATH (either one)
cp memogit ~/bin/            # if ~/bin is on PATH
sudo cp memogit /usr/local/bin/
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

> **The `--server` URL must point at the Memos backend**, not a frontend dev
> server. See §5.12 if you're unsure which port that is.

---

## 5.5 Check out a knowledge base (`clone`)

```bash
# If your account has exactly one workspace, the name is optional:
memogit clone

# Otherwise name the workspace (its display title):
memogit clone Life

# Optionally restrict what gets pulled with a CEL filter:
memogit clone Life --filter '"work" in tags'
```

`clone`:

1. Resolves the workspace (by title) and records it in `config.yaml` so later
   `pull` reuses it.
2. Fetches **your own** documents in that workspace (see §5.8).
3. Writes each to `<workspace>/<folder_path>/<title>.<ext>` and downloads their
   attachments (§5.6a).
4. Runs `git init` and commits a **baseline snapshot**.

If the account has several workspaces and you don't name one, `clone` stops and
lists the candidates rather than guessing.

`clone` refuses to run if the directory has already been cloned — use `pull` to
update it.

---

## 5.6 Sync down changes (`pull`)

```bash
memogit pull
```

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
memogit push            # send local changes to the server
memogit push --dry-run  # print the plan without sending anything
```

`push` walks your local document tree, compares each file against the last-sync
baseline in `sync-state.json`, and reconciles with the server:

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
memogit status
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
workspace: workspaces/8650daea...     # set by clone
workspace_title: Default              # display only
filter: ""                            # optional CEL clause
```

**`.memogit/sync-state.json`** — the single source of truth for document
metadata: for each document ID, its local path, doc type, visibility, pin state,
relations (read-only export), downloaded attachments, and the server
`update_time` + content hash at last sync. `pull`/`push` compare against these
hashes to decide who changed.

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
