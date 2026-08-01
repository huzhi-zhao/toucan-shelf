package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"

	"github.com/labstack/echo/v5"
	sdkmcp "github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/base"
)

type apiAdapter struct {
	echoServer *echo.Echo
}

func newAPIAdapter(echoServer *echo.Echo) *apiAdapter {
	return &apiAdapter{echoServer: echoServer}
}

func (a *apiAdapter) execute(ctx context.Context, operation *openAPIOperation, arguments map[string]any, authorization string) (*sdkmcp.CallToolResult, error) {
	req, err := buildAPIRequest(ctx, operation, arguments, authorization)
	if err != nil {
		return newToolErrorResult(err.Error()), nil
	}

	recorder := httptest.NewRecorder()
	a.echoServer.ServeHTTP(recorder, req)

	value, err := decodeJSONValue(recorder.Body.Bytes())
	if err != nil {
		return newToolErrorResult(err.Error()), nil
	}
	if recorder.Code < http.StatusOK || recorder.Code >= http.StatusMultipleChoices {
		return newToolErrorResult(apiErrorMessage(recorder.Code, value)), nil
	}
	return newStructuredToolResult(value)
}

func buildAPIRequest(ctx context.Context, operation *openAPIOperation, arguments map[string]any, authorization string) (*http.Request, error) {
	path, err := substitutePathParameters(operation, arguments)
	if err != nil {
		return nil, err
	}

	query := url.Values{}
	for _, parameter := range operation.Parameters {
		if parameter.In != "query" {
			continue
		}
		value, ok := arguments[parameter.Name]
		if !ok || value == nil {
			continue
		}
		query.Set(parameter.Name, valueToString(value))
	}
	if encoded := query.Encode(); encoded != "" {
		path += "?" + encoded
	}

	var body io.Reader
	if operation.RequestBody != nil {
		bodyValue, ok := arguments["body"]
		if !ok || bodyValue == nil {
			if operation.RequestBody.Required {
				return nil, errors.New(`missing required request body "body"`)
			}
			bodyValue = map[string]any{}
		}

		data, err := json.Marshal(bodyValue)
		if err != nil {
			return nil, errors.Wrap(err, "failed to marshal request body")
		}
		body = bytes.NewReader(data)
	}

	// Mark the request as arriving over the MCP channel. An MCP call carries the
	// user's own PAT, so the creator ID is identical to their web session; the
	// channel is the only thing that separates agent writes from human ones, and
	// the API layer uses it to decide whether to snapshot the human baseline
	// before an agent overwrites it (see requirement.md ADR-4).
	//
	// Carried on the context, not a header: this request is served by the same
	// Echo server that serves public traffic, so a header marker would be
	// indistinguishable from one a remote client set on itself. A context value
	// can only be set in-process.
	ctx = base.WithActorKind(ctx, base.ActorKindAgent)

	req := httptest.NewRequest(operation.Method, path, body).WithContext(ctx)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if authorization != "" {
		req.Header.Set("Authorization", authorization)
	}
	return req, nil
}

func substitutePathParameters(operation *openAPIOperation, arguments map[string]any) (string, error) {
	path := operation.Path
	for _, parameter := range operation.Parameters {
		if parameter.In != "path" {
			continue
		}

		value, ok := arguments[parameter.Name]
		if !ok || value == nil || valueToString(value) == "" {
			return "", errors.Errorf(`missing required path parameter "%s"`, parameter.Name)
		}
		path = strings.ReplaceAll(path, "{"+parameter.Name+"}", url.PathEscape(valueToString(value)))
	}
	return path, nil
}

func valueToString(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case bool:
		return strconv.FormatBool(typed)
	case int:
		return strconv.Itoa(typed)
	case int8:
		return strconv.FormatInt(int64(typed), 10)
	case int16:
		return strconv.FormatInt(int64(typed), 10)
	case int32:
		return strconv.FormatInt(int64(typed), 10)
	case int64:
		return strconv.FormatInt(typed, 10)
	case uint:
		return strconv.FormatUint(uint64(typed), 10)
	case uint8:
		return strconv.FormatUint(uint64(typed), 10)
	case uint16:
		return strconv.FormatUint(uint64(typed), 10)
	case uint32:
		return strconv.FormatUint(uint64(typed), 10)
	case uint64:
		return strconv.FormatUint(typed, 10)
	case float32:
		return strconv.FormatFloat(float64(typed), 'f', -1, 32)
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	default:
		data, err := json.Marshal(value)
		if err != nil {
			return ""
		}
		return strings.Trim(string(data), `"`)
	}
}

func apiErrorMessage(statusCode int, value any) string {
	status := strings.TrimSpace(strconv.Itoa(statusCode) + " " + http.StatusText(statusCode))
	if object, ok := value.(map[string]any); ok {
		for _, key := range []string{"message", "error"} {
			message, ok := object[key].(string)
			if ok && message != "" {
				return status + ": " + message
			}
		}
	}
	return status
}
