package v1

import (
	"context"
	"testing"

	"github.com/lithammer/shortuuid/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	"github.com/usememos/memos/internal/base"
	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/store"
)

// agentCtx marks a context as arriving over the MCP channel, the way the MCP
// adapter does for a real request.
func agentCtx(ctx context.Context) context.Context {
	return base.WithActorKind(ctx, base.ActorKindAgent)
}

func writeContent(t *testing.T, svc *APIV1Service, ctx context.Context, name, content string) {
	t.Helper()
	_, err := svc.UpdateMemo(ctx, &v1pb.UpdateMemoRequest{
		Memo:       &v1pb.Memo{Name: name, Content: content},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content"}},
	})
	require.NoError(t, err)
}

func listVersions(t *testing.T, svc *APIV1Service, ctx context.Context, name string) []*v1pb.MemoHistory {
	t.Helper()
	response, err := svc.ListMemoHistories(ctx, &v1pb.ListMemoHistoriesRequest{Parent: name})
	require.NoError(t, err)
	return response.MemoHistories
}

func memoPayload(t *testing.T, svc *APIV1Service, ctx context.Context, name string) *store.Memo {
	t.Helper()
	uid, err := ExtractMemoUIDFromName(name)
	require.NoError(t, err)
	memo, err := svc.Store.GetMemo(ctx, &store.FindMemo{UID: &uid})
	require.NoError(t, err)
	require.NotNil(t, memo)
	return memo
}

func newAuthoredMemo(t *testing.T, svc *APIV1Service, ctx context.Context, content string) *v1pb.Memo {
	t.Helper()
	memo, err := svc.CreateMemo(ctx, &v1pb.CreateMemoRequest{
		Memo: &v1pb.Memo{Content: content, Visibility: v1pb.Visibility_PRIVATE},
	})
	require.NoError(t, err)
	return memo
}

func newAuthor(t *testing.T, svc *APIV1Service) (context.Context, *store.User) {
	t.Helper()
	ctx := context.Background()
	user, err := svc.Store.CreateUser(ctx, &store.User{
		Username: "author-" + shortuuid.New(), Role: store.RoleAdmin, Email: shortuuid.New() + "@example.com",
	})
	require.NoError(t, err)
	return userCtx(ctx, user.ID), user
}

// The sequence from requirement.md ADR-3: the flag lives on the memo, not in
// the history table, which is what lets step 4 know that step 3 was a human
// edit even though step 3 created no version.
func TestAgentBaseline_HumanAgentHumanAgentSequence(t *testing.T) {
	svc := newIntegrationService(t)
	humanCtx, _ := newAuthor(t, svc)

	// 0. A human creates the document and writes two lines.
	memo := newAuthoredMemo(t, svc, humanCtx, "human draft")
	require.Empty(t, listVersions(t, svc, humanCtx, memo.Name))
	assert.False(t, memoPayload(t, svc, humanCtx, memo.Name).Payload.GetAgentSessionOpen())

	// 1. An agent takes over: V1 is the human's two lines.
	writeContent(t, svc, agentCtx(humanCtx), memo.Name, "agent pass 1")
	versions := listVersions(t, svc, humanCtx, memo.Name)
	require.Len(t, versions, 1)
	assert.Equal(t, "human draft", versions[0].Content)
	assert.Equal(t, agentBaselineVersionName, versions[0].DisplayName)
	assert.True(t, memoPayload(t, svc, humanCtx, memo.Name).Payload.GetAgentSessionOpen())

	// 2. Three more agent passes produce nothing: it is overwriting itself.
	for _, content := range []string{"agent pass 2", "agent pass 3", "agent pass 4"} {
		writeContent(t, svc, agentCtx(humanCtx), memo.Name, content)
	}
	require.Len(t, listVersions(t, svc, humanCtx, memo.Name), 1)

	// 3. The human edits. No version is created — but the session closes.
	writeContent(t, svc, humanCtx, memo.Name, "human revision")
	require.Len(t, listVersions(t, svc, humanCtx, memo.Name), 1)
	assert.False(t, memoPayload(t, svc, humanCtx, memo.Name).Payload.GetAgentSessionOpen())

	// 4. The agent comes back: V2 is the human's revision from step 3.
	writeContent(t, svc, agentCtx(humanCtx), memo.Name, "agent pass 5")
	versions = listVersions(t, svc, humanCtx, memo.Name)
	require.Len(t, versions, 2)
	contents := []string{versions[0].Content, versions[1].Content}
	assert.ElementsMatch(t, []string{"human draft", "human revision"}, contents)
	assert.True(t, memoPayload(t, svc, humanCtx, memo.Name).Payload.GetAgentSessionOpen())
}

// A document an agent never touches carries zero versioning overhead. Human
// edits are captured lazily — only when an agent actually comes for them.
func TestAgentBaseline_HumanOnlyEditingCreatesNoVersions(t *testing.T) {
	svc := newIntegrationService(t)
	humanCtx, _ := newAuthor(t, svc)

	memo := newAuthoredMemo(t, svc, humanCtx, "draft 0")
	for _, content := range []string{"draft 1", "draft 2", "draft 3", "draft 4"} {
		writeContent(t, svc, humanCtx, memo.Name, content)
	}

	assert.Empty(t, listVersions(t, svc, humanCtx, memo.Name))
	assert.False(t, memoPayload(t, svc, humanCtx, memo.Name).Payload.GetAgentSessionOpen())
}

// Snapshot count tracks human editing sessions, not agent iterations — this is
// the property that makes the scheme self-limiting and removes any need for a
// pruning policy.
func TestAgentBaseline_ManyAgentWritesCreateExactlyOneVersion(t *testing.T) {
	svc := newIntegrationService(t)
	humanCtx, _ := newAuthor(t, svc)

	memo := newAuthoredMemo(t, svc, humanCtx, "the human baseline")
	for i := range 10 {
		writeContent(t, svc, agentCtx(humanCtx), memo.Name, "agent iteration "+string(rune('a'+i)))
	}

	versions := listVersions(t, svc, humanCtx, memo.Name)
	require.Len(t, versions, 1)
	assert.Equal(t, "the human baseline", versions[0].Content)
}

// A document the agent created has no human content to protect, so it starts
// with the session open and its own iterations produce nothing.
func TestAgentBaseline_AgentCreatedMemoOpensSessionImmediately(t *testing.T) {
	svc := newIntegrationService(t)
	humanCtx, _ := newAuthor(t, svc)

	memo := newAuthoredMemo(t, svc, agentCtx(humanCtx), "agent draft")
	assert.True(t, memoPayload(t, svc, humanCtx, memo.Name).Payload.GetAgentSessionOpen())

	writeContent(t, svc, agentCtx(humanCtx), memo.Name, "agent draft v2")
	assert.Empty(t, listVersions(t, svc, humanCtx, memo.Name))

	// Once a human edits it, the usual protection applies.
	writeContent(t, svc, humanCtx, memo.Name, "human took it over")
	writeContent(t, svc, agentCtx(humanCtx), memo.Name, "agent again")
	versions := listVersions(t, svc, humanCtx, memo.Name)
	require.Len(t, versions, 1)
	assert.Equal(t, "human took it over", versions[0].Content)
}

// Regression guard for the one real bug found in the write-path audit
// (requirement.md §5): RestoreMemoHistory only ever wrote Content, so the flag
// would stay true and the agent's next write would overwrite the restored
// version without snapshotting it.
func TestAgentBaseline_RestoreClosesAgentSession(t *testing.T) {
	svc := newIntegrationService(t)
	humanCtx, _ := newAuthor(t, svc)

	memo := newAuthoredMemo(t, svc, humanCtx, "original human text")
	writeContent(t, svc, agentCtx(humanCtx), memo.Name, "agent rewrite")
	versions := listVersions(t, svc, humanCtx, memo.Name)
	require.Len(t, versions, 1)
	require.True(t, memoPayload(t, svc, humanCtx, memo.Name).Payload.GetAgentSessionOpen())

	// Save the agent's state so the restore precondition ("current state matches
	// some saved version") is met, then roll back to the human baseline.
	_, err := svc.CreateMemoHistory(humanCtx, &v1pb.CreateMemoHistoryRequest{
		Parent:      memo.Name,
		MemoHistory: &v1pb.MemoHistory{DisplayName: "agent state"},
	})
	require.NoError(t, err)

	restored, err := svc.RestoreMemoHistory(humanCtx, &v1pb.RestoreMemoHistoryRequest{Name: versions[0].Name})
	require.NoError(t, err)
	require.Equal(t, "original human text", restored.Content)
	assert.False(t, memoPayload(t, svc, humanCtx, memo.Name).Payload.GetAgentSessionOpen(),
		"a rollback is a human edit and must close the agent session")

	// The agent's next write must not silently overwrite the restored version.
	writeContent(t, svc, agentCtx(humanCtx), memo.Name, "agent rewrite again")
	assert.True(t, memoPayload(t, svc, humanCtx, memo.Name).Payload.GetAgentSessionOpen())
}

// The restored state is already recoverable through the version it was restored
// from, so the agent's next write must not duplicate it. Matching against every
// saved version, not just the newest, is what makes this hold.
func TestAgentBaseline_SkipsSnapshotWhenStateAlreadySaved(t *testing.T) {
	svc := newIntegrationService(t)
	humanCtx, _ := newAuthor(t, svc)

	memo := newAuthoredMemo(t, svc, humanCtx, "v1 content")
	_, err := svc.CreateMemoHistory(humanCtx, &v1pb.CreateMemoHistoryRequest{
		Parent:      memo.Name,
		MemoHistory: &v1pb.MemoHistory{DisplayName: "manual v1"},
	})
	require.NoError(t, err)

	writeContent(t, svc, agentCtx(humanCtx), memo.Name, "agent rewrite")
	versions := listVersions(t, svc, humanCtx, memo.Name)
	require.Len(t, versions, 1, "the current state was already saved manually; no duplicate baseline")
	assert.Equal(t, "manual v1", versions[0].DisplayName)
}

// Documents written before the field existed decode with the bool zero value,
// which means "human wrote this" — so the first agent write still snapshots.
// Getting this backwards would silently drop the baseline for every pre-existing
// document.
func TestAgentBaseline_LegacyMemoWithoutFieldSnapshotsOnFirstAgentWrite(t *testing.T) {
	svc := newIntegrationService(t)
	humanCtx, _ := newAuthor(t, svc)

	memo := newAuthoredMemo(t, svc, humanCtx, "legacy content")

	// Simulate a payload persisted before agent_session_open existed: the field
	// is simply absent, which unmarshals to false.
	stored := memoPayload(t, svc, humanCtx, memo.Name)
	stored.Payload.AgentSessionOpen = false
	require.NoError(t, svc.Store.UpdateMemo(humanCtx, &store.UpdateMemo{ID: stored.ID, Payload: stored.Payload}))

	writeContent(t, svc, agentCtx(humanCtx), memo.Name, "agent rewrite")
	versions := listVersions(t, svc, humanCtx, memo.Name)
	require.Len(t, versions, 1)
	assert.Equal(t, "legacy content", versions[0].Content)
}

// Only content writes are authorship. Pinning or toggling a view knob must not
// close an agent session — doing so would make the next agent write snapshot
// the agent's own output as if a human had written it.
func TestAgentBaseline_NonContentUpdatesLeaveSessionUntouched(t *testing.T) {
	svc := newIntegrationService(t)
	humanCtx, _ := newAuthor(t, svc)

	memo := newAuthoredMemo(t, svc, humanCtx, "human text")
	writeContent(t, svc, agentCtx(humanCtx), memo.Name, "agent text")
	require.True(t, memoPayload(t, svc, humanCtx, memo.Name).Payload.GetAgentSessionOpen())

	_, err := svc.UpdateMemo(humanCtx, &v1pb.UpdateMemoRequest{
		Memo:       &v1pb.Memo{Name: memo.Name, Pinned: true},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"pinned"}},
	})
	require.NoError(t, err)

	assert.True(t, memoPayload(t, svc, humanCtx, memo.Name).Payload.GetAgentSessionOpen(),
		"pinning is not authorship")
	assert.Len(t, listVersions(t, svc, humanCtx, memo.Name), 1)
}

// memogit and plain REST scripts carry the user's own token but do not come in
// over MCP; an unmarked write is a human write.
func TestAgentBaseline_UnmarkedWriteCountsAsHuman(t *testing.T) {
	svc := newIntegrationService(t)
	humanCtx, _ := newAuthor(t, svc)

	memo := newAuthoredMemo(t, svc, humanCtx, "human text")
	writeContent(t, svc, agentCtx(humanCtx), memo.Name, "agent text")
	require.True(t, memoPayload(t, svc, humanCtx, memo.Name).Payload.GetAgentSessionOpen())

	// An ordinary API write, e.g. a memogit push of locally edited content.
	writeContent(t, svc, humanCtx, memo.Name, "pushed from local git")
	assert.False(t, memoPayload(t, svc, humanCtx, memo.Name).Payload.GetAgentSessionOpen())
}
