# 7. HTTP API Reference

This fork exposes a JSON/HTTP API generated from the gRPC service definitions in
`proto/api/v1`. Every RPC has an HTTP binding (via `google.api.http`
annotations), so you can drive the whole knowledge base — workspaces, documents,
search, and AI helpers — over plain REST.

This manual documents the **fork-specific** surface (Workspace, RAG search, AI
assistants, and the knowledge-base additions to `MemoService`). The upstream
Memos services (Auth, User, Attachment, Shortcut, Identity Provider, Instance)
are unchanged; see their `.proto` files for the full contract.

- **Base path:** all endpoints are under `/api/v1`.
- **Content type:** `application/json` for request and response bodies.
- **Source of truth:** `proto/api/v1/*.proto` and the generated
  `proto/gen/openapi.yaml`.

---

## 7.1 Conventions

**Resource names.** Following [AIP-122](https://google.aip.dev/122), objects are
addressed by resource name, not bare id:

| Resource | Name format |
|----------|-------------|
| Workspace | `workspaces/{workspace}` |
| Workspace folder | `workspaces/{workspace}/folders/{folder}` |
| Memo (document) | `memos/{memo}` |
| Memo share | `memos/{memo}/shares/{share}` |
| User | `users/{user}` |

**Custom methods.** Non-CRUD actions use a colon suffix on the collection or
resource (AIP-136), e.g. `POST /api/v1/rag:search`,
`POST /api/v1/ai:polishText`.

**Authentication.** Requests are authenticated with the same session cookie or
`Authorization: Bearer <access-token>` used by the rest of the Memos API. The
only unauthenticated endpoint here is `GET /api/v1/shares/{share_id}` (public
share links).

**Field masks.** `Update*` calls take an `update_mask` (comma-separated field
paths); only listed fields are written.

---

## 7.2 WorkspaceService

Backs the knowledge-base hierarchy (see
[Manual 1](./01-knowledge-base.md)). A workspace is a top-level knowledge base;
folders are slash-separated path prefixes; documents are memos.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| CreateWorkspace | `POST /api/v1/workspaces` | Create a knowledge base. |
| ListWorkspaces | `GET /api/v1/workspaces` | List the caller's workspaces. |
| GetWorkspace | `GET /api/v1/{name=workspaces/*}` | Fetch one workspace. |
| UpdateWorkspace | `PATCH /api/v1/{workspace.name=workspaces/*}` | Update (needs `update_mask`). |
| DeleteWorkspace | `DELETE /api/v1/{name=workspaces/*}` | Delete a workspace. |
| GetWorkspaceTree | `GET /api/v1/{name=workspaces/*}/tree` | Full folder + document tree. |
| CreateWorkspaceFolder | `POST /api/v1/{parent=workspaces/*}/folders` | Create an (empty) folder. |
| RenameWorkspaceFolder | `POST /api/v1/{parent=workspaces/*}/folders:rename` | Rename a folder (prefix update). |
| DeleteWorkspaceFolder | `POST /api/v1/{parent=workspaces/*}/folders:delete` | Delete a folder. |

**`Workspace` fields:** `name`, `title` (required), `creator` (out),
`create_time` / `update_time` (out), `sort_field`
(`createTime` | `updateTime` | `alphabetical`), `sort_order` (`asc` | `desc`),
`cover_color` (CSS color), `cover_image` (`attachments/{attachment}`),
`folders_first` (bool).

**Tree nodes** (`GetWorkspaceTree`) are `FOLDER` or `DOCUMENT`; each carries
`path`, and documents also carry `memo`, `archived`, `doc_type`, and timestamps.
Pass `?archived=true` to list archived documents instead of live ones.

```bash
curl -s /api/v1/workspaces \
  -H 'Content-Type: application/json' \
  -d '{"workspace": {"title": "Garden", "sort_field": "alphabetical"}}'
```

---

## 7.3 RagService — hybrid search

Backs global and in-library search (see [RAG design](../dev/rag-search.md)).
`Search` runs a fused full-text + semantic query over the memos the caller can
read.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| Search | `POST /api/v1/rag:search` | Hybrid search. |
| RebuildIndex | `POST /api/v1/rag:rebuildIndex` | Re-enqueue the whole index (owner only). |
| GetIndexStatus | `GET /api/v1/rag/indexStatus` | Index queue progress. |

**`SearchRequest`:**

- `query` (required) — the natural-language / keyword query.
- `scope` (oneof) — `global: true`, or `workspace: "workspaces/{id}"` to scope
  to one knowledge base.
- `mode` — `SEARCH_MODE_MIXED` | `KEYWORD` | `SEMANTIC` | `LIKE`. Unspecified
  falls back to the user's configured mode.
- `limit` — max hits (0 → user default).
- `filter` — a CEL expression (same grammar as `ListMemos.filter`) that
  constrains the **candidate set before ranking** (workspace, tag, visibility,
  time, `doc_type`, …). Put the keyword in `query`, **not** in
  `content.contains`, so semantic recall is preserved.

**`SearchResponse`:** `hits[]` (`memo`, `title`, `workspace`, `folder_path`,
`score`, `snippet`, `highlights[]`) and `effective_mode` (may downgrade to
`KEYWORD` when no embedding model is configured).

`GetIndexStatus` returns `pending` / `processing` / `failed` / `done` counts and
`embedding_configured` (whether semantic search is available).

```bash
curl -s /api/v1/rag:search -H 'Content-Type: application/json' -d '{
  "query": "postgres backup strategy",
  "workspace": "workspaces/ops",
  "mode": "SEARCH_MODE_MIXED",
  "limit": 20
}'
```

---

## 7.4 AIService — writing assistants

Instance-configured AI provider helpers used by the editor (see
[Manual 4](./04-md-editor-optimization.md)). All are custom `POST` methods.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| Transcribe | `POST /api/v1/ai:transcribe` | Transcribe an audio file to text. |
| FormatMarkdown | `POST /api/v1/ai:formatMarkdown` | Restructure plain text into Markdown, verbatim content. |
| PolishText | `POST /api/v1/ai:polishText` | Rewrite a selected span of text. |

**`PolishText`** takes `text` (required) plus either a free-form `instruction`
(e.g. "make it more formal") or, when that is empty, a named `preset`:
`polish` | `concise` | `expand` | `grammar` | `tone`. Returns the rewritten
`text`.

**`FormatMarkdown`** takes `text` (required) and optional `filename` for
context; returns `markdown`. **`Transcribe`** takes an `audio` object
(`content` bytes, optional `filename` / `content_type`) and returns `text`.

```bash
curl -s /api/v1/ai:polishText -H 'Content-Type: application/json' -d '{
  "text": "the meeting was good and we talked about stuff",
  "preset": "concise"
}'
```

---

## 7.5 MemoService — knowledge-base additions

Documents are memos. Upstream CRUD (`CreateMemo`, `ListMemos`, `GetMemo`,
`UpdateMemo`, `DeleteMemo`) is unchanged, but the `Memo` message gained
knowledge-base fields, and share links are new.

### New `Memo` fields

| Field | Type | Notes |
|-------|------|-------|
| `workspace` | string | `workspaces/{id}`. Optional on create → caller's default workspace. |
| `folder_path` | string | Slash-separated path within the workspace; empty = root. |
| `title` | string | Display title / "filename". Derived from the first H1 for Markdown if unset. |
| `doc_type` | enum | `MARKDOWN` (default) \| `HTML` \| `PDF` \| `VIEW`. |
| `pdf_annotation` | object | Set when the memo is a comment anchored to a PDF location. |
| `doc_anchor` | object | Set when the memo is a comment anchored to a document heading. |

`ListMemos.filter` accepts `doc_type` (`MARKDOWN | HTML | PDF | VIEW`) among its
CEL fields, so you can list e.g. only gallery views.

### Share links

Read-only public access to a single memo via an opaque bearer token.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| CreateMemoShare | `POST /api/v1/{parent=memos/*}/shares` | Mint a share link. |
| ListMemoShares | `GET /api/v1/{parent=memos/*}/shares` | List a memo's share links. |
| DeleteMemoShare | `DELETE /api/v1/{name=memos/*/shares/*}` | Revoke a share link. |
| GetMemoByShare | `GET /api/v1/shares/{share_id}` | **Unauthenticated.** Resolve a share token to its memo. |

A `MemoShare` has `name` (`memos/{memo}/shares/{share}`, where `{share}` is the
token used in the `/s/{share_id}` URL), `create_time`, and an optional
`expire_time` (unset = never expires).

```bash
# Create a link that expires in a week
curl -s /api/v1/memos/abc123/shares -H 'Content-Type: application/json' -d '{
  "memo_share": {"expire_time": "2026-07-25T00:00:00Z"}
}'
# Resolve it publicly
curl -s /api/v1/shares/<token>
```

---

## 7.6 SecretBlockService — encrypted blocks

Storage for the ciphertext behind `toucan-secret` blocks (see
[§6.5](./06-view-blocks.md)). The server is a dumb vault: it stores and returns
opaque envelopes produced by the browser and holds neither plaintext nor passphrase.
There is intentionally no RPC that could return plaintext.

| Method | HTTP | Notes |
|---|---|---|
| `CreateSecretBlock` | `POST /api/v1/secretBlocks` | Stores a client-encrypted envelope; the server assigns the uid |
| `GetSecretBlock` | `GET /api/v1/secretBlocks/{uid}` | Returns the envelope. Caller must own the record |
| `UpdateSecretBlock` | `PATCH /api/v1/secretBlocks/{uid}` | Replaces hint + envelope wholesale. No field mask: a partially updated envelope would be permanently undecryptable |
| `DeleteSecretBlock` | `DELETE /api/v1/secretBlocks/{uid}` | Permanent, no recovery |
| `ListSecretBlocks` | `GET /api/v1/secretBlocks` | **Metadata only** — name, hint, timestamps, ciphertext size |

Two constraints are load-bearing rather than incidental:

- **No method is public.** All require authentication, and lookups are scoped to the
  caller, so another user's uid simply finds nothing. This is why a publicly shared
  document's secret blocks stay closed for anonymous readers.
- **`ListSecretBlocks` never returns ciphertext.** It is a separate response message,
  and the query does not select those columns, so a later edit cannot start leaking
  them. Bulk-shipping ciphertext to a screen that only needs labels would hand out a
  ready-made offline brute-force corpus.

The server validates the envelope's suite (`pbkdf2-sha256` + `aes-256-gcm`) and
rejects a KDF iteration count below the supported floor, so a weakened envelope is
refused at write time rather than discovered when a user can no longer open it.

## 7.7 Other services

Unchanged from upstream Memos; see the proto files for details:

- **AuthService** — sign in / out, current user, token refresh.
- **UserService** — users, settings, PATs, webhooks, notifications, linked identities.
- **AttachmentService** — file uploads (the storage layer behind PDF / HTML docs and media).
- **ShortcutService**, **IdentityProviderService**, **InstanceService** — shortcuts, SSO, and instance-level settings / stats / backups (including `TestAIProvider`, which validates the provider the AI methods above use).
