package v1

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"google.golang.org/protobuf/proto"

	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

func markdownCreate(config *storepb.MemoPayload_DocConfig) *store.Memo {
	return &store.Memo{DocType: "MARKDOWN", Payload: &storepb.MemoPayload{DocConfig: config}}
}

func TestApplySoftBreakCreationDefault(t *testing.T) {
	t.Run("agent markdown starts on soft wrapping", func(t *testing.T) {
		create := markdownCreate(nil)
		applySoftBreakCreationDefault(create, true)
		assert.True(t, create.Payload.DocConfig.GetSoftBreak())
	})

	t.Run("a human's document stays unset, so it follows their global default", func(t *testing.T) {
		create := markdownCreate(nil)
		applySoftBreakCreationDefault(create, false)
		assert.Nil(t, create.Payload.DocConfig)
	})

	t.Run("an explicit choice by the agent is left alone", func(t *testing.T) {
		create := markdownCreate(&storepb.MemoPayload_DocConfig{SoftBreak: proto.Bool(false)})
		applySoftBreakCreationDefault(create, true)
		assert.False(t, create.Payload.DocConfig.GetSoftBreak())
	})

	t.Run("other fields survive being defaulted around", func(t *testing.T) {
		create := markdownCreate(&storepb.MemoPayload_DocConfig{FullWidth: proto.Bool(false)})
		applySoftBreakCreationDefault(create, true)
		assert.False(t, create.Payload.DocConfig.GetFullWidth())
		assert.True(t, create.Payload.DocConfig.GetSoftBreak())
	})

	t.Run("non-markdown doc types have no line breaks to argue about", func(t *testing.T) {
		create := &store.Memo{DocType: "HTML", Payload: &storepb.MemoPayload{}}
		applySoftBreakCreationDefault(create, true)
		assert.Nil(t, create.Payload.DocConfig)
	})
}
