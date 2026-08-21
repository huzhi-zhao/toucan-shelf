package filter

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestCompileAcceptsStandardTagEqualityPredicate(t *testing.T) {
	t.Parallel()

	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)

	_, err = engine.Compile(context.Background(), `tags.exists(t, t == "1231")`)
	require.NoError(t, err)
}

func TestCompileRejectsLegacyNumericLogicalOperand(t *testing.T) {
	t.Parallel()

	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)

	_, err = engine.Compile(context.Background(), `pinned && 1`)
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to compile filter")
}

func TestCompileRejectsNonBooleanTopLevelConstant(t *testing.T) {
	t.Parallel()

	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)

	_, err = engine.Compile(context.Background(), `1`)
	require.EqualError(t, err, "filter must evaluate to a boolean value")
}

func TestCompileRejectsMalformedRegex(t *testing.T) {
	t.Parallel()

	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)

	_, err = engine.Compile(context.Background(), `content.matches("(")`)
	require.Error(t, err)
}

func TestCompileRejectsStartsWithOnUnsupportedField(t *testing.T) {
	t.Parallel()

	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)

	_, err = engine.Compile(context.Background(), `visibility.startsWith("P")`)
	require.Error(t, err)
	require.Contains(t, err.Error(), "does not support text matching")
}

func TestCompileContainsEscapesLikeWildcards(t *testing.T) {
	t.Parallel()

	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)

	stmt, err := engine.CompileToStatement(context.Background(), `content.contains("50%_off")`, RenderOptions{Dialect: DialectSQLite})
	require.NoError(t, err)
	// The % and _ in the value must be escaped so they are matched literally,
	// and SQLite needs an explicit ESCAPE clause.
	require.Contains(t, stmt.SQL, `ESCAPE '\'`)
	require.Equal(t, []any{`%50\%\_off%`}, stmt.Args)
}

// =============================================================================
// Cross-dialect rendering tests (no DB required; complements the SQLite-only
// behavioral tests in store/test by asserting MySQL/Postgres SQL generation).
// =============================================================================

func TestRenderStartsWith(t *testing.T) {
	t.Parallel()

	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)

	stmt, err := engine.CompileToStatement(context.Background(), `content.startsWith("TODO")`, RenderOptions{Dialect: DialectSQLite})
	require.NoError(t, err)
	for _, frag := range []string{"memos_unicode_lower(", "`memo`.`content`", `ESCAPE '\'`} {
		require.Contains(t, stmt.SQL, frag)
	}
	require.Equal(t, []any{"TODO%"}, stmt.Args)
}

func TestRenderEndsWith(t *testing.T) {
	t.Parallel()

	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)

	stmt, err := engine.CompileToStatement(context.Background(), `content.endsWith(".md")`, RenderOptions{Dialect: DialectSQLite})
	require.NoError(t, err)
	require.Equal(t, []any{"%.md"}, stmt.Args)
}

func TestRenderMatches(t *testing.T) {
	t.Parallel()

	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)

	stmt, err := engine.CompileToStatement(context.Background(), `content.matches("v[0-9]+")`, RenderOptions{Dialect: DialectSQLite})
	require.NoError(t, err)
	require.Contains(t, stmt.SQL, "`memo`.`content` REGEXP ?")
	require.Equal(t, []any{"v[0-9]+"}, stmt.Args)
}

func TestRenderTagsAll(t *testing.T) {
	t.Parallel()

	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)

	stmt, err := engine.CompileToStatement(context.Background(), `tags.all(t, t.startsWith("work/"))`, RenderOptions{Dialect: DialectSQLite})
	require.NoError(t, err)
	for _, frag := range []string{"NOT EXISTS", "json_each(", "!= '[]'", "memos_unicode_lower(value)"} {
		require.Contains(t, stmt.SQL, frag)
	}
	require.Equal(t, []any{"work/%"}, stmt.Args)
}

func TestRenderTextMatchEscaping(t *testing.T) {
	t.Parallel()

	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)

	// Both % and _ in the value must be escaped so they match literally.
	stmt, err := engine.CompileToStatement(context.Background(), `content.contains("a%b_c")`, RenderOptions{Dialect: DialectSQLite})
	require.NoError(t, err)
	require.Equal(t, []any{`%a\%b\_c%`}, stmt.Args)
}

func TestRenderAllRejectsUnsupportedPredicate(t *testing.T) {
	t.Parallel()

	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)

	// size() is not a valid per-element predicate inside all().
	_, err = engine.CompileToStatement(context.Background(), `tags.all(t, size(t) > 2)`, RenderOptions{Dialect: DialectSQLite})
	require.Error(t, err)
}

// The settings list of publicly linkable attachments is built entirely out of this
// filter, so the payload path it extracts is load-bearing: point it at the wrong key
// and the list quietly comes back empty while files stay on the open internet.
func TestCompileAttachmentAccessFilter(t *testing.T) {
	t.Parallel()

	engine, err := NewEngine(NewAttachmentSchema())
	require.NoError(t, err)

	stmt, err := engine.CompileToStatement(context.Background(), `access == "ACCESS_PUBLIC"`, RenderOptions{Dialect: DialectSQLite})
	require.NoError(t, err)
	require.Contains(t, stmt.SQL, "JSON_EXTRACT(`attachment`.`payload`, '$.access')")
	require.Equal(t, []any{"ACCESS_PUBLIC"}, stmt.Args)

	// Ordering comparisons on an enum name would compare strings alphabetically,
	// which means nothing; only equality is exposed.
	_, err = engine.Compile(context.Background(), `access > "ACCESS_INHERIT"`)
	require.Error(t, err)
}
