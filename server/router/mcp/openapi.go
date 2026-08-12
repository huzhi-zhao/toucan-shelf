package mcp

import (
	"os"
	"strings"

	"github.com/pkg/errors"
	"gopkg.in/yaml.v3"
)

type jsonSchema map[string]any

type openAPISpec struct {
	OpenAPI    string                                  `yaml:"openapi"`
	Paths      map[string]map[string]*openAPIOperation `yaml:"paths"`
	Components openAPIComponents                       `yaml:"components"`
}

type openAPIComponents struct {
	Schemas map[string]jsonSchema `yaml:"schemas"`
}

type openAPIOperation struct {
	OperationID       string                     `yaml:"operationId"`
	Description       string                     `yaml:"description"`
	Parameters        []openAPIParameter         `yaml:"parameters"`
	RequestBody       *openAPIRequestBody        `yaml:"requestBody"`
	Responses         map[string]openAPIResponse `yaml:"responses"`
	Method            string                     `yaml:"-"`
	Path              string                     `yaml:"-"`
	ResponseSchema    jsonSchema                 `yaml:"-"`
	RequestBodySchema jsonSchema                 `yaml:"-"`
}

type openAPIParameter struct {
	Name        string     `yaml:"name"`
	In          string     `yaml:"in"`
	Description string     `yaml:"description"`
	Required    bool       `yaml:"required"`
	Schema      jsonSchema `yaml:"schema"`
}

type openAPIRequestBody struct {
	Required bool                        `yaml:"required"`
	Content  map[string]openAPIMediaType `yaml:"content"`
}

type openAPIResponse struct {
	Description string                      `yaml:"description"`
	Content     map[string]openAPIMediaType `yaml:"content"`
}

type openAPIMediaType struct {
	Schema jsonSchema `yaml:"schema"`
}

func loadOpenAPISpec(path string) (*openAPISpec, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, errors.Wrap(err, "failed to read OpenAPI spec")
	}

	spec := &openAPISpec{}
	if err := yaml.Unmarshal(data, spec); err != nil {
		return nil, errors.Wrap(err, "failed to parse OpenAPI spec")
	}
	if spec.Paths == nil {
		return nil, errors.New("OpenAPI spec has no paths")
	}
	return spec, nil
}

func buildOperationRegistry(spec *openAPISpec) (map[string]*openAPIOperation, error) {
	registry := map[string]*openAPIOperation{}
	for path, pathItem := range spec.Paths {
		for method, operation := range pathItem {
			if operation == nil || operation.OperationID == "" {
				continue
			}
			if _, exists := registry[operation.OperationID]; exists {
				return nil, errors.Errorf("duplicate OpenAPI operationId %q", operation.OperationID)
			}

			operation.Method = strings.ToUpper(method)
			operation.Path = path

			responseSchema, err := operationSuccessResponseSchema(spec, operation)
			if err != nil {
				return nil, errors.Wrapf(err, "failed to resolve response schema for %s", operation.OperationID)
			}
			operation.ResponseSchema = responseSchema

			requestBodySchema, err := operationRequestBodySchema(spec, operation)
			if err != nil {
				return nil, errors.Wrapf(err, "failed to resolve request body schema for %s", operation.OperationID)
			}
			operation.RequestBodySchema = requestBodySchema

			for i := range operation.Parameters {
				stripUnknownFormats(operation.Parameters[i].Schema)
			}
			stripUnknownFormats(operation.ResponseSchema)
			stripUnknownFormats(operation.RequestBodySchema)
			stripRequired(operation.ResponseSchema)

			registry[operation.OperationID] = operation
		}
	}
	return registry, nil
}

// knownSchemaFormats lists the `format` values a JSON Schema validator can be
// expected to understand: the draft 2020-12 vocabulary plus the OpenAPI numeric
// and binary formats that ajv-formats implements.
//
// protoc-gen-openapi also emits formats that only make sense to an OpenAPI
// consumer -- `enum` for proto enums, `bytes` for proto bytes fields,
// `field-mask` for FieldMask query parameters. They carry no validation meaning
// for MCP clients, and every one of them makes a client-side validator log an
// "unknown format ... ignored" warning per tool, twice over, which buries the
// output of things like `claude mcp list`.
var knownSchemaFormats = map[string]bool{
	"date-time": true, "date": true, "time": true, "duration": true,
	"email": true, "idn-email": true, "hostname": true, "idn-hostname": true,
	"ipv4": true, "ipv6": true,
	"uri": true, "uri-reference": true, "uri-template": true,
	"iri": true, "iri-reference": true,
	"uuid": true, "regex": true,
	"json-pointer": true, "relative-json-pointer": true,
	"int32": true, "int64": true, "float": true, "double": true,
	"byte": true, "binary": true, "password": true,
}

// stripUnknownFormats recursively drops `format` keywords that are not in
// knownSchemaFormats. Everything else, including the `enum` keyword itself, is
// left alone.
//
// This is deliberately done here rather than in proto/gen/openapi.yaml: that
// file is generated, and `format: enum` is informative to an OpenAPI consumer.
// It is only the MCP projection of the spec that has no use for it.
func stripUnknownFormats(value any) {
	switch typed := value.(type) {
	case jsonSchema:
		stripUnknownFormatsInMap(typed)
	case map[string]any:
		stripUnknownFormatsInMap(typed)
	case []any:
		for _, item := range typed {
			stripUnknownFormats(item)
		}
	}
}

func stripUnknownFormatsInMap(schema map[string]any) {
	// Only a string-valued "format" is the keyword; a property *named* "format"
	// maps to a schema object and must survive.
	if format, ok := schema["format"].(string); ok && !knownSchemaFormats[format] {
		delete(schema, "format")
	}
	for _, child := range schema {
		stripUnknownFormats(child)
	}
}

// stripRequired recursively drops `required` keywords from a *response* schema.
//
// protoc-gen-openapi marks every proto3 field that is not explicitly `optional`
// as required. That is wrong for a protojson payload: proto3 has no presence
// for plain scalar and enum fields, so the marshaler omits them whenever they
// hold the zero value. A memo whose content is "" or whose visibility is the
// zero enum comes back over the wire without those keys, and a client that
// validates structuredContent against the tool's output schema -- the
// TypeScript MCP SDK does, strictly -- rejects the whole call with
// "data must have required property 'content'".
//
// Nothing is lost by dropping it: `required` on a response constrains the
// server, not the caller, and the property definitions themselves survive, so
// clients keep the full type information.
//
// Input schemas are deliberately left alone -- there `required` is meaningful
// and is what validateToolArguments enforces.
func stripRequired(value any) {
	switch typed := value.(type) {
	case jsonSchema:
		stripRequiredInMap(typed)
	case map[string]any:
		stripRequiredInMap(typed)
	case []any:
		for _, item := range typed {
			stripRequired(item)
		}
	}
}

func stripRequiredInMap(schema map[string]any) {
	// Only an array-valued "required" is the keyword; a property *named*
	// "required" maps to a schema object and must survive.
	switch schema["required"].(type) {
	case []any, []string:
		delete(schema, "required")
	}
	for _, child := range schema {
		stripRequired(child)
	}
}

func operationSuccessResponseSchema(spec *openAPISpec, operation *openAPIOperation) (jsonSchema, error) {
	response, ok := operation.Responses["200"]
	if !ok || response.Content == nil {
		return okSchema(), nil
	}
	mediaType, ok := response.Content["application/json"]
	if !ok || mediaType.Schema == nil {
		return okSchema(), nil
	}
	return resolveSchemaRef(spec, mediaType.Schema)
}

func operationRequestBodySchema(spec *openAPISpec, operation *openAPIOperation) (jsonSchema, error) {
	if operation.RequestBody == nil {
		return nil, nil
	}
	mediaType, ok := operation.RequestBody.Content["application/json"]
	if !ok || mediaType.Schema == nil {
		return jsonSchema{"type": "object"}, nil
	}
	return resolveSchemaRef(spec, mediaType.Schema)
}

func resolveSchemaRef(spec *openAPISpec, schema jsonSchema) (jsonSchema, error) {
	defs := map[string]any{}
	resolved, err := resolveSchemaValue(spec, schema, defs, map[string]bool{}, true)
	if err != nil {
		return nil, err
	}

	resolvedSchema, ok := resolved.(map[string]any)
	if !ok {
		return nil, errors.New("resolved schema is not an object")
	}
	if len(defs) > 0 {
		resolvedSchema["$defs"] = defs
	}
	return jsonSchema(resolvedSchema), nil
}

func resolveSchemaValue(spec *openAPISpec, value any, defs map[string]any, resolving map[string]bool, inlineRef bool) (any, error) {
	switch typed := value.(type) {
	case jsonSchema:
		return resolveSchemaMap(spec, map[string]any(typed), defs, resolving, inlineRef)
	case map[string]any:
		return resolveSchemaMap(spec, typed, defs, resolving, inlineRef)
	case []any:
		resolved := make([]any, 0, len(typed))
		for _, item := range typed {
			resolvedItem, err := resolveSchemaValue(spec, item, defs, resolving, false)
			if err != nil {
				return nil, err
			}
			resolved = append(resolved, resolvedItem)
		}
		return resolved, nil
	default:
		return value, nil
	}
}

func resolveSchemaMap(spec *openAPISpec, schema map[string]any, defs map[string]any, resolving map[string]bool, inlineRef bool) (map[string]any, error) {
	if ref, ok := schema["$ref"].(string); ok && ref != "" {
		name, err := schemaComponentName(ref)
		if err != nil {
			return nil, err
		}
		if inlineRef {
			return resolveComponentSchema(spec, name, defs, resolving)
		}
		if err := addSchemaDef(spec, name, defs, resolving); err != nil {
			return nil, err
		}
		return map[string]any{"$ref": "#/$defs/" + name}, nil
	}

	resolved := make(map[string]any, len(schema))
	for key, value := range schema {
		resolvedValue, err := resolveSchemaValue(spec, value, defs, resolving, false)
		if err != nil {
			return nil, err
		}
		resolved[key] = resolvedValue
	}
	return resolved, nil
}

func resolveComponentSchema(spec *openAPISpec, name string, defs map[string]any, resolving map[string]bool) (map[string]any, error) {
	component, ok := spec.Components.Schemas[name]
	if !ok {
		return nil, errors.Errorf("schema ref %q not found", schemaComponentRef(name))
	}
	resolving[name] = true
	resolved, err := resolveSchemaMap(spec, map[string]any(component), defs, resolving, false)
	delete(resolving, name)
	if err != nil {
		return nil, err
	}
	if _, ok := defs[name]; ok {
		defs[name] = resolved
	}
	return resolved, nil
}

func addSchemaDef(spec *openAPISpec, name string, defs map[string]any, resolving map[string]bool) error {
	if _, ok := defs[name]; ok {
		return nil
	}
	component, ok := spec.Components.Schemas[name]
	if !ok {
		return errors.Errorf("schema ref %q not found", schemaComponentRef(name))
	}

	defs[name] = map[string]any{}
	if resolving[name] {
		return nil
	}

	resolving[name] = true
	resolved, err := resolveSchemaMap(spec, map[string]any(component), defs, resolving, false)
	delete(resolving, name)
	if err != nil {
		return err
	}
	defs[name] = resolved
	return nil
}

func schemaComponentName(ref string) (string, error) {
	const prefix = "#/components/schemas/"
	if !strings.HasPrefix(ref, prefix) {
		return "", errors.Errorf("unsupported schema ref %q", ref)
	}
	return strings.TrimPrefix(ref, prefix), nil
}

func schemaComponentRef(name string) string {
	return "#/components/schemas/" + name
}

func okSchema() jsonSchema {
	return jsonSchema{
		"type": "object",
		"properties": map[string]any{
			"ok": map[string]any{"type": "boolean"},
		},
	}
}
