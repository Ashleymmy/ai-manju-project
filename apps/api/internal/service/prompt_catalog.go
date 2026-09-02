package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode"
)

const (
	defaultPromptCacheTTL        = time.Hour
	defaultPromptRequestTimeout  = 30 * time.Second
	maxPromptSourceResponseBytes = 16 * 1024 * 1024
)

type SystemPrompt struct {
	ID        string   `json:"id"`
	Title     string   `json:"title"`
	CoverURL  string   `json:"coverUrl"`
	Prompt    string   `json:"prompt"`
	Tags      []string `json:"tags"`
	Category  string   `json:"category"`
	GitHubURL string   `json:"githubUrl"`
	Preview   string   `json:"preview"`
	CreatedAt string   `json:"createdAt"`
	UpdatedAt string   `json:"updatedAt"`
}

type PromptListQuery struct {
	Keyword  string
	Tags     []string
	Category string
	Page     int
	PageSize int
}

type PromptListPayload struct {
	Items      []SystemPrompt `json:"items"`
	Tags       []string       `json:"tags"`
	Categories []string       `json:"categories"`
	Total      int            `json:"total"`
}

type promptSource struct {
	category  string
	githubURL string
	load      func(context.Context, *http.Client) ([]SystemPrompt, error)
}

type promptLoad struct {
	done  chan struct{}
	items []SystemPrompt
	err   error
}

type PromptCatalog struct {
	mu        sync.Mutex
	client    *http.Client
	sources   []promptSource
	cacheTTL  time.Duration
	items     []SystemPrompt
	fetchedAt time.Time
	loading   *promptLoad
}

func NewPromptCatalog() *PromptCatalog {
	return &PromptCatalog{
		client:   &http.Client{Timeout: defaultPromptRequestTimeout},
		sources:  defaultPromptSources(),
		cacheTTL: defaultPromptCacheTTL,
	}
}

func (c *PromptCatalog) List(ctx context.Context, query PromptListQuery) (PromptListPayload, error) {
	items, err := c.get(ctx)
	if err != nil {
		return PromptListPayload{}, err
	}

	keyword := strings.ToLower(strings.TrimSpace(query.Keyword))
	category := strings.TrimSpace(query.Category)
	tags := nonEmptyStrings(query.Tags)
	withoutTagFilter := filterSystemPrompts(items, keyword, category, nil)
	filtered := filterSystemPrompts(items, keyword, category, tags)
	page := query.Page
	if page < 1 {
		page = 1
	}
	pageSize := query.PageSize
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	start := (page - 1) * pageSize
	if start > len(filtered) {
		start = len(filtered)
	}
	end := start + pageSize
	if end > len(filtered) {
		end = len(filtered)
	}

	return PromptListPayload{
		Items:      append([]SystemPrompt(nil), filtered[start:end]...),
		Tags:       collectPromptTags(withoutTagFilter),
		Categories: c.categories(),
		Total:      len(filtered),
	}, nil
}

func (c *PromptCatalog) get(ctx context.Context) ([]SystemPrompt, error) {
	c.mu.Lock()
	if c.items != nil && time.Since(c.fetchedAt) < c.cacheTTL {
		items := append([]SystemPrompt(nil), c.items...)
		c.mu.Unlock()
		return items, nil
	}
	if current := c.loading; current != nil {
		c.mu.Unlock()
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-current.done:
			return append([]SystemPrompt(nil), current.items...), current.err
		}
	}
	current := &promptLoad{done: make(chan struct{})}
	c.loading = current
	stale := append([]SystemPrompt(nil), c.items...)
	c.mu.Unlock()

	items, err := c.loadAll(ctx)
	if err != nil && len(stale) > 0 {
		items = stale
		err = nil
	}

	c.mu.Lock()
	if err == nil {
		c.items = append([]SystemPrompt(nil), items...)
		c.fetchedAt = time.Now()
	}
	current.items = append([]SystemPrompt(nil), items...)
	current.err = err
	close(current.done)
	c.loading = nil
	c.mu.Unlock()
	return items, err
}

func (c *PromptCatalog) loadAll(ctx context.Context) ([]SystemPrompt, error) {
	type result struct {
		index int
		items []SystemPrompt
		err   error
	}
	results := make(chan result, len(c.sources))
	for index, source := range c.sources {
		go func(index int, source promptSource) {
			items, err := source.load(ctx, c.client)
			if err == nil {
				for itemIndex := range items {
					items[itemIndex].Category = source.category
					items[itemIndex].GitHubURL = source.githubURL
				}
			}
			results <- result{index: index, items: items, err: err}
		}(index, source)
	}

	ordered := make([][]SystemPrompt, len(c.sources))
	succeeded := 0
	var failures []error
	for range c.sources {
		loaded := <-results
		if loaded.err != nil {
			failures = append(failures, loaded.err)
			continue
		}
		succeeded++
		ordered[loaded.index] = loaded.items
	}
	if succeeded == 0 {
		return nil, fmt.Errorf("all prompt sources failed: %w", errors.Join(failures...))
	}
	items := make([]SystemPrompt, 0)
	for _, sourceItems := range ordered {
		items = append(items, sourceItems...)
	}
	return items, nil
}

func (c *PromptCatalog) categories() []string {
	categories := make([]string, 0, len(c.sources))
	for _, source := range c.sources {
		categories = append(categories, source.category)
	}
	return categories
}

func defaultPromptSources() []promptSource {
	const (
		gptImage2RawBase             = "https://raw.githubusercontent.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts/main"
		awesomeGptImageRawBase       = "https://raw.githubusercontent.com/ZeroLu/awesome-gpt-image/main"
		awesomeGpt4oImagePromptsBase = "https://raw.githubusercontent.com/ImgEdify/Awesome-GPT4o-Image-Prompts/main"
		youMindGptImage2RawBase      = "https://raw.githubusercontent.com/YouMind-OpenLab/awesome-gpt-image-2/main"
		youMindNanoBananaProRawBase  = "https://raw.githubusercontent.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts/main"
		davidWuGptImage2RawBase      = "https://raw.githubusercontent.com/davidwuw0811-boop/awesome-gpt-image2-prompts/main"
	)
	return []promptSource{
		{category: "gpt-image-2-prompts", githubURL: "https://github.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts", load: func(ctx context.Context, client *http.Client) ([]SystemPrompt, error) {
			return buildGptImage2Prompts(ctx, client, gptImage2RawBase)
		}},
		{category: "awesome-gpt-image", githubURL: "https://github.com/ZeroLu/awesome-gpt-image", load: func(ctx context.Context, client *http.Client) ([]SystemPrompt, error) {
			return buildAwesomeGptImagePrompts(ctx, client, awesomeGptImageRawBase)
		}},
		{category: "awesome-gpt4o-image-prompts", githubURL: "https://github.com/ImgEdify/Awesome-GPT4o-Image-Prompts", load: func(ctx context.Context, client *http.Client) ([]SystemPrompt, error) {
			return buildAwesomeGpt4oImagePrompts(ctx, client, awesomeGpt4oImagePromptsBase)
		}},
		{category: "youmind-gpt-image-2", githubURL: "https://github.com/YouMind-OpenLab/awesome-gpt-image-2", load: func(ctx context.Context, client *http.Client) ([]SystemPrompt, error) {
			return buildYouMindPrompts(ctx, client, youMindGptImage2RawBase, "youmind-gpt-image-2", "gpt-image-2")
		}},
		{category: "youmind-nano-banana-pro", githubURL: "https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts", load: func(ctx context.Context, client *http.Client) ([]SystemPrompt, error) {
			return buildYouMindPrompts(ctx, client, youMindNanoBananaProRawBase, "youmind-nano-banana-pro", "nano-banana-pro")
		}},
		{category: "davidwu-gpt-image2-prompts", githubURL: "https://github.com/davidwuw0811-boop/awesome-gpt-image2-prompts", load: func(ctx context.Context, client *http.Client) ([]SystemPrompt, error) {
			return buildDavidWuGptImage2Prompts(ctx, client, davidWuGptImage2RawBase)
		}},
	}
}

var (
	gptImage2CasePattern = regexp.MustCompile(`(?s)### Case \d+: \[[^\]]+\]\(([^)]+)\).*?\*\*Prompt:\*\*\s*\r?\n\s*` + "```" + `[\w-]*\r?\n(.*?)\r?\n` + "```")
	markdownImagePattern = regexp.MustCompile(`!\[[^\]]*\]\(([^)]+)\)`)
	markdownLinkPattern  = regexp.MustCompile(`\[([^\]]+)\]\([^)]+\)`)
)

func buildGptImage2Prompts(ctx context.Context, client *http.Client, baseURL string) ([]SystemPrompt, error) {
	var data struct {
		Records []struct {
			Title    string `json:"title"`
			TweetURL string `json:"tweet_url"`
			ImageDir string `json:"image_dir"`
			Category string `json:"category"`
			AddedAt  string `json:"added_at"`
		} `json:"records"`
	}
	if err := fetchPromptJSON(ctx, client, baseURL, "data/ingested_tweets.json", &data); err != nil {
		return nil, err
	}
	caseFiles := []string{"README.md", "cases/ad-creative.md", "cases/character.md", "cases/comparison.md", "cases/ecommerce.md", "cases/portrait.md", "cases/poster.md", "cases/ui.md"}
	markdowns := make([]string, len(caseFiles))
	errs := make(chan error, len(caseFiles))
	var wg sync.WaitGroup
	for index, file := range caseFiles {
		wg.Add(1)
		go func(index int, file string) {
			defer wg.Done()
			markdown, err := fetchPromptText(ctx, client, baseURL, file)
			if err != nil {
				errs <- err
				return
			}
			markdowns[index] = markdown
		}(index, file)
	}
	wg.Wait()
	close(errs)
	if err := <-errs; err != nil {
		return nil, err
	}
	cases := make(map[string]string)
	for _, markdown := range markdowns {
		for _, match := range gptImage2CasePattern.FindAllStringSubmatch(markdown, -1) {
			cases[match[1]] = strings.TrimSpace(match[2])
		}
	}
	items := make([]SystemPrompt, 0)
	for _, record := range data.Records {
		prompt := cases[record.TweetURL]
		if record.Title == "" || prompt == "" || record.ImageDir == "" {
			continue
		}
		image := baseURL + "/" + strings.Trim(record.ImageDir, "/") + "/output.jpg"
		items = append(items, SystemPrompt{
			ID:        "gpt-image-2-prompts-" + leftPad(len(items)+1),
			Title:     record.Title,
			CoverURL:  image,
			Prompt:    prompt,
			Tags:      splitPromptTags(strings.TrimSuffix(record.Category, " Cases"), regexp.MustCompile(`(?i)\s*(?:&|and)\s*`)),
			Preview:   markdownPreview([]string{image}),
			CreatedAt: record.AddedAt,
			UpdatedAt: record.AddedAt,
		})
	}
	return items, nil
}

func buildAwesomeGptImagePrompts(ctx context.Context, client *http.Client, baseURL string) ([]SystemPrompt, error) {
	markdown, err := fetchPromptText(ctx, client, baseURL, "README.zh-CN.md")
	if err != nil {
		return nil, err
	}
	headingPattern := regexp.MustCompile(`(?m)^##\s+(.+)$`)
	titlePattern := regexp.MustCompile(`(?m)^###\s+(.+)$`)
	promptPattern := regexp.MustCompile(`(?s)\*\*提示词:\*\*\s*\r?\n\s*` + "```" + `[\w-]*\r?\n(.*?)\r?\n` + "```")
	items := make([]SystemPrompt, 0)
	for _, section := range splitBeforeHeading(markdown, "## ") {
		tags := tagsFromHeading(firstPromptMatch(section, headingPattern))
		for _, block := range splitBeforeHeading(section, "### ") {
			title := strings.TrimSpace(markdownLinkPattern.ReplaceAllString(firstPromptMatch(block, titlePattern), "$1"))
			prompt := strings.TrimSpace(firstPromptMatch(block, promptPattern))
			if title == "" || prompt == "" {
				continue
			}
			images := extractMarkdownImages(baseURL, block)
			cover := ""
			if len(images) > 0 {
				cover = images[0]
			}
			items = append(items, defaultSystemPrompt("awesome-gpt-image-"+leftPad(len(items)+1), title, prompt, cover, tags, markdownPreview(images)))
		}
	}
	return items, nil
}

func buildAwesomeGpt4oImagePrompts(ctx context.Context, client *http.Client, baseURL string) ([]SystemPrompt, error) {
	markdown, err := fetchPromptText(ctx, client, baseURL, "README.zh-CN.md")
	if err != nil {
		return nil, err
	}
	titlePattern := regexp.MustCompile(`(?m)^###\s+(.+)$`)
	promptPattern := regexp.MustCompile("(?s)- \\*\\*提示词文本：\\*\\*\\s*`(.*?)`")
	items := make([]SystemPrompt, 0)
	for _, block := range splitBeforeHeading(markdown, "### ") {
		title := strings.TrimSpace(firstPromptMatch(block, titlePattern))
		prompt := strings.TrimSpace(firstPromptMatch(block, promptPattern))
		if title == "" || prompt == "" {
			continue
		}
		images := extractMarkdownImages(baseURL, block)
		cover := ""
		if len(images) > 0 {
			cover = images[0]
		}
		items = append(items, defaultSystemPrompt("awesome-gpt4o-image-prompts-"+leftPad(len(items)+1), title, prompt, cover, []string{"gpt4o"}, markdownPreview(images)))
	}
	return items, nil
}

func buildYouMindPrompts(ctx context.Context, client *http.Client, baseURL string, idPrefix string, modelTag string) ([]SystemPrompt, error) {
	markdown, err := fetchPromptText(ctx, client, baseURL, "README_zh.md")
	if err != nil {
		return nil, err
	}
	titlePattern := regexp.MustCompile(`(?m)^###\s+No\.\s*\d+:\s*(.+)$`)
	promptPattern := regexp.MustCompile(`(?s)#### .*?提示词\s*\r?\n\s*` + "```" + `[\w-]*\r?\n(.*?)\r?\n` + "```")
	items := make([]SystemPrompt, 0)
	for _, block := range splitBeforeHeading(markdown, "### ") {
		title := strings.TrimSpace(firstPromptMatch(block, titlePattern))
		prompt := strings.TrimSpace(firstPromptMatch(block, promptPattern))
		if title == "" || prompt == "" {
			continue
		}
		images := extractMarkdownImages(baseURL, block)
		cover := ""
		if len(images) > 0 {
			cover = images[0]
		}
		prefix := ""
		if before, _, found := strings.Cut(title, " - "); found {
			prefix = before
		}
		tags := append([]string{modelTag}, tagsFromHeading(prefix)...)
		items = append(items, defaultSystemPrompt(idPrefix+"-"+leftPad(len(items)+1), title, prompt, cover, tags, markdownPreview(images)))
	}
	return items, nil
}

func buildDavidWuGptImage2Prompts(ctx context.Context, client *http.Client, baseURL string) ([]SystemPrompt, error) {
	var data []struct {
		ID         int    `json:"id"`
		TitleEN    string `json:"title_en"`
		TitleCN    string `json:"title_cn"`
		Category   string `json:"category"`
		CategoryCN string `json:"category_cn"`
		Prompt     string `json:"prompt"`
		Note       string `json:"note"`
		Author     string `json:"author"`
		Source     string `json:"source"`
		NeedsRef   bool   `json:"needs_ref"`
		Image      string `json:"image"`
	}
	if err := fetchPromptJSON(ctx, client, baseURL, "prompts.json", &data); err != nil {
		return nil, err
	}
	items := make([]SystemPrompt, 0, len(data))
	for index, record := range data {
		title := strings.TrimSpace(record.TitleCN)
		if title == "" {
			title = strings.TrimSpace(record.TitleEN)
		}
		prompt := strings.TrimSpace(record.Prompt)
		if title == "" || prompt == "" {
			continue
		}
		id := record.ID
		if id == 0 {
			id = index + 1
		}
		image := absolutePromptImage(baseURL, record.Image)
		previewParts := nonEmptyStrings([]string{record.TitleEN, record.Note})
		if image != "" {
			previewParts = append(previewParts, "![]("+image+")")
		}
		tags := splitPromptTags(strings.Join(nonEmptyStrings([]string{record.CategoryCN, record.Category, record.Author, record.Source}), "/"), regexp.MustCompile(`/`))
		if record.NeedsRef {
			tags = append(tags, "需要参考图")
		}
		items = append(items, defaultSystemPrompt("davidwu-gpt-image2-prompts-"+leftPad(id), title, prompt, image, tags, strings.Join(previewParts, "\n\n")))
	}
	return items, nil
}

func fetchPromptText(ctx context.Context, client *http.Client, baseURL string, file string) (string, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(baseURL, "/")+"/"+strings.TrimLeft(file, "/"), nil)
	if err != nil {
		return "", err
	}
	response, err := client.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", fmt.Errorf("prompt source returned status %d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxPromptSourceResponseBytes+1))
	if err != nil {
		return "", err
	}
	if len(body) > maxPromptSourceResponseBytes {
		return "", errors.New("prompt source response exceeds size limit")
	}
	return string(body), nil
}

func fetchPromptJSON(ctx context.Context, client *http.Client, baseURL string, file string, target any) error {
	raw, err := fetchPromptText(ctx, client, baseURL, file)
	if err != nil {
		return err
	}
	return json.Unmarshal([]byte(raw), target)
}

func filterSystemPrompts(items []SystemPrompt, keyword string, category string, tags []string) []SystemPrompt {
	filtered := make([]SystemPrompt, 0, len(items))
	for _, item := range items {
		if isActivePromptOption(category) && item.Category != category {
			continue
		}
		if len(tags) > 0 && !hasAnyPromptTag(item.Tags, tags) {
			continue
		}
		if keyword != "" {
			haystack := strings.ToLower(strings.Join(append([]string{item.Title, item.Prompt, item.Category}, item.Tags...), " "))
			if !strings.Contains(haystack, keyword) {
				continue
			}
		}
		filtered = append(filtered, item)
	}
	return filtered
}

func hasAnyPromptTag(itemTags []string, requested []string) bool {
	for _, wanted := range requested {
		for _, itemTag := range itemTags {
			if itemTag == wanted {
				return true
			}
		}
	}
	return false
}

func collectPromptTags(items []SystemPrompt) []string {
	seen := make(map[string]bool)
	tags := make([]string, 0)
	for _, item := range items {
		for _, tag := range item.Tags {
			if tag == "" || seen[tag] {
				continue
			}
			seen[tag] = true
			tags = append(tags, tag)
		}
	}
	return tags
}

func splitBeforeHeading(markdown string, prefix string) []string {
	blocks := make([]string, 0)
	current := make([]string, 0)
	for _, line := range strings.Split(markdown, "\n") {
		if strings.HasPrefix(line, prefix) && len(current) > 0 {
			blocks = append(blocks, strings.Join(current, "\n"))
			current = current[:0]
		}
		current = append(current, line)
	}
	return append(blocks, strings.Join(current, "\n"))
}

func firstPromptMatch(value string, pattern *regexp.Regexp) string {
	match := pattern.FindStringSubmatch(value)
	if len(match) < 2 {
		return ""
	}
	return match[1]
}

func extractMarkdownImages(baseURL string, markdown string) []string {
	matches := markdownImagePattern.FindAllStringSubmatch(markdown, -1)
	images := make([]string, 0, len(matches))
	for _, match := range matches {
		if image := absolutePromptImage(baseURL, match[1]); image != "" {
			images = append(images, image)
		}
	}
	return images
}

func absolutePromptImage(baseURL string, image string) string {
	image = strings.TrimSpace(image)
	if image == "" {
		return ""
	}
	if strings.HasPrefix(strings.ToLower(image), "http://") || strings.HasPrefix(strings.ToLower(image), "https://") {
		return image
	}
	return strings.TrimRight(baseURL, "/") + "/" + strings.TrimLeft(strings.TrimPrefix(image, "./"), "/")
}

func tagsFromHeading(heading string) []string {
	var cleaned strings.Builder
	for _, value := range heading {
		if unicode.IsLetter(value) || unicode.IsNumber(value) || strings.ContainsRune("/&、与 ", value) {
			cleaned.WriteRune(value)
		}
	}
	return splitPromptTags(cleaned.String(), regexp.MustCompile(`\s*(?:/|&|、|与)\s*`))
}

func splitPromptTags(value string, separator *regexp.Regexp) []string {
	parts := separator.Split(value, -1)
	tags := make([]string, 0, len(parts))
	for _, part := range parts {
		if tag := strings.ToLower(strings.TrimSpace(part)); tag != "" {
			tags = append(tags, tag)
		}
	}
	return tags
}

func markdownPreview(images []string) string {
	parts := make([]string, 0, len(images))
	for _, image := range images {
		if image != "" {
			parts = append(parts, "![]("+image+")")
		}
	}
	return strings.Join(parts, "\n\n")
}

func defaultSystemPrompt(id string, title string, prompt string, coverURL string, tags []string, preview string) SystemPrompt {
	return SystemPrompt{ID: id, Title: title, CoverURL: coverURL, Prompt: prompt, Tags: append([]string(nil), tags...), Preview: preview}
}

func nonEmptyStrings(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}

func leftPad(value int) string {
	return fmt.Sprintf("%04d", value)
}

func isActivePromptOption(value string) bool {
	return value != "" && value != "全部" && value != "all"
}
