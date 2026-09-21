package handler

import (
	"github.com/ai-manju/api/internal/config"
	"github.com/ai-manju/api/internal/repository"
	"github.com/gin-gonic/gin"
	"net/http"
	"strings"
	"testing"
)

func TestMemberQuoteUsesNormalizedImageParameters(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewMemberHandler(nil, nil, nil, repository.NewMemoryBillingRepository(), nil, config.Config{})
	r := gin.New()
	r.POST("/quote", h.Quote)
	for _, tc := range []struct {
		body     string
		status   int
		contains string
	}{
		{`{"job_type":"image.generate","payload":{"model":"gpt-image-1.5","size":"1:1","quality":"medium","n":2}}`, 200, `"credits":270`},
		{`{"job_type":"image.edit","payload":{"model":"gpt-image-2","size":"1024x1024","quality":"low","n":4,"references":[{"field_name":"image"}]}}`, 200, `"credits":30`},
		{`{"job_type":"image.generate","payload":null}`, 400, `"success":false`},
		{`{"job_type":"unknown","payload":{}}`, 400, `"success":false`},
	} {
		rec := performJSON(r, http.MethodPost, "/quote", tc.body, nil)
		if rec.Code != tc.status || !strings.Contains(rec.Body.String(), tc.contains) {
			t.Fatalf("%d %s; want %d %s", rec.Code, rec.Body.String(), tc.status, tc.contains)
		}
	}
}
