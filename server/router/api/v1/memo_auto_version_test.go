package v1

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/lithammer/shortuuid/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/store"
)

// autoSave writes content the way the editor's auto-save does, with the session
// position it would send.
func autoSave(t *testing.T, svc *APIV1Service, ctx context.Context, name, content string, mode v1pb.UpdateMemoRequest_AutoSave) {
	t.Helper()
	_, err := svc.UpdateMemo(ctx, &v1pb.UpdateMemoRequest{
		Memo:       &v1pb.Memo{Name: name, Content: content},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content"}},
		AutoSave:   mode,
	})
	require.NoError(t, err)
}

// seedAutoVersion writes an auto version dated `age` ago. Retention and the
// throttle both key off created_ts, and neither is reachable by waiting in a
// test, so the rows are planted directly.
func seedAutoVersion(t *testing.T, svc *APIV1Service, ctx context.Context, memoID int32, content string, age time.Duration) {
	t.Helper()
	_, err := svc.Store.CreateMemoHistory(ctx, &store.MemoHistory{
		UID:       shortuuid.New(),
		MemoID:    memoID,
		Content:   content,
		Source:    store.MemoHistoryAuto,
		CreatedTs: time.Now().Add(-age).Unix(),
	})
	require.NoError(t, err)
}

func versionsBySource(histories []*v1pb.MemoHistory, source v1pb.MemoHistory_Source) []*v1pb.MemoHistory {
	matched := []*v1pb.MemoHistory{}
	for _, h := range histories {
		if h.Source == source {
			matched = append(matched, h)
		}
	}
	return matched
}

// A save the user pressed is not versioned: they watched themselves write it.
func TestAutoVersion_ManualSaveWritesNoVersion(t *testing.T) {
	svc := newIntegrationService(t)
	ctx, _ := newAuthor(t, svc)

	memo := newAuthoredMemo(t, svc, ctx, "draft")
	writeContent(t, svc, ctx, memo.Name, "edited by hand")

	assert.Empty(t, listVersions(t, svc, ctx, memo.Name))
}

// The scenario the feature exists for: content is cut out of a document left
// open, auto-save commits it, and the original has to still be somewhere.
func TestAutoVersion_SessionStartKeepsOverwrittenContent(t *testing.T) {
	svc := newIntegrationService(t)
	ctx, _ := newAuthor(t, svc)

	memo := newAuthoredMemo(t, svc, ctx, "the whole document")
	autoSave(t, svc, ctx, memo.Name, "", v1pb.UpdateMemoRequest_AUTO_SAVE_SESSION_START)

	versions := listVersions(t, svc, ctx, memo.Name)
	require.Len(t, versions, 1)
	assert.Equal(t, "the whole document", versions[0].Content)
	assert.Equal(t, v1pb.MemoHistory_AUTO, versions[0].Source)
	// Unnamed on the wire: the client labels it from its source.
	assert.Empty(t, versions[0].DisplayName)
}

// Auto-save ticks every 30s; versioning each one would bury the list.
func TestAutoVersion_PeriodicTickIsThrottled(t *testing.T) {
	svc := newIntegrationService(t)
	ctx, _ := newAuthor(t, svc)

	memo := newAuthoredMemo(t, svc, ctx, "v0")
	autoSave(t, svc, ctx, memo.Name, "v1", v1pb.UpdateMemoRequest_AUTO_SAVE_SESSION_START)
	autoSave(t, svc, ctx, memo.Name, "v2", v1pb.UpdateMemoRequest_AUTO_SAVE_PERIODIC)
	autoSave(t, svc, ctx, memo.Name, "v3", v1pb.UpdateMemoRequest_AUTO_SAVE_PERIODIC)

	versions := listVersions(t, svc, ctx, memo.Name)
	require.Len(t, versions, 1)
	assert.Equal(t, "v0", versions[0].Content)
}

func TestAutoVersion_PeriodicTickResumesAfterInterval(t *testing.T) {
	svc := newIntegrationService(t)
	ctx, _ := newAuthor(t, svc)

	memo := newAuthoredMemo(t, svc, ctx, "current")
	memoID := memoPayload(t, svc, ctx, memo.Name).ID
	seedAutoVersion(t, svc, ctx, memoID, "an hour ago", time.Hour)

	autoSave(t, svc, ctx, memo.Name, "next", v1pb.UpdateMemoRequest_AUTO_SAVE_PERIODIC)

	versions := listVersions(t, svc, ctx, memo.Name)
	require.Len(t, versions, 2)
	assert.Equal(t, "current", versions[0].Content)
}

// Nothing is versioned twice: a state already recoverable from a named version
// does not also become an automatic one.
func TestAutoVersion_SkipsStateAlreadyRecoverable(t *testing.T) {
	svc := newIntegrationService(t)
	ctx, _ := newAuthor(t, svc)

	memo := newAuthoredMemo(t, svc, ctx, "reviewed")
	_, err := svc.CreateMemoHistory(ctx, &v1pb.CreateMemoHistoryRequest{
		Parent:      memo.Name,
		MemoHistory: &v1pb.MemoHistory{DisplayName: "reviewed draft"},
	})
	require.NoError(t, err)

	autoSave(t, svc, ctx, memo.Name, "changed", v1pb.UpdateMemoRequest_AUTO_SAVE_SESSION_START)

	versions := listVersions(t, svc, ctx, memo.Name)
	require.Len(t, versions, 1)
	assert.Equal(t, v1pb.MemoHistory_MANUAL, versions[0].Source)
}

func TestAutoVersion_RetentionKeepsNewestAutoVersionsOnly(t *testing.T) {
	svc := newIntegrationService(t)
	ctx, _ := newAuthor(t, svc)

	memo := newAuthoredMemo(t, svc, ctx, "reviewed")
	memoID := memoPayload(t, svc, ctx, memo.Name).ID
	_, err := svc.CreateMemoHistory(ctx, &v1pb.CreateMemoHistoryRequest{
		Parent:      memo.Name,
		MemoHistory: &v1pb.MemoHistory{DisplayName: "named by hand"},
	})
	require.NoError(t, err)
	// Move off the named version, or the auto-save below would dedupe against it.
	writeContent(t, svc, ctx, memo.Name, "current")
	// Older than the throttle window, newer than the age limit.
	for i := range store.AutoMemoHistoryMaxCount + 2 {
		seedAutoVersion(t, svc, ctx, memoID, fmt.Sprintf("auto %d", i), time.Duration(i+1)*time.Hour)
	}

	autoSave(t, svc, ctx, memo.Name, "newest", v1pb.UpdateMemoRequest_AUTO_SAVE_PERIODIC)

	versions := listVersions(t, svc, ctx, memo.Name)
	autoVersions := versionsBySource(versions, v1pb.MemoHistory_AUTO)
	assert.Len(t, autoVersions, store.AutoMemoHistoryMaxCount)
	// The one just written survives; the oldest seeds are the ones dropped.
	assert.Equal(t, "current", autoVersions[0].Content)
	for _, h := range autoVersions {
		assert.NotEqual(t, "auto 11", h.Content)
	}
	// A version the user named is not part of the allowance.
	assert.Len(t, versionsBySource(versions, v1pb.MemoHistory_MANUAL), 1)
}

func TestAutoVersion_RetentionDropsAutoVersionsPastMaxAge(t *testing.T) {
	svc := newIntegrationService(t)
	ctx, _ := newAuthor(t, svc)

	memo := newAuthoredMemo(t, svc, ctx, "current")
	memoID := memoPayload(t, svc, ctx, memo.Name).ID
	seedAutoVersion(t, svc, ctx, memoID, "expired", store.AutoMemoHistoryMaxAge+24*time.Hour)
	seedAutoVersion(t, svc, ctx, memoID, "still fresh", time.Hour)

	autoSave(t, svc, ctx, memo.Name, "next", v1pb.UpdateMemoRequest_AUTO_SAVE_PERIODIC)

	contents := []string{}
	for _, h := range listVersions(t, svc, ctx, memo.Name) {
		contents = append(contents, h.Content)
	}
	assert.NotContains(t, contents, "expired")
	assert.Contains(t, contents, "still fresh")
}

// An agent baseline is the only copy of what a human wrote before an AI rewrote
// it, so retention must not count it or delete it.
func TestAutoVersion_RetentionSparesAgentBaseline(t *testing.T) {
	svc := newIntegrationService(t)
	humanCtx, _ := newAuthor(t, svc)

	memo := newAuthoredMemo(t, svc, humanCtx, "written by a person")
	writeContent(t, svc, agentCtx(humanCtx), memo.Name, "rewritten by an agent")
	memoID := memoPayload(t, svc, humanCtx, memo.Name).ID
	for i := range store.AutoMemoHistoryMaxCount + 2 {
		seedAutoVersion(t, svc, humanCtx, memoID, fmt.Sprintf("auto %d", i), time.Duration(i+1)*time.Hour)
	}

	autoSave(t, svc, humanCtx, memo.Name, "next", v1pb.UpdateMemoRequest_AUTO_SAVE_PERIODIC)

	versions := listVersions(t, svc, humanCtx, memo.Name)
	baselines := versionsBySource(versions, v1pb.MemoHistory_AGENT_BASELINE)
	require.Len(t, baselines, 1)
	assert.Equal(t, "written by a person", baselines[0].Content)
	assert.Len(t, versionsBySource(versions, v1pb.MemoHistory_AUTO), store.AutoMemoHistoryMaxCount)
}

// An agent write is covered by the baseline rule, not by auto-save, even if the
// flag shows up on the MCP channel.
func TestAutoVersion_IgnoredOnAgentChannel(t *testing.T) {
	svc := newIntegrationService(t)
	humanCtx, _ := newAuthor(t, svc)

	memo := newAuthoredMemo(t, svc, humanCtx, "written by a person")
	autoSave(t, svc, agentCtx(humanCtx), memo.Name, "agent output", v1pb.UpdateMemoRequest_AUTO_SAVE_SESSION_START)

	versions := listVersions(t, svc, humanCtx, memo.Name)
	require.Len(t, versions, 1)
	assert.Equal(t, v1pb.MemoHistory_AGENT_BASELINE, versions[0].Source)
}
