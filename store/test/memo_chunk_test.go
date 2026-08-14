package test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/store"
)

func TestMemoChunkStoreAndFTS(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	user, err := createTestingHostUser(ctx, ts)
	require.NoError(t, err)

	memo, err := ts.CreateMemo(ctx, &store.Memo{
		UID:        "rag-memo-1",
		CreatorID:  user.ID,
		Content:    "机器学习是人工智能的一个分支",
		Visibility: store.Public,
	})
	require.NoError(t, err)

	// Creating a memo should enqueue an index job.
	pending := store.IndexJobStatusPending
	jobs, err := ts.ListMemoIndexJobs(ctx, &store.FindMemoIndexJob{Status: &pending})
	require.NoError(t, err)
	require.Len(t, jobs, 1)
	require.Equal(t, memo.ID, jobs[0].MemoID)

	// Write chunks (simulating the worker) and verify FTS + listing.
	err = ts.ReplaceMemoChunks(ctx, memo.ID, []*store.MemoChunk{
		{MemoID: memo.ID, WorkspaceID: memo.WorkspaceID, ChunkIndex: 0, Content: "机器学习是人工智能的一个分支"},
		{MemoID: memo.ID, WorkspaceID: memo.WorkspaceID, ChunkIndex: 1, Content: "深度学习使用神经网络"},
	})
	require.NoError(t, err)

	chunks, err := ts.ListMemoChunks(ctx, &store.FindMemoChunk{MemoID: &memo.ID})
	require.NoError(t, err)
	require.Len(t, chunks, 2)

	results, err := ts.SearchMemoChunksFTS(ctx, &store.ChunkFTSQuery{Query: "神经网络", Limit: 10})
	require.NoError(t, err)
	require.Len(t, results, 1)
	require.Equal(t, "深度学习使用神经网络", results[0].Content)

	// Replacing chunks should not leave stale FTS rows.
	err = ts.ReplaceMemoChunks(ctx, memo.ID, []*store.MemoChunk{
		{MemoID: memo.ID, ChunkIndex: 0, Content: "全新内容不含之前的词"},
	})
	require.NoError(t, err)
	results, err = ts.SearchMemoChunksFTS(ctx, &store.ChunkFTSQuery{Query: "神经网络", Limit: 10})
	require.NoError(t, err)
	require.Empty(t, results)

	// Deleting the memo should remove chunks and the job.
	err = ts.DeleteMemo(ctx, &store.DeleteMemo{ID: memo.ID})
	require.NoError(t, err)
	chunks, err = ts.ListMemoChunks(ctx, &store.FindMemoChunk{MemoID: &memo.ID})
	require.NoError(t, err)
	require.Empty(t, chunks)
}

func TestMemoChunkFTSTokenization(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	user, err := createTestingHostUser(ctx, ts)
	require.NoError(t, err)
	memo, err := ts.CreateMemo(ctx, &store.Memo{
		UID: "fts-tok", CreatorID: user.ID, Content: "x", Visibility: store.Public,
	})
	require.NoError(t, err)

	require.NoError(t, ts.ReplaceMemoChunks(ctx, memo.ID, []*store.MemoChunk{
		{MemoID: memo.ID, ChunkIndex: 0, Content: "deep learning uses neural networks"},
		{MemoID: memo.ID, ChunkIndex: 1, Content: "考试成绩很重要"},
	}))

	// Multiple terms are ANDed and order-independent (not a single literal phrase).
	res, err := ts.SearchMemoChunksFTS(ctx, &store.ChunkFTSQuery{Query: "networks deep", Limit: 10})
	require.NoError(t, err)
	require.Len(t, res, 1)

	// A term absent from every chunk fails the AND.
	res, err = ts.SearchMemoChunksFTS(ctx, &store.ChunkFTSQuery{Query: "deep missing", Limit: 10})
	require.NoError(t, err)
	require.Empty(t, res)

	// A 2-character CJK term (below the trigram minimum) still matches via LIKE fallback.
	res, err = ts.SearchMemoChunksFTS(ctx, &store.ChunkFTSQuery{Query: "考试", Limit: 10})
	require.NoError(t, err)
	require.Len(t, res, 1)

	// A document is returned at most once even when several chunks match.
	require.NoError(t, ts.ReplaceMemoChunks(ctx, memo.ID, []*store.MemoChunk{
		{MemoID: memo.ID, ChunkIndex: 0, Content: "alpha beta gamma"},
		{MemoID: memo.ID, ChunkIndex: 1, Content: "alpha beta delta"},
	}))
	res, err = ts.SearchMemoChunksFTS(ctx, &store.ChunkFTSQuery{Query: "alpha", Limit: 10})
	require.NoError(t, err)
	require.Len(t, res, 1)
}

func TestSearchMemosLike(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	user, err := createTestingHostUser(ctx, ts)
	require.NoError(t, err)

	// Term only in the title — must still be found (title is not chunked/indexed).
	titleMemo, err := ts.CreateMemo(ctx, &store.Memo{
		UID: "like-1", CreatorID: user.ID, Title: "Obligation overview", Content: "unrelated body", Visibility: store.Public,
	})
	require.NoError(t, err)
	// Term only in the body.
	bodyMemo, err := ts.CreateMemo(ctx, &store.Memo{
		UID: "like-2", CreatorID: user.ID, Content: "a contractual Obligation clause", Visibility: store.Public,
	})
	require.NoError(t, err)
	// No match at all.
	_, err = ts.CreateMemo(ctx, &store.Memo{
		UID: "like-3", CreatorID: user.ID, Content: "something else entirely", Visibility: store.Public,
	})
	require.NoError(t, err)

	results, err := ts.SearchMemosLike(ctx, &store.MemoLikeQuery{Query: "Obligation", Limit: 10})
	require.NoError(t, err)
	got := map[int32]bool{}
	for _, r := range results {
		got[r.MemoID] = true
	}
	require.True(t, got[titleMemo.ID], "expected title-only match")
	require.True(t, got[bodyMemo.ID], "expected body match")
	require.Len(t, results, 2)

	// Scoping to an explicit (empty) memo set yields nothing.
	empty, err := ts.SearchMemosLike(ctx, &store.MemoLikeQuery{Query: "Obligation", MemoIDs: []int32{}, Limit: 10})
	require.NoError(t, err)
	require.Empty(t, empty)

	// LIKE metacharacters are matched literally, not as wildcards.
	none, err := ts.SearchMemosLike(ctx, &store.MemoLikeQuery{Query: "Obl%tion", Limit: 10})
	require.NoError(t, err)
	require.Empty(t, none)
}

func TestMemoChunkEmbeddingRoundTrip(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	user, err := createTestingHostUser(ctx, ts)
	require.NoError(t, err)
	memo, err := ts.CreateMemo(ctx, &store.Memo{
		UID: "rag-memo-2", CreatorID: user.ID, Content: "x", Visibility: store.Public,
	})
	require.NoError(t, err)

	vec := []float32{0.1, -0.2, 0.3, 0.4}
	err = ts.ReplaceMemoChunks(ctx, memo.ID, []*store.MemoChunk{
		{MemoID: memo.ID, ChunkIndex: 0, Content: "embedded chunk", Embedding: vec, EmbeddingModel: "test-model"},
	})
	require.NoError(t, err)

	hasEmbedding := true
	chunks, err := ts.ListMemoChunks(ctx, &store.FindMemoChunk{MemoID: &memo.ID, HasEmbedding: &hasEmbedding})
	require.NoError(t, err)
	require.Len(t, chunks, 1)
	require.Equal(t, vec, chunks[0].Embedding)
	require.Equal(t, "test-model", chunks[0].EmbeddingModel)
	require.Equal(t, int32(4), chunks[0].EmbeddingDim)
}
