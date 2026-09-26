package v1

import (
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
)

func TestAcknowledgeAgentEditDoesNotChangeAgentBaseline(t *testing.T) {
	svc := newIntegrationService(t)
	humanCtx, _ := newAuthor(t, svc)
	memo := newAuthoredMemo(t, svc, humanCtx, "human draft")
	request := &v1pb.AcknowledgeAgentEditRequest{Name: memo.Name}

	writeContent(t, svc, agentCtx(humanCtx), memo.Name, "agent pass 1")
	current, err := svc.GetMemo(humanCtx, &v1pb.GetMemoRequest{Name: memo.Name})
	require.NoError(t, err)
	require.True(t, current.AgentEditPending)
	before := memoPayload(t, svc, humanCtx, memo.Name)
	require.Len(t, listVersions(t, svc, humanCtx, memo.Name), 1)

	_, err = svc.AcknowledgeAgentEdit(agentCtx(humanCtx), request)
	require.Equal(t, codes.PermissionDenied, status.Code(err), "an MCP call cannot acknowledge human review")

	acknowledged, err := svc.AcknowledgeAgentEdit(humanCtx, request)
	require.NoError(t, err)
	require.False(t, acknowledged.AgentEditPending)
	after := memoPayload(t, svc, humanCtx, memo.Name)
	require.Equal(t, before.Content, after.Content)
	require.Equal(t, before.UpdatedTs, after.UpdatedTs)
	require.True(t, after.Payload.GetAgentSessionOpen(), "opening the editor must not change baseline-snapshot semantics")
	require.True(t, after.Payload.GetAgentEditAcknowledged())
	require.Len(t, listVersions(t, svc, humanCtx, memo.Name), 1)

	again, err := svc.AcknowledgeAgentEdit(humanCtx, request)
	require.NoError(t, err)
	require.False(t, again.AgentEditPending)

	writeContent(t, svc, agentCtx(humanCtx), memo.Name, "agent pass 2")
	current, err = svc.GetMemo(humanCtx, &v1pb.GetMemoRequest{Name: memo.Name})
	require.NoError(t, err)
	require.True(t, current.AgentEditPending, "the next MCP edit must bring back the marker")
	require.Len(t, listVersions(t, svc, humanCtx, memo.Name), 1, "acknowledgement must not create another baseline")

	writeContent(t, svc, humanCtx, memo.Name, "human revision")
	current, err = svc.GetMemo(humanCtx, &v1pb.GetMemoRequest{Name: memo.Name})
	require.NoError(t, err)
	require.False(t, current.AgentEditPending)
}
