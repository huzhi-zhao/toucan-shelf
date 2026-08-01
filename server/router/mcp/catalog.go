package mcp

import (
	"regexp"
	"strings"

	sdkmcp "github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/pkg/errors"
)

// curatedOperationIDs is the MCP tool allowlist, scoped to knowledge-base
// authoring: navigate the workspace tree, search, read a document, write one.
//
// Keep it small on purpose. The `tools/list` result is injected into the model's
// context when the connection is established and stays resident there, and these
// schemas are derived from OpenAPI, so they are verbose (the Memo component
// alone is ~7 KB before its nested $defs). Do not add secret-block, IDP or
// instance-management operations "while you are in here".
//
// MemoService_DeleteMemo is deliberately absent: letting an agent delete
// documents has near-zero upside and real downside.
var curatedOperationIDs = []string{
	"WorkspaceService_ListWorkspaces",
	"WorkspaceService_GetWorkspaceTree",
	"RagService_Search",
	"MemoService_ListMemos",
	"MemoService_GetMemo",
	"MemoService_CreateMemo",
	"MemoService_UpdateMemo",
	// The only allowed auth/identity operation: a read-only "whoami" so agents
	// can resolve the current user.
	"AuthService_GetCurrentUser",
}

type registeredOperation struct {
	ToolName    string
	OperationID string
	Method      string
	Path        string
	Operation   *openAPIOperation
	InputSchema jsonSchema
}

var wordBoundary = regexp.MustCompile(`([a-z0-9])([A-Z])`)

func buildCuratedTools(registry map[string]*openAPIOperation) ([]*sdkmcp.Tool, map[string]*registeredOperation, error) {
	tools := make([]*sdkmcp.Tool, 0, len(curatedOperationIDs))
	operations := map[string]*registeredOperation{}
	for _, operationID := range curatedOperationIDs {
		operation, ok := registry[operationID]
		if !ok {
			return nil, nil, errors.Errorf("curated OpenAPI operation %q not found", operationID)
		}

		tool, registered := buildToolFromOperation(operation)
		if _, exists := operations[tool.Name]; exists {
			return nil, nil, errors.Errorf("duplicate MCP tool name %q", tool.Name)
		}

		tools = append(tools, tool)
		operations[tool.Name] = registered
	}
	return tools, operations, nil
}

func buildToolFromOperation(operation *openAPIOperation) (*sdkmcp.Tool, *registeredOperation) {
	name := toolNameFromOperationID(operation.OperationID)
	title := titleFromToolName(name)
	inputSchema := inputSchemaForOperation(operation)
	tool := &sdkmcp.Tool{
		Meta: sdkmcp.Meta{
			"operationId": operation.OperationID,
			"method":      operation.Method,
			"path":        operation.Path,
		},
		Name:         name,
		Title:        title,
		Description:  operation.Description,
		InputSchema:  inputSchema,
		OutputSchema: outputSchemaForOperation(operation),
		Annotations:  annotationsForOperation(operation, title),
	}

	return tool, &registeredOperation{
		ToolName:    name,
		OperationID: operation.OperationID,
		Method:      operation.Method,
		Path:        operation.Path,
		Operation:   operation,
		InputSchema: inputSchema,
	}
}

func toolNameFromOperationID(operationID string) string {
	service, method, ok := strings.Cut(operationID, "_")
	if !ok {
		return camelToSnake(operationID)
	}
	service = strings.TrimSuffix(service, "Service")
	return camelToSnake(service) + "_" + camelToSnake(method)
}

func camelToSnake(value string) string {
	return strings.ToLower(wordBoundary.ReplaceAllString(value, `${1}_${2}`))
}

func titleFromToolName(name string) string {
	parts := strings.Split(name, "_")
	for i, part := range parts {
		if part == "" {
			continue
		}
		parts[i] = strings.ToUpper(part[:1]) + part[1:]
	}
	return strings.Join(parts, " ")
}

func inputSchemaForOperation(operation *openAPIOperation) jsonSchema {
	properties := map[string]any{}
	required := []string{}
	defs := map[string]any{}
	for _, parameter := range operation.Parameters {
		schema := cloneSchema(parameter.Schema)
		if parameter.Description != "" {
			schema["description"] = parameter.Description
		}
		properties[parameter.Name] = schema
		if parameter.Required {
			required = append(required, parameter.Name)
		}
	}

	if operation.RequestBody != nil {
		bodySchema := requestBodySchema(operation)
		for name, definition := range extractSchemaDefs(bodySchema) {
			defs[name] = definition
		}
		properties["body"] = bodySchema
		if operation.RequestBody.Required {
			required = append(required, "body")
		}
	}

	schema := jsonSchema{
		"type":                 "object",
		"properties":           properties,
		"additionalProperties": false,
	}
	if len(required) > 0 {
		schema["required"] = required
	}
	if len(defs) > 0 {
		schema["$defs"] = defs
	}
	return schema
}

func requestBodySchema(operation *openAPIOperation) jsonSchema {
	if operation.RequestBodySchema == nil {
		return jsonSchema{"type": "object"}
	}
	return cloneSchema(operation.RequestBodySchema)
}

func outputSchemaForOperation(operation *openAPIOperation) jsonSchema {
	if operation.ResponseSchema == nil {
		return okSchema()
	}
	return cloneSchema(operation.ResponseSchema)
}

func cloneSchema(schema jsonSchema) jsonSchema {
	clone := jsonSchema{}
	for key, value := range schema {
		clone[key] = value
	}
	return clone
}

func extractSchemaDefs(schema jsonSchema) map[string]any {
	defs, ok := schema["$defs"].(map[string]any)
	if !ok {
		return nil
	}
	delete(schema, "$defs")
	return defs
}

// readOnlyOperationIDs lists operations that mutate nothing but are served over
// a non-GET method, which the HTTP-method heuristic reads as a write.
// RagService_Search is POST only because its query is too large for a query
// string; it is a pure read, and clients should be free to run it without a
// write confirmation.
var readOnlyOperationIDs = map[string]bool{
	"RagService_Search": true,
}

// annotationsForOperation derives the method-based annotations and then applies
// per-operation overrides that the HTTP method alone cannot express.
func annotationsForOperation(operation *openAPIOperation, title string) *sdkmcp.ToolAnnotations {
	annotations := annotationsForMethod(operation.Method, title)
	if readOnlyOperationIDs[operation.OperationID] {
		annotations.ReadOnlyHint = true
		annotations.IdempotentHint = true
	}
	return annotations
}

func annotationsForMethod(method string, title string) *sdkmcp.ToolAnnotations {
	openWorld := false
	destructive := false
	switch strings.ToUpper(method) {
	case "GET":
		return &sdkmcp.ToolAnnotations{
			Title:           title,
			ReadOnlyHint:    true,
			DestructiveHint: &destructive,
			IdempotentHint:  true,
			OpenWorldHint:   &openWorld,
		}
	case "DELETE":
		destructive = true
		return &sdkmcp.ToolAnnotations{
			Title:           title,
			ReadOnlyHint:    false,
			DestructiveHint: &destructive,
			IdempotentHint:  true,
			OpenWorldHint:   &openWorld,
		}
	default:
		return &sdkmcp.ToolAnnotations{
			Title:           title,
			ReadOnlyHint:    false,
			DestructiveHint: &destructive,
			IdempotentHint:  false,
			OpenWorldHint:   &openWorld,
		}
	}
}
