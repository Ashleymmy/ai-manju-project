package service

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestPromptCatalogMergesConcurrentLoadsAndDegradesPerSource(t *testing.T) {
	var calls atomic.Int32
	catalog := &PromptCatalog{
		client: &http.Client{},
		sources: []promptSource{
			{category: "available", githubURL: "https://github.test/available", load: func(context.Context, *http.Client) ([]SystemPrompt, error) {
				calls.Add(1)
				time.Sleep(30 * time.Millisecond)
				return []SystemPrompt{{ID: "p1", Title: "Night Portrait", Prompt: "Neon portrait", Tags: []string{"portrait", "night"}}}, nil
			}},
			{category: "failed", githubURL: "https://github.test/failed", load: func(context.Context, *http.Client) ([]SystemPrompt, error) {
				return nil, fmt.Errorf("source unavailable")
			}},
		},
		cacheTTL: time.Hour,
	}

	const readers = 12
	results := make(chan PromptListPayload, readers)
	errs := make(chan error, readers)
	var wg sync.WaitGroup
	for range readers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			payload, err := catalog.List(context.Background(), PromptListQuery{Keyword: "neon", Tags: []string{"portrait"}, Page: 1, PageSize: 20})
			results <- payload
			errs <- err
		}()
	}
	wg.Wait()
	close(results)
	close(errs)

	for err := range errs {
		if err != nil {
			t.Fatalf("List() error = %v", err)
		}
	}
	for payload := range results {
		if payload.Total != 1 || len(payload.Items) != 1 || payload.Items[0].Category != "available" || payload.Items[0].GitHubURL == "" {
			t.Fatalf("unexpected payload: %+v", payload)
		}
		if len(payload.Categories) != 2 || payload.Categories[1] != "failed" {
			t.Fatalf("categories should remain stable during source degradation: %#v", payload.Categories)
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("available source calls = %d, want one merged cold load", calls.Load())
	}
}

func TestPromptSourceParsers(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/gpt/data/ingested_tweets.json":
			_, _ = w.Write([]byte(`{"records":[{"title":"Poster","tweet_url":"https://post.test/1","image_dir":"images/1","category":"Poster Cases","added_at":"2026-01-01"}]}`))
		case "/gpt/README.md":
			_, _ = w.Write([]byte("### Case 1: [source](https://post.test/1)\n\n**Prompt:**\n```text\npaint a poster\n```"))
		case "/awesome/README.zh-CN.md":
			_, _ = w.Write([]byte("## 人像 / 夜景\n### [夜景肖像](https://example.test)\n**提示词:**\n```text\nneon portrait\n```\n![](images/a.png)"))
		case "/gpt4o/README.zh-CN.md":
			_, _ = w.Write([]byte("### 海报\n- **提示词文本：** `clean poster`\n![](images/b.png)"))
		case "/youmind/README_zh.md":
			_, _ = w.Write([]byte("### No. 1: 人像 - 夜景\n#### 中文提示词\n```text\nnight scene\n```\n![](images/c.png)"))
		case "/david/prompts.json":
			_, _ = w.Write([]byte(`[{"id":7,"title_cn":"商品图","category_cn":"电商","prompt":"white background","needs_ref":true,"image":"images/d.png"}]`))
		default:
			if len(r.URL.Path) >= len("/gpt/cases/") && r.URL.Path[:len("/gpt/cases/")] == "/gpt/cases/" {
				_, _ = w.Write([]byte(""))
				return
			}
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	ctx := context.Background()
	client := server.Client()
	tests := []struct {
		name string
		load func() ([]SystemPrompt, error)
		id   string
	}{
		{name: "gpt-image-2", load: func() ([]SystemPrompt, error) { return buildGptImage2Prompts(ctx, client, server.URL+"/gpt") }, id: "gpt-image-2-prompts-0001"},
		{name: "awesome", load: func() ([]SystemPrompt, error) { return buildAwesomeGptImagePrompts(ctx, client, server.URL+"/awesome") }, id: "awesome-gpt-image-0001"},
		{name: "gpt4o", load: func() ([]SystemPrompt, error) { return buildAwesomeGpt4oImagePrompts(ctx, client, server.URL+"/gpt4o") }, id: "awesome-gpt4o-image-prompts-0001"},
		{name: "youmind-gpt", load: func() ([]SystemPrompt, error) {
			return buildYouMindPrompts(ctx, client, server.URL+"/youmind", "youmind-gpt-image-2", "gpt-image-2")
		}, id: "youmind-gpt-image-2-0001"},
		{name: "youmind-banana", load: func() ([]SystemPrompt, error) {
			return buildYouMindPrompts(ctx, client, server.URL+"/youmind", "youmind-nano-banana-pro", "nano-banana-pro")
		}, id: "youmind-nano-banana-pro-0001"},
		{name: "david", load: func() ([]SystemPrompt, error) { return buildDavidWuGptImage2Prompts(ctx, client, server.URL+"/david") }, id: "davidwu-gpt-image2-prompts-0007"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			items, err := test.load()
			if err != nil {
				t.Fatalf("load() error = %v", err)
			}
			if len(items) != 1 || items[0].ID != test.id || items[0].Prompt == "" {
				t.Fatalf("unexpected parsed items: %#v", items)
			}
		})
	}
}
