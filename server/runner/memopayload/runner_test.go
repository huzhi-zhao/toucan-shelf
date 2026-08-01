package memopayload

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/internal/markdown"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

// The startup rebuild writes the entire Payload column back, so anything
// RebuildMemoPayload drops is lost for every memo in the instance. The failure
// is silent: agent_session_open resetting to false only surfaces later, as an
// agent overwriting human content without saving the baseline first (and
// node_overlays / doc_config would simply vanish). Pin the in-place behaviour so
// a refactor to `memo.Payload = &storepb.MemoPayload{...}` fails here.
func TestRebuildMemoPayloadPreservesUnrelatedPayloadFields(t *testing.T) {
	memo := &store.Memo{
		Content: "# Title\n\nbody with [a link](https://example.com)\n\n#plans",
		Payload: &storepb.MemoPayload{
			AgentSessionOpen: true,
			NodeOverlays:     map[string]string{"cell-1": `{"bold":true}`},
			DocConfig:        &storepb.MemoPayload_DocConfig{FullWidth: ptr(false)},
			Location:         &storepb.MemoPayload_Location{Placeholder: "somewhere"},
			Tags:             []string{"stale"},
		},
	}

	require.NoError(t, RebuildMemoPayload(context.Background(), memo, markdown.NewService(markdown.WithTagExtension())))

	assert.True(t, memo.Payload.GetAgentSessionOpen(), "agent session flag must survive a payload rebuild")
	assert.Equal(t, map[string]string{"cell-1": `{"bold":true}`}, memo.Payload.GetNodeOverlays())
	assert.False(t, memo.Payload.GetDocConfig().GetFullWidth())
	assert.Equal(t, "somewhere", memo.Payload.GetLocation().GetPlaceholder())

	// The derived fields are still recomputed from the content.
	assert.Equal(t, []string{"plans"}, memo.Payload.GetTags())
	assert.True(t, memo.Payload.GetProperty().GetHasLink())
	assert.Equal(t, "Title", memo.Payload.GetProperty().GetTitle())
}

func TestRebuildMemoPayloadInitializesMissingPayload(t *testing.T) {
	memo := &store.Memo{Content: "plain"}

	require.NoError(t, RebuildMemoPayload(context.Background(), memo, markdown.NewService(markdown.WithTagExtension())))

	require.NotNil(t, memo.Payload)
	// The zero value is the safe direction: an unmarked memo counts as
	// human-authored, so the next agent write snapshots it.
	assert.False(t, memo.Payload.GetAgentSessionOpen())
}

func ptr[T any](v T) *T { return &v }
