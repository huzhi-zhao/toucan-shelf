package v1

import (
	"bytes"
	"context"
	"mime"
	"net/http"
	"strings"

	"github.com/pkg/errors"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/usememos/memos/internal/ai"
	"github.com/usememos/memos/internal/ai/audiollm"
	audiollmgemini "github.com/usememos/memos/internal/ai/audiollm/gemini"
	"github.com/usememos/memos/internal/ai/stt"
	sttopenai "github.com/usememos/memos/internal/ai/stt/openai"
	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
)

const (
	maxTranscriptionAudioSizeBytes = 25 * MebiByte
	maxTranscriptionFilenameLength = 255
)

var supportedTranscriptionContentTypes = map[string]bool{
	"audio/aac":    true,
	"audio/aiff":   true,
	"audio/flac":   true,
	"audio/mpeg":   true,
	"audio/mp3":    true,
	"audio/mp4":    true,
	"audio/mpga":   true,
	"audio/ogg":    true,
	"audio/wav":    true,
	"audio/x-wav":  true,
	"audio/x-flac": true,
	"audio/x-m4a":  true,
	"audio/webm":   true,
	"video/mp4":    true,
	"video/mpeg":   true,
	"video/webm":   true,
}

// Transcribe transcribes an audio file using an instance AI provider.
func (s *APIV1Service) Transcribe(ctx context.Context, request *v1pb.TranscribeRequest) (*v1pb.TranscribeResponse, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}

	if request.Audio == nil {
		return nil, status.Errorf(codes.InvalidArgument, "audio is required")
	}
	if request.Audio.GetUri() != "" {
		return nil, status.Errorf(codes.InvalidArgument, "audio uri is not supported")
	}
	content := request.Audio.GetContent()
	if len(content) == 0 {
		return nil, status.Errorf(codes.InvalidArgument, "audio content is required")
	}
	if len(content) > maxTranscriptionAudioSizeBytes {
		return nil, status.Errorf(codes.InvalidArgument, "audio file is too large; maximum size is 25 MiB")
	}
	filename := strings.TrimSpace(request.Audio.GetFilename())
	if len(filename) > maxTranscriptionFilenameLength {
		return nil, status.Errorf(codes.InvalidArgument, "filename is too long; maximum length is %d characters", maxTranscriptionFilenameLength)
	}
	contentType := strings.TrimSpace(request.Audio.GetContentType())
	if contentType == "" {
		contentType = http.DetectContentType(content)
	}
	if !isSupportedTranscriptionContentType(contentType) {
		return nil, status.Errorf(codes.InvalidArgument, "audio content type %q is not supported", contentType)
	}

	aiSetting, err := s.Store.GetInstanceAISetting(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get AI setting: %v", err)
	}
	persisted := aiSetting.GetTranscription()

	providerID := persisted.GetProviderId()
	if providerID == "" {
		return nil, status.Errorf(codes.FailedPrecondition, "transcription is not configured")
	}

	provider, err := s.resolveAIProvider(aiSetting, providerID)
	if err != nil {
		return nil, err
	}

	model := persisted.GetModel()
	if model == "" {
		defaultModel, err := ai.DefaultTranscriptionModel(provider.Type)
		if err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "%v", err)
		}
		model = defaultModel
	}

	var text string
	switch provider.Type {
	case ai.ProviderOpenAI:
		text, err = s.transcribeViaSTT(ctx, provider, persisted, model, content, filename, contentType)
	case ai.ProviderGemini:
		text, err = s.transcribeViaAudioLLM(ctx, provider, persisted, model, content, contentType)
	default:
		return nil, status.Errorf(codes.FailedPrecondition,
			"provider type %q is not supported for transcription", provider.Type)
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to transcribe audio: %v", err)
	}
	return &v1pb.TranscribeResponse{Text: text}, nil
}

func (*APIV1Service) transcribeViaSTT(
	ctx context.Context,
	provider ai.ProviderConfig,
	persisted *storepb.TranscriptionConfig,
	model string,
	content []byte,
	filename string,
	contentType string,
) (string, error) {
	transcriber, err := sttopenai.New(provider, stt.ApplyOptions(nil))
	if err != nil {
		return "", errors.Wrap(err, "failed to create STT transcriber")
	}
	resp, err := transcriber.Transcribe(ctx, stt.Request{
		Audio:       bytes.NewReader(content),
		Size:        int64(len(content)),
		Filename:    filename,
		ContentType: contentType,
		Model:       model,
		Prompt:      persisted.GetPrompt(),
		Language:    persisted.GetLanguage(),
	})
	if err != nil {
		return "", err
	}
	return resp.Text, nil
}

func (*APIV1Service) transcribeViaAudioLLM(
	ctx context.Context,
	provider ai.ProviderConfig,
	persisted *storepb.TranscriptionConfig,
	model string,
	content []byte,
	contentType string,
) (string, error) {
	m, err := audiollmgemini.New(provider, audiollm.ApplyOptions(nil))
	if err != nil {
		return "", errors.Wrap(err, "failed to create audio LLM")
	}
	resp, err := m.GenerateFromAudio(ctx, audiollm.Request{
		Audio:        bytes.NewReader(content),
		Size:         int64(len(content)),
		ContentType:  contentType,
		Model:        model,
		Instructions: buildTranscriptionInstructions(persisted.GetPrompt(), persisted.GetLanguage()),
	})
	if err != nil {
		return "", err
	}
	if resp.FinishReason != audiollm.FinishStop {
		return "", errors.Errorf("transcription incomplete (finish reason: %s)", resp.FinishReason)
	}
	if strings.TrimSpace(resp.Text) == "" {
		return "", errors.New("transcription response did not include text")
	}
	return resp.Text, nil
}

const maxFormatMarkdownTextSizeBytes = 1 * MebiByte

// FormatMarkdown restructures plain text into markdown using an instance AI provider,
// preserving the original text content verbatim.
func (s *APIV1Service) FormatMarkdown(ctx context.Context, request *v1pb.FormatMarkdownRequest) (*v1pb.FormatMarkdownResponse, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}

	text := request.GetText()
	if strings.TrimSpace(text) == "" {
		return nil, status.Errorf(codes.InvalidArgument, "text is required")
	}
	if len(text) > maxFormatMarkdownTextSizeBytes {
		return nil, status.Errorf(codes.InvalidArgument, "text is too large; maximum size is 1 MiB")
	}

	aiSetting, err := s.Store.GetInstanceAISetting(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get AI setting: %v", err)
	}
	providerID := aiSetting.GetDefaultProviderId()
	if providerID == "" {
		return nil, status.Errorf(codes.FailedPrecondition, "no default AI provider is configured")
	}
	provider, model, err := s.resolveAIProviderWithModel(aiSetting, providerID)
	if err != nil {
		return nil, err
	}

	instructions := "Reformat the user's plain text into well-structured Markdown. " +
		"The text was extracted from a PDF, so line breaks may be arbitrary. " +
		"Preserve the original text content completely and verbatim: do not add, remove, summarize, translate, or rephrase anything. " +
		"Only add Markdown structure: headings, lists, tables, emphasis, code blocks, and paragraph breaks where the original layout implies them. " +
		"The input contains lines that are exactly \"---\" on their own line. These are page separators between PDF pages. " +
		"You MUST keep every \"---\" separator exactly where it is, on its own line, and MUST NOT add any new \"---\" line anywhere else. " +
		"Do not use \"---\" (a thematic break / horizontal rule) for any other purpose in the formatted output; use headings or blank lines for section breaks instead. " +
		"Keep the original language. Return only the Markdown, with no surrounding explanation or code fence."
	if filename := strings.TrimSpace(request.GetFilename()); filename != "" {
		instructions += "\n\nThe source file is named: " + filename
	}

	markdown, err := ai.GenerateText(ctx, provider, model, instructions, text)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to format text: %v", err)
	}
	return &v1pb.FormatMarkdownResponse{Markdown: markdown}, nil
}

const maxPolishTextSizeBytes = 128 * 1024

// polishPresetInstructions maps a named preset to the rewrite goal appended to
// the shared polishing instructions. Keep the keys in sync with the frontend.
var polishPresetInstructions = map[string]string{
	"polish":    "Polish the text: improve clarity, flow, and word choice while keeping the meaning.",
	"concise":   "Make the text more concise: remove redundancy and tighten the wording without dropping key information.",
	"expand":    "Expand the text: add detail and elaboration while staying faithful to the original intent.",
	"grammar":   "Correct grammar, spelling, and punctuation. Change wording only as needed for correctness.",
	"tone":      "Adjust the tone to be more natural and appropriate while keeping the meaning.",
	"translate": "Translate the text. The target language must be given in the additional instruction below; if none is given, translate to English.",
}

// PolishText rewrites a selected span of text following a preset or custom
// instruction, returning only the rewritten text.
func (s *APIV1Service) PolishText(ctx context.Context, request *v1pb.PolishTextRequest) (*v1pb.PolishTextResponse, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}

	text := request.GetText()
	if strings.TrimSpace(text) == "" {
		return nil, status.Errorf(codes.InvalidArgument, "text is required")
	}
	if len(text) > maxPolishTextSizeBytes {
		return nil, status.Errorf(codes.InvalidArgument, "text is too large; maximum size is 128 KiB")
	}

	// A preset sets the rewrite goal; a custom instruction, if also given,
	// supplements it (e.g. the target language for "translate", or a style note
	// for "tone"). With no preset, the custom instruction is the goal on its own.
	instruction := strings.TrimSpace(request.GetInstruction())
	preset := strings.TrimSpace(request.GetPreset())
	var goal string
	if preset != "" {
		presetGoal, ok := polishPresetInstructions[preset]
		if !ok {
			return nil, status.Errorf(codes.InvalidArgument, "unknown preset %q", preset)
		}
		goal = presetGoal
		if instruction != "" {
			goal += " Additional instruction from the user: " + instruction
		}
	} else if instruction != "" {
		goal = instruction
	} else {
		goal = polishPresetInstructions["polish"]
	}

	aiSetting, err := s.Store.GetInstanceAISetting(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get AI setting: %v", err)
	}
	providerID := aiSetting.GetDefaultProviderId()
	if providerID == "" {
		return nil, status.Errorf(codes.FailedPrecondition, "no default AI provider is configured")
	}
	provider, model, err := s.resolveAIProviderWithModel(aiSetting, providerID)
	if err != nil {
		return nil, err
	}

	instructions := "You rewrite a span of text that the user selected inside an editor. " +
		goal + " " +
		"Write the result in the same language as the selected text's main content, regardless of the language of this instruction. " +
		"Preserve the original meaning and any Markdown formatting. " +
		"Return only the rewritten text, with no surrounding explanation, quotes, or code fence."

	polished, err := ai.GenerateText(ctx, provider, model, instructions, text)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to polish text: %v", err)
	}
	return &v1pb.PolishTextResponse{Text: strings.TrimSpace(polished)}, nil
}

// resolveAIProviderWithModel resolves a provider and picks a usable chat model for it:
// the provider's first manually-configured model, or a built-in default for Gemini.
func (s *APIV1Service) resolveAIProviderWithModel(setting *storepb.InstanceAISetting, providerID string) (ai.ProviderConfig, string, error) {
	provider, err := s.resolveAIProvider(setting, providerID)
	if err != nil {
		return ai.ProviderConfig{}, "", err
	}
	for _, p := range setting.GetProviders() {
		if p.GetId() != providerID {
			continue
		}
		for _, m := range p.GetModels() {
			if m.GetId() != "" {
				return provider, m.GetId(), nil
			}
		}
	}
	if provider.Type == ai.ProviderGemini {
		return provider, ai.DefaultGeminiTranscriptionModel, nil
	}
	return ai.ProviderConfig{}, "", status.Errorf(codes.FailedPrecondition, "no model is configured for the default AI provider")
}

func buildTranscriptionInstructions(prompt, language string) string {
	parts := []string{
		"Transcribe the audio accurately. Return only the transcript text. " +
			"Do not summarize, explain, or add content that is not spoken.",
	}
	if language = strings.TrimSpace(language); language != "" {
		parts = append(parts, "The input language is "+language+".")
	}
	if prompt = strings.TrimSpace(prompt); prompt != "" {
		parts = append(parts, "Context and spelling hints:\n"+prompt)
	}
	return strings.Join(parts, "\n\n")
}

func (*APIV1Service) resolveAIProvider(setting *storepb.InstanceAISetting, providerID string) (ai.ProviderConfig, error) {
	providers := make([]ai.ProviderConfig, 0, len(setting.GetProviders()))
	for _, provider := range setting.GetProviders() {
		if provider == nil {
			continue
		}
		providers = append(providers, convertAIProviderConfigFromStore(provider))
	}

	provider, err := ai.FindProvider(providers, providerID)
	if err != nil {
		return ai.ProviderConfig{}, status.Errorf(codes.FailedPrecondition, "transcription provider is not configured")
	}
	return *provider, nil
}

func convertAIProviderConfigFromStore(provider *storepb.AIProviderConfig) ai.ProviderConfig {
	return ai.ProviderConfig{
		ID:       provider.GetId(),
		Title:    provider.GetTitle(),
		Type:     convertAIProviderTypeFromStore(provider.GetType()),
		Endpoint: provider.GetEndpoint(),
		APIKey:   provider.GetApiKey(),
	}
}

func convertAIProviderTypeFromStore(providerType storepb.AIProviderType) ai.ProviderType {
	switch providerType {
	case storepb.AIProviderType_OPENAI:
		return ai.ProviderOpenAI
	case storepb.AIProviderType_GEMINI:
		return ai.ProviderGemini
	default:
		return ""
	}
}

func isSupportedTranscriptionContentType(contentType string) bool {
	mediaType, _, err := mime.ParseMediaType(strings.TrimSpace(contentType))
	if err != nil {
		return false
	}
	mediaType = strings.ToLower(mediaType)
	return supportedTranscriptionContentTypes[mediaType]
}
