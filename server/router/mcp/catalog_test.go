package mcp

import (
	"encoding/json"
	"testing"

	sdkmcp "github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/stretchr/testify/require"
)

func TestCuratedOperationIDsAreTheKnowledgeBaseSet(t *testing.T) {
	// Pinned exactly: the allowlist is resident model context, and both growing
	// it casually and losing an entry to a bad merge are silent regressions.
	require.Equal(t, []string{
		"WorkspaceService_ListWorkspaces",
		"WorkspaceService_GetWorkspaceTree",
		"RagService_Search",
		"MemoService_ListMemos",
		"MemoService_GetMemo",
		"MemoService_CreateMemo",
		"MemoService_UpdateMemo",
		"AuthService_GetCurrentUser",
	}, curatedOperationIDs)

	// Deliberately excluded: deleting documents, and the social/scratch-note
	// surface inherited from upstream memos.
	require.NotContains(t, curatedOperationIDs, "MemoService_DeleteMemo")
}

func TestCuratedOperationIDsStayMemoFocused(t *testing.T) {
	for _, operationID := range curatedOperationIDs {
		require.NotContains(t, operationID, "Admin")
		// AuthService_GetCurrentUser is the single allowed auth op (read-only
		// "whoami"); the rest of the auth/identity surface stays off MCP.
		if operationID != "AuthService_GetCurrentUser" {
			require.NotContains(t, operationID, "AuthService_")
		}
		require.NotContains(t, operationID, "UserService_")
		require.NotContains(t, operationID, "AIService_")
		require.NotContains(t, operationID, "IdentityProviderService_")
		require.NotContains(t, operationID, "InstanceService_")
		require.NotContains(t, operationID, "PersonalAccessToken")
		require.NotContains(t, operationID, "PAT")
		require.NotContains(t, operationID, "Webhook")
		require.NotContains(t, operationID, "Share")
		require.NotContains(t, operationID, "BatchDelete")
		require.NotContains(t, operationID, "Transcribe")
	}
}

func TestToolNameFromOperationID(t *testing.T) {
	require.Equal(t, "memo_list_memos", toolNameFromOperationID("MemoService_ListMemos"))
	require.Equal(t, "attachment_get_attachment", toolNameFromOperationID("AttachmentService_GetAttachment"))
}

func TestBuildToolFromOperationIncludesSchemasAndMetadata(t *testing.T) {
	spec, err := loadOpenAPISpec("../../../proto/gen/openapi.yaml")
	require.NoError(t, err)
	registry, err := buildOperationRegistry(spec)
	require.NoError(t, err)

	tool, operation := buildToolFromOperation(registry["MemoService_ListMemos"])
	require.Equal(t, "memo_list_memos", tool.Name)
	require.Equal(t, "Memo List Memos", tool.Title)
	require.Equal(t, "MemoService_ListMemos", operation.OperationID)
	require.Equal(t, "GET", operation.Method)
	require.Equal(t, "/api/v1/memos", operation.Path)
	require.Equal(t, "MemoService_ListMemos", tool.Meta["operationId"])
	require.Equal(t, "GET", tool.Meta["method"])
	require.Equal(t, "/api/v1/memos", tool.Meta["path"])
	require.NotEmpty(t, tool.Description)
	require.NotNil(t, tool.InputSchema)
	require.NotNil(t, tool.OutputSchema)
	require.NotNil(t, tool.Annotations)
	require.True(t, tool.Annotations.ReadOnlyHint)
	require.False(t, *tool.Annotations.DestructiveHint)
	require.True(t, tool.Annotations.IdempotentHint)
	require.False(t, *tool.Annotations.OpenWorldHint)

	inputBytes, err := json.Marshal(tool.InputSchema)
	require.NoError(t, err)
	require.Contains(t, string(inputBytes), `"pageSize"`)
	require.Contains(t, string(inputBytes), `"additionalProperties":false`)

	outputBytes, err := json.Marshal(tool.OutputSchema)
	require.NoError(t, err)
	require.Contains(t, string(outputBytes), `"memos"`)
}

func TestBuildToolFromOperationIncludesRequestBodySchema(t *testing.T) {
	spec, err := loadOpenAPISpec("../../../proto/gen/openapi.yaml")
	require.NoError(t, err)
	registry, err := buildOperationRegistry(spec)
	require.NoError(t, err)

	tool, operation := buildToolFromOperation(registry["MemoService_CreateMemo"])
	require.Equal(t, "POST", operation.Method)
	require.False(t, tool.Annotations.ReadOnlyHint)
	require.False(t, *tool.Annotations.DestructiveHint)
	require.False(t, tool.Annotations.IdempotentHint)

	input, ok := tool.InputSchema.(jsonSchema)
	require.True(t, ok)
	require.Contains(t, input["required"], "body")
	properties, ok := input["properties"].(map[string]any)
	require.True(t, ok)
	require.Contains(t, properties, "memoId")
	require.Contains(t, properties, "body")
	body, ok := properties["body"].(jsonSchema)
	require.True(t, ok)
	require.Equal(t, "object", body["type"])
	require.Contains(t, body["properties"], "content")

	err = validateToolArguments(input, map[string]any{
		"body": map[string]any{
			"state":      "NORMAL",
			"content":    "hello",
			"visibility": "PRIVATE",
		},
	})
	require.NoError(t, err)
}

func TestBuildToolFromOperationExposesWorkspaceNavigation(t *testing.T) {
	spec, err := loadOpenAPISpec("../../../proto/gen/openapi.yaml")
	require.NoError(t, err)
	registry, err := buildOperationRegistry(spec)
	require.NoError(t, err)

	listTool, listOperation := buildToolFromOperation(registry["WorkspaceService_ListWorkspaces"])
	require.Equal(t, "workspace_list_workspaces", listTool.Name)
	require.Equal(t, "GET", listOperation.Method)
	require.True(t, listTool.Annotations.ReadOnlyHint)

	treeTool, treeOperation := buildToolFromOperation(registry["WorkspaceService_GetWorkspaceTree"])
	require.Equal(t, "workspace_get_workspace_tree", treeTool.Name)
	require.Equal(t, "GET", treeOperation.Method)
	require.True(t, treeTool.Annotations.ReadOnlyHint)

	input, ok := treeTool.InputSchema.(jsonSchema)
	require.True(t, ok)
	require.Contains(t, input["required"], "workspace")
}

// RagService_Search is POST but mutates nothing, so the method heuristic has to
// be overridden — otherwise clients treat every search as a write.
func TestBuildToolFromOperationMarksRagSearchReadOnly(t *testing.T) {
	spec, err := loadOpenAPISpec("../../../proto/gen/openapi.yaml")
	require.NoError(t, err)
	registry, err := buildOperationRegistry(spec)
	require.NoError(t, err)

	tool, operation := buildToolFromOperation(registry["RagService_Search"])
	require.Equal(t, "rag_search", tool.Name)
	require.Equal(t, "POST", operation.Method)
	require.True(t, tool.Annotations.ReadOnlyHint)
	require.True(t, tool.Annotations.IdempotentHint)
	require.False(t, *tool.Annotations.DestructiveHint)

	input, ok := tool.InputSchema.(jsonSchema)
	require.True(t, ok)
	require.Contains(t, input["required"], "body")
}

func TestBuildToolFromOperationExposesCurrentUser(t *testing.T) {
	spec, err := loadOpenAPISpec("../../../proto/gen/openapi.yaml")
	require.NoError(t, err)
	registry, err := buildOperationRegistry(spec)
	require.NoError(t, err)

	tool, operation := buildToolFromOperation(registry["AuthService_GetCurrentUser"])
	require.Equal(t, "auth_get_current_user", tool.Name)
	require.Equal(t, "GET", operation.Method)
	require.True(t, tool.Annotations.ReadOnlyHint)
}

func TestBuildCuratedToolsHasUniqueNames(t *testing.T) {
	spec, err := loadOpenAPISpec("../../../proto/gen/openapi.yaml")
	require.NoError(t, err)
	registry, err := buildOperationRegistry(spec)
	require.NoError(t, err)

	tools, operations, err := buildCuratedTools(registry)
	require.NoError(t, err)
	require.Len(t, tools, len(curatedOperationIDs))
	require.Len(t, operations, len(curatedOperationIDs))

	names := map[string]struct{}{}
	for _, tool := range tools {
		require.IsType(t, &sdkmcp.Tool{}, tool)
		require.NotEmpty(t, tool.Name)
		require.NotContains(t, names, tool.Name)
		names[tool.Name] = struct{}{}
		require.Equal(t, tool.Name, operations[tool.Name].ToolName)

		inputBytes, err := json.Marshal(tool.InputSchema)
		require.NoError(t, err)
		require.NotContains(t, string(inputBytes), "#/components/schemas")
		outputBytes, err := json.Marshal(tool.OutputSchema)
		require.NoError(t, err)
		require.NotContains(t, string(outputBytes), "#/components/schemas")
	}
}

func TestBuildCuratedToolsRejectsMissingOperation(t *testing.T) {
	_, _, err := buildCuratedTools(map[string]*openAPIOperation{})
	require.ErrorContains(t, err, "curated OpenAPI operation")
	require.ErrorContains(t, err, "not found")
}

func TestBuildCuratedToolsRejectsDuplicateToolNames(t *testing.T) {
	registry := make(map[string]*openAPIOperation, len(curatedOperationIDs))
	for _, operationID := range curatedOperationIDs {
		registry[operationID] = &openAPIOperation{
			OperationID:    operationID,
			Description:    operationID,
			Method:         "GET",
			Path:           "/api/v1/test",
			ResponseSchema: okSchema(),
		}
	}
	registry["MemoService_ListMemos"].OperationID = "MemoService_GetMemo"

	_, _, err := buildCuratedTools(registry)
	require.ErrorContains(t, err, "duplicate MCP tool name")
}

func TestPatchRequestBodyDropsRequiredFields(t *testing.T) {
	// update_memo's body is the full Memo schema, whose `required` list includes
	// visibility — a field the agent channel forbids writing. Leaving it required
	// makes a content-only edit impossible: the schema demands the field, the
	// server rejects it.
	spec, err := loadOpenAPISpec("../../../proto/gen/openapi.yaml")
	require.NoError(t, err)
	registry, err := buildOperationRegistry(spec)
	require.NoError(t, err)

	_, registered := buildToolFromOperation(registry["MemoService_UpdateMemo"])
	body, ok := registered.InputSchema["properties"].(map[string]any)["body"].(jsonSchema)
	require.True(t, ok)
	require.NotContains(t, body, "required")

	// A minimal content-only update validates.
	require.NoError(t, validateToolArguments(registered.InputSchema, map[string]any{
		"memo":       "memos/abc",
		"updateMask": "content",
		"body":       map[string]any{"content": "hello"},
	}))
}
