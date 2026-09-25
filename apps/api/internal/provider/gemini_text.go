package provider

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// ErrTextInputNotSubmitted identifies preparation failures before any paid POST.
var ErrTextInputNotSubmitted = errors.New("text reference input could not be prepared")

const (
	// Bound the aggregate decoded references and preparation time per request.
	geminiTextReferenceBytes   = 20 * 1024 * 1024
	geminiTextReferenceTimeout = 90 * time.Second
)

func (c *OpenAICompatibleClient) geminiTextBody(ctx context.Context, request TextGenerationRequest) (map[string]any, error) {
	ctx, cancel := context.WithTimeout(ctx, geminiTextReferenceTimeout)
	defer cancel()
	if len(request.Tools) != 0 {
		return nil, fmt.Errorf("%w: native tool calls are unsupported", ErrTextInputNotSubmitted)
	}
	if len(request.Messages) == 0 {
		return geminiGenerateContentBody(request.Prompt), nil
	}
	contents := []map[string]any{}
	system := []map[string]any{}
	remaining := int64(geminiTextReferenceBytes)
	for _, message := range request.Messages {
		role := strings.ToLower(stringField(message["role"]))
		if role != "user" && role != "assistant" && role != "system" && role != "developer" {
			return nil, fmt.Errorf("%w: unsupported message role", ErrTextInputNotSubmitted)
		}
		parts, err := c.geminiTextParts(ctx, message["content"], &remaining)
		if err != nil {
			return nil, err
		}
		if role == "system" || role == "developer" {
			system = append(system, parts...)
			continue
		}
		if role == "assistant" {
			role = "model"
		}
		contents = append(contents, map[string]any{"role": role, "parts": parts})
	}
	if len(contents) == 0 {
		return nil, fmt.Errorf("%w: no user conversation", ErrTextInputNotSubmitted)
	}
	body := map[string]any{"contents": contents}
	if len(system) > 0 {
		body["systemInstruction"] = map[string]any{"parts": system}
	}
	return body, nil
}

func (c *OpenAICompatibleClient) geminiTextParts(ctx context.Context, content any, remaining *int64) ([]map[string]any, error) {
	if text, ok := content.(string); ok {
		return []map[string]any{{"text": text}}, nil
	}
	items, ok := content.([]any)
	if records, recordsOK := content.([]map[string]any); recordsOK {
		items, ok = make([]any, len(records)), true
		for i, record := range records {
			items[i] = record
		}
	}
	if !ok || len(items) == 0 {
		return nil, fmt.Errorf("%w: unsupported message content", ErrTextInputNotSubmitted)
	}
	parts := make([]map[string]any, 0, len(items))
	for _, item := range items {
		record, ok := item.(map[string]any)
		if !ok {
			return nil, ErrTextInputNotSubmitted
		}
		switch strings.ToLower(stringField(record["type"])) {
		case "text", "input_text", "output_text":
			parts = append(parts, map[string]any{"text": stringField(record["text"])})
		case "image_url", "input_image":
			data, mime, err := c.geminiTextImage(ctx, messageImageURL(record["image_url"]), *remaining)
			if err != nil {
				return nil, err
			}
			*remaining -= int64(len(data))
			parts = append(parts, map[string]any{"inlineData": map[string]any{"mimeType": mime, "data": base64.StdEncoding.EncodeToString(data)}})
		default:
			return nil, fmt.Errorf("%w: unsupported message part", ErrTextInputNotSubmitted)
		}
	}
	return parts, nil
}

func (c *OpenAICompatibleClient) geminiTextImage(ctx context.Context, raw string, limit int64) ([]byte, string, error) {
	var data []byte
	var err error
	if strings.HasPrefix(raw, "data:") {
		header, encoded, ok := strings.Cut(raw, ",")
		if !ok || !strings.HasSuffix(header, ";base64") || int64(base64.StdEncoding.DecodedLen(len(encoded))) > limit+2 {
			return nil, "", ErrTextInputNotSubmitted
		}
		data, err = base64.StdEncoding.DecodeString(encoded)
	} else {
		req, requestErr := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
		if requestErr != nil || c.mediaClient == nil {
			return nil, "", ErrTextInputNotSubmitted
		}
		res, fetchErr := c.mediaClient.Do(req)
		if fetchErr != nil {
			return nil, "", ErrTextInputNotSubmitted
		}
		defer res.Body.Close()
		if res.StatusCode != http.StatusOK || res.ContentLength > limit {
			return nil, "", ErrTextInputNotSubmitted
		}
		data, err = io.ReadAll(io.LimitReader(res.Body, limit+1))
	}
	if err != nil || len(data) == 0 || int64(len(data)) > limit {
		return nil, "", ErrTextInputNotSubmitted
	}
	mime := http.DetectContentType(data)
	switch mime {
	case "image/png", "image/jpeg", "image/webp", "image/gif":
		return data, mime, nil
	default:
		return nil, "", ErrTextInputNotSubmitted
	}
}
