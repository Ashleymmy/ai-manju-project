package provider

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ai-manju/api/internal/model"
)

func TestJoinBaseURLAddsV1ForRootBaseURL(t *testing.T) {
	got, err := joinBaseURL("https://api.openai.com", "/responses")
	if err != nil {
		t.Fatal(err)
	}
	if got != "https://api.openai.com/v1/responses" {
		t.Fatalf("joinBaseURL root = %q", got)
	}
}

func TestJoinBaseURLDoesNotDuplicateV1(t *testing.T) {
	got, err := joinBaseURL("https://api.openai.com/v1", "/responses")
	if err != nil {
		t.Fatal(err)
	}
	if got != "https://api.openai.com/v1/responses" {
		t.Fatalf("joinBaseURL v1 = %q", got)
	}
}

func TestJoinBaseURLRecognizesAliyunAPIv1(t *testing.T) {
	got, err := joinBaseURL("https://example.com", "/api/v1/tasks/task-1")
	if err != nil {
		t.Fatal(err)
	}
	if got != "https://example.com/api/v1/tasks/task-1" {
		t.Fatalf("joinBaseURL aliyun = %q", got)
	}
}

func TestAliyunYikeVideoAsyncHeaderOnlyOnCreate(t *testing.T) {
	var createHeader, queryHeader string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method + " " + r.URL.Path {
		case http.MethodPost + " /api/v1/services/aigc/video-generation/video-synthesis":
			createHeader = r.Header.Get("X-DashScope-Async")
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"output":{"task_id":"wan-task"}}`))
		case http.MethodGet + " /api/v1/tasks/wan-task":
			queryHeader = r.Header.Get("X-DashScope-Async")
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"output":{"task_status":"SUCCEEDED"}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client, err := NewOpenAICompatibleClient(model.ModelProviderConfig{
		ProviderType: model.ModelProviderTypeAliyunYike,
		Mode:         model.ModelProviderModeOpenAICompatible,
		BaseURL:      server.URL,
		AuthType:     model.ModelProviderAuthTypeNone,
		VideoModel:   "wan3.0-video",
		Capabilities: model.JSONB(`["video"]`),
		TimeoutMS:    model.ModelProviderDefaultTimeoutMilli,
		Enabled:      true,
	}, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.ProxyJSON(context.Background(), http.MethodPost, "/api/v1/services/aigc/video-generation/video-synthesis", map[string]any{"model": "wan3.0-video"}, true); err != nil {
		t.Fatal(err)
	}
	if _, err := client.ProxyJSON(context.Background(), http.MethodGet, "/api/v1/tasks/wan-task", nil, false); err != nil {
		t.Fatal(err)
	}
	if createHeader != "enable" || queryHeader != "" {
		t.Fatalf("headers = create %q, query %q", createHeader, queryHeader)
	}
}

func TestJoinGeminiBaseURLAddsV1BetaForRootBaseURL(t *testing.T) {
	got, err := joinGeminiBaseURL("https://generativelanguage.googleapis.com", "/models")
	if err != nil {
		t.Fatal(err)
	}
	if got != "https://generativelanguage.googleapis.com/v1beta/models" {
		t.Fatalf("joinGeminiBaseURL root = %q", got)
	}
}

func TestNormalizeResponseTextOutputText(t *testing.T) {
	text, model, err := normalizeResponseText([]byte(`{"model":"gpt-5.5","output_text":"pong"}`), "fallback")
	if err != nil {
		t.Fatal(err)
	}
	if text != "pong" || model != "gpt-5.5" {
		t.Fatalf("normalizeResponseText = text:%q model:%q", text, model)
	}
}

func TestNormalizeResponseTextOutputContent(t *testing.T) {
	text, model, err := normalizeResponseText([]byte(`{"output":[{"type":"message","content":[{"type":"output_text","text":"pong"}]}]}`), "fallback")
	if err != nil {
		t.Fatal(err)
	}
	if text != "pong" || model != "fallback" {
		t.Fatalf("normalizeResponseText = text:%q model:%q", text, model)
	}
}

func TestNormalizeResponseTextCompletedEnvelope(t *testing.T) {
	text, model, err := normalizeResponseText([]byte(`{"type":"response.completed","response":{"model":"gpt-envelope","output":[{"type":"message","content":[{"type":"output_text","text":"pong"}]}]}}`), "fallback")
	if err != nil {
		t.Fatal(err)
	}
	if text != "pong" || model != "gpt-envelope" {
		t.Fatalf("normalizeResponseText = text:%q model:%q", text, model)
	}
}

func TestGenerateTextRequestForwardsResponsesMessagesAndTools(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		input, _ := body["input"].([]any)
		if len(input) != 3 {
			t.Fatalf("input = %#v", body["input"])
		}
		last, _ := input[2].(map[string]any)
		if last["type"] != "function_call_output" || last["call_id"] != "call_1" {
			t.Fatalf("function output = %#v", last)
		}
		tools, _ := body["tools"].([]any)
		tool, _ := tools[0].(map[string]any)
		if tool["name"] != "canvas_add_node" || tool["function"] != nil {
			t.Fatalf("Responses tool = %#v", tool)
		}
		if body["parallel_tool_calls"] != false {
			t.Fatalf("parallel_tool_calls = %#v", body["parallel_tool_calls"])
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"model":"gpt-agent","status":"completed","output":[{"type":"function_call","call_id":"call_2","name":"canvas_add_node","arguments":"{\"type\":\"image\"}"}]}`))
	}))
	defer server.Close()

	client := newTextTestClient(t, server.URL, nil)
	result, err := client.GenerateTextRequest(context.Background(), TextGenerationRequest{
		Model: "gpt-agent",
		Messages: []map[string]any{
			{"role": "user", "content": "add an image node"},
			{"type": "function_call", "call_id": "call_1", "name": "canvas_get_state", "arguments": "{}"},
			{"role": "tool", "tool_call_id": "call_1", "content": `{"nodes":[]}`},
		},
		Tools:      []map[string]any{{"type": "function", "function": map[string]any{"name": "canvas_add_node", "parameters": map[string]any{"type": "object"}}}},
		ToolChoice: map[string]any{"type": "function", "name": "canvas_add_node"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Text != "" || result.Model != "gpt-agent" || result.FinishReason != "tool_calls" || len(result.ToolCalls) != 1 {
		t.Fatalf("result = %#v", result)
	}
	if result.ToolCalls[0].ID != "call_2" || result.ToolCalls[0].Function.Name != "canvas_add_node" {
		t.Fatalf("tool call = %#v", result.ToolCalls[0])
	}
}

func TestGenerateTextRequestForwardsChatMessagesAndTools(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		messages, _ := body["messages"].([]any)
		if len(messages) != 2 {
			t.Fatalf("messages = %#v", body["messages"])
		}
		assistant, _ := messages[0].(map[string]any)
		if assistant["role"] != "assistant" || assistant["tool_calls"] == nil {
			t.Fatalf("assistant function call = %#v", assistant)
		}
		choice, _ := body["tool_choice"].(map[string]any)
		if _, ok := choice["function"].(map[string]any); !ok {
			t.Fatalf("Chat tool_choice = %#v", choice)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"model":"chat-agent","choices":[{"finish_reason":"tool_calls","message":{"role":"assistant","content":"checking","tool_calls":[{"id":"call_3","type":"function","function":{"name":"canvas_get_state","arguments":"{}"}}]}}]}`))
	}))
	defer server.Close()

	client := newTextTestClient(t, server.URL, model.JSONB(`{"text_generation":"/chat/completions"}`))
	result, err := client.GenerateTextRequest(context.Background(), TextGenerationRequest{
		Messages: []map[string]any{
			{"type": "function_call", "call_id": "call_2", "name": "canvas_add_node", "arguments": "{}"},
			{"role": "tool", "tool_call_id": "call_2", "content": `{"ok":true}`},
		},
		Tools:      []map[string]any{{"type": "function", "function": map[string]any{"name": "canvas_get_state", "parameters": map[string]any{"type": "object"}}}},
		ToolChoice: map[string]any{"type": "function", "name": "canvas_get_state"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Text != "checking" || result.Model != "chat-agent" || result.FinishReason != "tool_calls" || len(result.ToolCalls) != 1 {
		t.Fatalf("result = %#v", result)
	}
}

func TestGenerateTextRequestAggregatesChatSSEToolCalls(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"model\":\"chat-sse-agent\",\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_sse\",\"type\":\"function\",\"function\":{\"name\":\"canvas_add_node\",\"arguments\":\"{\\\"type\\\":\"}}]}}]}\n\n" +
			"data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"\\\"image\\\"}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\n" +
			"data: [DONE]\n\n"))
	}))
	defer server.Close()

	client := newTextTestClient(t, server.URL, model.JSONB(`{"text_generation":"/chat/completions"}`))
	result, err := client.GenerateTextRequest(context.Background(), TextGenerationRequest{Prompt: "add"})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.ToolCalls) != 1 || result.ToolCalls[0].Function.Arguments != `{"type":"image"}` || result.FinishReason != "tool_calls" {
		t.Fatalf("result = %#v", result)
	}
}

func TestGenerateTextUsesResponsesInputArray(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/responses" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		input, ok := body["input"].([]any)
		if !ok || len(input) != 1 {
			t.Fatalf("input = %#v, want one-item array", body["input"])
		}
		if stream, ok := body["stream"].(bool); !ok || stream {
			t.Fatalf("stream = %#v, want false", body["stream"])
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"model":"gpt-test","output_text":"pong"}`))
	}))
	defer server.Close()

	client := newTextTestClient(t, server.URL, nil)
	result, err := client.GenerateText(context.Background(), "ping", "")
	if err != nil {
		t.Fatal(err)
	}
	if result.Text != "pong" || result.Model != "gpt-test" {
		t.Fatalf("result = %#v", result)
	}
}

func TestGenerateTextSupportsChatCompletionsOverride(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		messages, ok := body["messages"].([]any)
		if !ok || len(messages) != 1 {
			t.Fatalf("messages = %#v", body["messages"])
		}
		if stream, ok := body["stream"].(bool); !ok || stream {
			t.Fatalf("stream = %#v, want false", body["stream"])
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"model":"chat-model","choices":[{"message":{"role":"assistant","content":"chat pong"}}]}`))
	}))
	defer server.Close()

	client := newTextTestClient(t, server.URL, model.JSONB(`{"text_generation":"/chat/completions"}`))
	result, err := client.GenerateText(context.Background(), "ping", "")
	if err != nil {
		t.Fatal(err)
	}
	if result.Text != "chat pong" || result.Model != "chat-model" {
		t.Fatalf("result = %#v", result)
	}
}

func TestGenerateTextFallsBackToChatCompletionsOnMissingResponsesEndpoint(t *testing.T) {
	paths := make([]string, 0, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		if r.URL.Path == "/v1/responses" {
			http.NotFound(w, r)
			return
		}
		if r.URL.Path != "/v1/chat/completions" {
			t.Fatalf("fallback path = %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"fallback pong"}}]}`))
	}))
	defer server.Close()

	client := newTextTestClient(t, server.URL, nil)
	result, err := client.GenerateText(context.Background(), "ping", "")
	if err != nil {
		t.Fatal(err)
	}
	if result.Text != "fallback pong" {
		t.Fatalf("result = %#v", result)
	}
	if len(paths) != 2 || paths[0] != "/v1/responses" || paths[1] != "/v1/chat/completions" {
		t.Fatalf("paths = %#v", paths)
	}
}

func TestGenerateTextAcceptsResponsesSSE(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
		_, _ = w.Write([]byte("event: response.output_text.delta\n" +
			"data: {\"type\":\"response.output_text.delta\",\"delta\":\"剧本\"}\n\n" +
			"event: response.output_text.done\n" +
			"data: {\"type\":\"response.output_text.done\",\"text\":\"剧本资产\"}\n\n" +
			"event: response.completed\n" +
			"data: {\"type\":\"response.completed\",\"response\":{\"model\":\"gpt-sse\",\"output\":[{\"type\":\"message\",\"content\":[{\"type\":\"output_text\",\"text\":\"剧本资产\"}]}]}}\n\n" +
			"data: [DONE]\n\n"))
	}))
	defer server.Close()

	client := newTextTestClient(t, server.URL, nil)
	result, err := client.GenerateText(context.Background(), "ping", "")
	if err != nil {
		t.Fatal(err)
	}
	if result.Text != "剧本资产" || result.Model != "gpt-sse" {
		t.Fatalf("result = %#v", result)
	}
}

func TestGenerateTextAcceptsResponsesSSEWithEmptyTerminalOutput(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
		_, _ = w.Write([]byte("event: response.output_text.delta\n" +
			"data: {\"type\":\"response.output_text.delta\",\"delta\":\"Luna 正文\"}\n\n" +
			"event: response.output_item.done\n" +
			"data: {\"type\":\"response.output_item.done\",\"item\":{\"type\":\"message\",\"content\":[{\"type\":\"output_text\",\"text\":\"Luna 正文\"}]}}\n\n" +
			"event: response.completed\n" +
			"data: {\"type\":\"response.completed\",\"response\":{\"model\":\"gpt-5.6-luna\",\"status\":\"completed\",\"output\":[]}}\n\n" +
			"data: [DONE]\n\n"))
	}))
	defer server.Close()

	client := newTextTestClient(t, server.URL, nil)
	result, err := client.GenerateText(context.Background(), "ping", "")
	if err != nil {
		t.Fatal(err)
	}
	if result.Text != "Luna 正文" || result.Model != "gpt-5.6-luna" {
		t.Fatalf("result = %#v", result)
	}
}

func TestGenerateTextAcceptsChatCompletionsSSE(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"model\":\"chat-sse\",\"choices\":[{\"delta\":{\"content\":\"chat \"}}]}\n\n" +
			"data: {\"model\":\"chat-sse\",\"choices\":[{\"delta\":{\"content\":\"pong\"}}]}\n\n" +
			"data: [DONE]\n\n"))
	}))
	defer server.Close()

	client := newTextTestClient(t, server.URL, model.JSONB(`{"text_generation":"/chat/completions"}`))
	result, err := client.GenerateText(context.Background(), "ping", "")
	if err != nil {
		t.Fatal(err)
	}
	if result.Text != "chat pong" || result.Model != "chat-sse" {
		t.Fatalf("result = %#v", result)
	}
}

func TestGenerateTextReturnsResponsesSSEError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("event: error\ndata: {\"type\":\"error\",\"message\":\"upstream rejected input\"}\n\n"))
	}))
	defer server.Close()

	client := newTextTestClient(t, server.URL, nil)
	_, err := client.GenerateText(context.Background(), "ping", "")
	if err == nil || err.Error() != "upstream rejected input" {
		t.Fatalf("err = %v", err)
	}
}

func TestGenerateTextDetectsSSEWithoutContentType(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("event: response.output_text.done\ndata: {\"type\":\"response.output_text.done\",\"text\":\"header fallback\"}\n\n"))
	}))
	defer server.Close()

	client := newTextTestClient(t, server.URL, nil)
	result, err := client.GenerateText(context.Background(), "ping", "")
	if err != nil {
		t.Fatal(err)
	}
	if result.Text != "header fallback" {
		t.Fatalf("result = %#v", result)
	}
}

func TestGenerateTextHonorsCanceledContext(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	defer server.Close()

	client := newTextTestClient(t, server.URL, nil)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := client.GenerateText(ctx, "ping", "")
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
}

func newTextTestClient(t *testing.T, baseURL string, overrides model.JSONB) *OpenAICompatibleClient {
	t.Helper()
	client, err := NewOpenAICompatibleClient(model.ModelProviderConfig{
		Mode:              model.ModelProviderModeOpenAICompatible,
		BaseURL:           baseURL,
		AuthType:          model.ModelProviderAuthTypeNone,
		TextModel:         "gpt-test",
		EndpointOverrides: overrides,
		TimeoutMS:         model.ModelProviderDefaultTimeoutMilli,
		Enabled:           true,
	}, "")
	if err != nil {
		t.Fatal(err)
	}
	return client
}

func TestNormalizeImageGenerationResponseFromResponsesImageTool(t *testing.T) {
	result, err := normalizeImageGenerationResponse([]byte(`{"model":"gpt-5.5","output":[{"type":"image_generation_call","result":"abcd"}]}`), "fallback")
	if err != nil {
		t.Fatal(err)
	}
	if result.Model != "gpt-5.5" || len(result.Data) != 1 || result.Data[0].B64JSON != "abcd" {
		t.Fatalf("normalizeImageGenerationResponse = %#v", result)
	}
}

func TestShouldUseResponsesImageGenerationForGPT41Spellings(t *testing.T) {
	for _, modelID := range []string{"gpt-4.1", "gpt-4.1-mini", "gpt-4-1", "gpt-4-1-mini"} {
		if !shouldUseResponsesImageGeneration(modelID) {
			t.Fatalf("shouldUseResponsesImageGeneration(%q) = false", modelID)
		}
	}
}
