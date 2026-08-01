# MCP Server

This package serves an [OpenAPI](https://www.openapis.org/)-driven
[Model Context Protocol](https://modelcontextprotocol.io/) (MCP) endpoint at
`/mcp`. It exposes a curated, knowledge-base-focused toolset over the **Streamable HTTP**
transport using the official `github.com/modelcontextprotocol/go-sdk`.

The core design principle: **tool calls execute in-process against the existing
REST API.** The package owns no store or service logic of its own. Each tool is
derived from an operation in the generated OpenAPI document
(`proto/gen/openapi.yaml`, embedded via `proto.OpenAPIYAML()`), and a tool call
is translated into the matching `/api/v1/...` HTTP request and run against the
same Echo server that serves the public API. This keeps OpenAPI as the single
source of truth and reuses the API's authentication and authorization as-is.

## Integration

`server.NewServer` calls `mcp.NewMCPService` after registering the API, file, RSS, and gRPC-gateway routes, passing the same Echo server:

```go
mcpService, err := mcp.NewMCPService(profile, echoServer)
if err != nil {
    return nil, errors.Wrap(err, "failed to create MCP service")
}
mcpService.RegisterRoutes(echoServer)
```

The service advertises the **tools** capability only — no prompts, no resources.

## Startup flow

`NewMCPService` (`service.go`) wires everything up at construction time and fails
fast on any inconsistency:

1. `loadMCPServiceOpenAPISpec` parses the embedded `proto.OpenAPIYAML()` bytes
   into an `openAPISpec`.
2. `buildOperationRegistry` (`openapi.go`) indexes every operation by
   `operationId`, recording method, path, resolved request-body schema, and
   resolved 200 response schema.
3. `buildCuratedTools` (`catalog.go`) selects the allowlisted operation IDs and
   converts each into an `*sdkmcp.Tool` plus a `registeredOperation`. Missing
   IDs or duplicate tool names are construction errors.
4. Each tool is registered with `server.AddTool(tool, newMCPToolHandler(...))`.
5. `sdkmcp.NewStreamableHTTPHandler` wraps the server in stateless,
   JSON-response mode (no SSE, no session tracking).

## Request flow

`RegisterRoutes` binds `echoServer.Any("/mcp", ...)`. Each request:

1. `isAllowedMCPOrigin` (`origin.go`) rejects disallowed cross-origin browser requests with `403`.
2. The SDK streamable handler dispatches the MCP message.
3. On a `tools/call` request, `newMCPToolHandler` (`service.go`) decodes the JSON
   arguments into a map.
4. `validateToolArguments` (`validation.go`) checks them against the tool's
   input schema.
5. The caller's `Authorization` header is read from the request (`request.Extra.Header` on the SDK's `*sdkmcp.CallToolRequest`).
6. `apiAdapter.execute` (`adapter.go`) builds the API request
   (`buildAPIRequest`: path-parameter substitution, query encoding, JSON body),
   forwards the bearer token, and runs it against the Echo server through an
   `httptest.ResponseRecorder`.
7. The recorder body is decoded; a non-2xx status becomes a tool error
   (`newToolErrorResult`), otherwise the value is wrapped by
   `newStructuredToolResult`.

## Schema resolution

MCP tool schemas must be self-contained JSON Schema, but the OpenAPI components
use `$ref`. `openapi.go` resolves these into local definitions:

- **Top-level inlining.** The request-body and 200-response schemas for an
  operation are resolved with `inlineRef = true`, so the outermost `$ref` is
  expanded in place (`resolveSchemaRef` → `resolveSchemaValue` → `resolveSchemaMap`).
- **Nested refs become `$defs`.** Any `$ref` encountered below the top level is
  rewritten to a local `#/$defs/<Name>` pointer, and the referenced component is
  collected into a `$defs` map (`addSchemaDef`).
- **Cycle safety.** Recursive component schemas are handled by seeding
  `defs[name]` with a placeholder and tracking `resolving[name]` before
  recursing, so a schema that references itself terminates
  (`addSchemaDef`).

`catalog.go` then assembles the per-tool input schema in
`inputSchemaForOperation`:

- Path and query parameters become top-level properties; any required
  parameter stays in `required`.
- A request body becomes a single `body` property; a required body adds `body`
  to `required`. Body `$defs` are lifted to the schema's top-level `$defs`.
- The schema sets `"additionalProperties": false`.

The output schema is the operation's 200 `application/json` schema. When a 200
response has no JSON body, the fallback is:

```json
{ "type": "object", "properties": { "ok": { "type": "boolean" } } }
```

## Endpoint, transport & auth

- **Endpoint:** `POST /mcp` (the SDK may also use `GET`/`DELETE` on the same
  path for the Streamable HTTP transport).
- **Transport:** Streamable HTTP, **stateless**, JSON responses.
- **Auth:** the caller's `Authorization: Bearer <token>` header is forwarded to
  the in-process API request. Mutating tools therefore require a valid token
  (personal access token or access token); public reads may work without one,
  exactly as the REST API allows.
- **Origin safety:** `isAllowedMCPOrigin` allows a request when the `Origin`
  header is absent (desktop clients commonly omit it), when its host matches
  the request `Host` header (host comparison only — scheme is not checked), or
  when it matches the configured `profile.InstanceURL`. Anything else gets
  `403`. This guards against DNS-rebinding from browsers.

### Connecting a client

Point any Streamable HTTP MCP client at `https://<your-instance>/mcp` and supply
a personal access token as a bearer credential. Example client config:

```json
{
  "mcpServers": {
    "memos": {
      "type": "http",
      "url": "https://<your-instance>/mcp",
      "headers": {
        "Authorization": "Bearer <your-personal-access-token>"
      }
    }
  }
}
```

## Tool surface

The server exposes a curated allowlist of **8** operations
(`curatedOperationIDs` in `catalog.go`), scoped to knowledge-base authoring:
navigate the workspace tree, search, read a document, write one.

| OpenAPI operation | MCP tool | Purpose |
| --- | --- | --- |
| `WorkspaceService_ListWorkspaces` | `workspace_list_workspaces` | Which knowledge bases exist |
| `WorkspaceService_GetWorkspaceTree` | `workspace_get_workspace_tree` | Folder/document hierarchy |
| `RagService_Search` | `rag_search` | Hybrid full-text + semantic search |
| `MemoService_ListMemos` | `memo_list_memos` | Filtered bulk listing |
| `MemoService_GetMemo` | `memo_get_memo` | Read full content |
| `MemoService_CreateMemo` | `memo_create_memo` | Create a document |
| `MemoService_UpdateMemo` | `memo_update_memo` | Replace a document's content |
| `AuthService_GetCurrentUser` | `auth_get_current_user` | Read-only "whoami" — the single allowed auth/identity operation |

**Why so few.** The `tools/list` result is injected into the model's context when
the connection is established and stays resident there; it is not fetched per
call. These schemas are OpenAPI-derived and verbose (the `Memo` component alone
is ~7 KB in `proto/gen/openapi.yaml`, before the nested `Attachment` /
`Reaction` / `Relation` `$defs` are expanded into each tool's input schema).
Comments, reactions, shortcuts and the attachment surface were removed because
they cost resident context and serve the upstream "social scratch-note" model,
not this one. Do not add secret-block, IDP or instance-management operations
while you are in here.

**`MemoService_DeleteMemo` is deliberately excluded**, not an oversight: giving
an agent the ability to delete documents has near-zero upside and real downside.

**Naming rule** (`toolNameFromOperationID`): drop the `Service` suffix from the
subject and convert both subject and method from camelCase to snake_case, joined
by `_`. So `MemoService_ListMemos → memo_list_memos`.

**Annotations** (`annotationsForOperation`) start from the HTTP method:

| Method | ReadOnly | Destructive | Idempotent |
| --- | --- | --- | --- |
| GET | true | false | true |
| DELETE | false | true | true |
| other (POST, PATCH, …) | false | false | false |

A per-operation override (`readOnlyOperationIDs`) then corrects cases the method
heuristic gets wrong: `RagService_Search` is POST only because its query is too
large for a query string, so it reports `ReadOnlyHint: true` and
`IdempotentHint: true` and clients need not gate it behind a write confirmation.

## Server instructions

`serverInstructions` (`service.go`) is passed as `ServerOptions.Instructions` and
returned in the `initialize` response; clients that support the field inject it
into the model's system prompt.

It exists because the tool names and descriptions come from the OpenAPI spec,
which still speaks the upstream dialect — a "memo" is really a document in a
`workspace → folder tree → document` hierarchy — and says nothing about the write
semantics. The load-bearing line is that **`memo_update_memo` replaces the entire
content field**; an agent that treats it as an incremental patch silently
destroys the rest of the document.

Like `tools/list`, this text is resident context for the whole session, so keep
it a briefing rather than a manual: only what the model cannot infer from tool
names and schemas. `service_test.go` asserts both its presence and an upper
bound on its length.

`OpenWorldHint` is `false` for all tools. Annotations are client hints; they do
not replace API authorization.

**Result shape.** Every result carries object-shaped `structuredContent`
(`normalizeStructuredContent` in `result.go`):

- a JSON object is returned unchanged;
- an empty response becomes `{ "ok": true }`;
- a bare array becomes `{ "result": [...] }`;
- a scalar becomes `{ "result": value }`.

This is deliberate: it fixes [#6022](https://github.com/usememos/memos/issues/6022),
where collection tools returned a bare array that strict MCP clients reject.

## Error handling

Failures are returned as MCP tool errors (`CallToolResult` with `IsError: true`
and an `error.message` in `structuredContent`), not JSON-RPC protocol errors —
the handler returns `(result, nil)`:

| Failure | Result |
| --- | --- |
| Arguments are not valid JSON | tool error: decode message |
| Arguments fail schema validation | tool error: validation message |
| Missing required path parameter | tool error: `missing required path parameter "..."` |
| Missing required request body | tool error: `missing required request body "body"` |
| API responds non-2xx | tool error: `"<code> <reason phrase>: <api message>"` (e.g. `"404 Not Found: ..."`) (`apiErrorMessage`) |
| API response body is not decodable JSON | tool error: decode message |

## Core files

| File | Responsibility |
| --- | --- |
| `service.go` | Constructs the MCP server, carries the server instructions, registers tools, builds the streamable HTTP handler, and binds the `/mcp` route. |
| `catalog.go` | The curated operation allowlist, tool naming, input/output schema assembly, and method-derived annotations. |
| `adapter.go` | Translates a tool call into an `/api/v1/...` request and runs it in-process against the Echo server. |
| `openapi.go` | Parses the OpenAPI spec, builds the operation registry, and resolves `$ref` schemas into self-contained JSON Schema. |
| `validation.go` | Validates tool-call arguments against the tool's input schema. |
| `origin.go` | `Origin`-header check for browser DNS-rebinding safety. |
| `result.go` | Normalizes API responses into object-shaped `structuredContent` and builds error results. |

## Adding a tool

1. Add the OpenAPI `operationId` to `curatedOperationIDs` in `catalog.go`.
2. If the operation is **not** in the generated OpenAPI, add or adjust the
   proto/API surface first, then regenerate:

   ```bash
   cd proto && buf generate
   ```

3. Extend the tests in `catalog_test.go` / `service_test.go` to cover the new
   tool.

Never hand-edit `proto/gen/openapi.yaml` or other generated output — change the
proto definitions and regenerate.

## Testing

```bash
go test ./server/router/mcp/...
```

- `openapi_test.go` — spec parsing, registry building, `$ref` resolution.
- `catalog_test.go` — tool selection, naming, schema and annotation building.
- `adapter_test.go` — request construction and in-process execution (`adapter.go`), plus result normalization and error shaping (`result.go`).
- `validation_test.go` — argument validation against input schemas.
- `service_test.go` — the origin-header check, the `initialize` instructions,
  plus the end-to-end MCP protocol (`initialize`, `tools/list`, `tools/call`)
  confirming object-shaped `structuredContent`.

## Design notes

- **Two-layer input validation.** `validateToolArguments` runs a hand-rolled
  structural check (`validateSchemaValue`) and then the `google/jsonschema-go`
  validator. The first yields friendly messages; the second is the
  spec-complete backstop.
- **Embedded vs. file load.** Production reads the spec from
  `proto.OpenAPIYAML()` (`loadMCPServiceOpenAPISpec`). The path-based
  `loadOpenAPISpec` in `openapi.go` exists for tests.
- **Tools only.** The server advertises no prompts or resources in this version.
