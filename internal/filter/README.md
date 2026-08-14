# Memo Filter Engine

This package houses the memo-only filter engine that turns standard CEL syntax
into SQL fragments for the subset of expressions supported by the memo schema.
The engine follows a three phase pipeline inspired by systems
such as Calcite or Prisma:

1. **Parsing** – CEL expressions are parsed with `cel-go` and validated against
   the memo-specific environment declared in `schema.go`. Only fields that
   exist in the schema can surface in the filter, and non-standard legacy
   coercions are rejected.
2. **Normalization** – the raw CEL AST is converted into an intermediate
   representation (IR) defined in `ir.go`. The IR is a dialect-agnostic tree of
   conditions (logical operators, comparisons, list membership, etc.). This
   step enforces schema rules (e.g. operator compatibility, type checks).
3. **Rendering** – the renderer in `render.go` walks the IR and produces a SQL
   fragment plus placeholder arguments. SQLite is the only supported dialect;
   `DialectName` / `DialectSQLite` are kept so that re-adding one later does not
   have to reintroduce the plumbing.

The entry point is `filter.DefaultEngine()` from `engine.go`. It lazily constructs
an `Engine` configured with the memo schema and exposes:

```go
engine, _ := filter.DefaultEngine()
stmt, _ := engine.CompileToStatement(ctx, `has_task_list && visibility == "PUBLIC"`, filter.RenderOptions{
	Dialect: filter.DialectSQLite,
})
// stmt.SQL  -> "(JSON_EXTRACT(`memo`.`payload`, '$.property.hasTaskList') IS TRUE AND `memo`.`visibility` = ?)"
// stmt.Args -> ["PUBLIC"]
```

## Core Files

| File          | Responsibility                                                                  |
| ------------- | ------------------------------------------------------------------------------- |
| `schema.go`   | Declares memo fields, their types, backing columns, CEL environment options     |
| `ir.go`       | IR node definitions used across the pipeline                                    |
| `parser.go`   | Converts CEL `Expr` into IR while applying schema validation                    |
| `render.go`   | Translates IR into SQL                                                          |
| `engine.go`   | Glue between the phases; exposes `Compile`, `CompileToStatement`, and `DefaultEngine` |
| `helpers.go`  | Convenience helpers for store integration (appending conditions)                |

## SQL Generation Notes

- **Placeholders** — `?`. The renderer tracks offsets to compose queries with
  pre-existing arguments.
- **JSON Fields** — Memo metadata lives in `memo.payload`, accessed via
  `JSON_EXTRACT` with boolean coercion.
- **Time Fields** — `created_ts`, `updated_ts`, and attachment `create_time` are
  CEL `timestamp` values. Express instants with the `now` variable,
  `duration("…")` (e.g. `created_ts >= now - duration("24h")`), or
  `timestamp("2006-01-02T15:04:05Z")` / `timestamp(<epoch-seconds>)`. These fold
  to epoch seconds at compile time — `now` is frozen once per compile (injectable
  for tests via the engine clock) — so the backing columns stay unchanged.
- **Tag Operations** — `tag in [...]` and `"tag" in tags` become JSON array
  predicates using `LIKE` patterns.
- **Boolean Flags** — Fields such as `has_task_list` render as `IS TRUE` equality
  checks.
- **String Matching** — `content.contains(x)`, `content.startsWith(x)`, and
  `content.endsWith(x)` render as case-insensitive `LIKE` with LIKE
  metacharacters (`%`, `_`, `\`) escaped. Available on scalar string fields whose
  schema sets `SupportsContains` (memo `content`; attachment `filename`,
  `mime_type`).
- **Regex** — `field.matches("pattern")` renders to `REGEXP`, resolved by the
  Go-backed `regexp` function registered in `store/db/sqlite/functions.go`.
  Patterns are validated at compile time against Go's RE2 via
  `cel.ValidateRegexLiterals()`.
- **Tag `all()` / `exists_one()`** — `tags.all(t, <pred>)` matches only non-empty
  tag sets where every element satisfies the predicate; `tags.exists_one(t,
  <pred>)` matches when exactly one element does (`COUNT(...) = 1`). Both iterate
  per-element via `json_each`.
- **Timestamp Accessors** — `created_ts.getFullYear()`, `getMonth()`, `getDate()`,
  `getDayOfMonth()`, `getDayOfWeek()`, `getDayOfYear()`, `getHours()`,
  `getMinutes()`, `getSeconds()` render to `strftime` date-part extraction.
  Results are normalized to CEL's base (0-based
  month, 0-based day-of-week with 0 = Sunday). The same accessors on `now` fold
  to literal date parts of the frozen evaluation time (UTC), so saved filters
  like `created_ts.getMonth() == now.getMonth() && created_ts.getDate() ==
  now.getDate()` ("on this day") re-resolve on every compile. Extraction is UTC,
  since the columns store epoch seconds. A timezone argument is not supported.
- **Set Operations** — `ext.Sets()`: `sets.contains(tags, [...])`,
  `sets.intersects(tags, [...])`, and `sets.equivalent(tags, [...])` desugar to
  exact-membership checks (AND / OR of `"v" in tags`); `equivalent` adds a
  `size(tags)` length check (relies on tags being a set).
- **`size()`** — `size(tags)` renders to JSON array length; `size(content)` (and
  other string fields) render to `LENGTH`, which counts code points on SQLite.
- **Arithmetic** — `+`, `-`, `*`, `/`, `%` constant-fold on literal/`now`/`duration`
  operands (division and modulo guard against a zero divisor).

## Typical Integration

1. Fetch the engine with `filter.DefaultEngine()`.
2. Call `CompileToStatement` with `filter.DialectSQLite`.
3. Append the emitted SQL fragment/args to the existing `WHERE` clause.
4. Execute the resulting query through the store driver.

The `helpers.AppendConditions` helper encapsulates steps 2–3 when a driver needs
to process an array of filters.
