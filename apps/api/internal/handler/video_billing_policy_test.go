package handler

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/config"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/queue"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

type videoPolicyCapture struct{ policy *service.VideoBillingPolicy }

func (b *videoPolicyCapture) NormalizePayloadForJob(_, _ string, p model.JSONB) (model.JSONB, error) {
	return p, nil
}
func (b *videoPolicyCapture) ReserveForJob(_, _, _ string, _ model.JSONB) error { return nil }
func (b *videoPolicyCapture) ReleaseForJob(_ string)                            {}
func (b *videoPolicyCapture) ReserveForJobWithVideoPolicy(_, _, _ string, _ model.JSONB, p *service.VideoBillingPolicy) error {
	b.policy = p
	return nil
}

func TestAutomaticVideoQuoteAndEnqueueShareAuthenticatedCapability(t *testing.T) {
	gin.SetMode(gin.TestMode)
	billing := repository.NewMemoryBillingRepository()
	_ = billing.UpsertConfig(model.BillingConfigKeyModelAliases, model.JSONB(`{"ep-25":"seedance-2.5"}`), "test", time.Now())
	providers := repository.NewMemoryModelProviderRepository()
	_, _ = providers.UpsertModelProvider(accessVideoProvider("private", true))
	ph := NewModelProviderHandler(providers, provider.NewSecretBox("test"))
	ph.SetVideoModelFamilyResolver(service.NewCreditPricer(billing).ResolveModelFamily)
	member := NewMemberHandler(nil, nil, nil, billing, nil, config.Config{BillingEnabled: true})
	member.SetModelProviderHandler(ph)
	for _, uid := range []string{"allowed", "denied"} {
		t.Run(uid, func(t *testing.T) {
			jobs := service.NewJobService(repository.NewMemoryJobRepository(), &queue.MemoryProducer{}, "celery", 3)
			capture := &videoPolicyCapture{}
			jobs.SetBillingHooks(capture)
			ai := NewAIHandler(ph, jobs)
			ai.SetEntitlementGate(&service.EntitlementGate{})
			router := gin.New()
			router.Use(func(c *gin.Context) {
				c.Set(auth.ContextUserKey, model.User{ID: uid, Role: model.UserRoleMember})
				c.Next()
			})
			router.POST("/quote", member.Quote)
			router.POST("/submit", func(c *gin.Context) {
				_, err := ai.enqueueAIJob(c, model.JobTypeVideoGenerate, model.JSONB(`{"model":"ep-25","studio_model":"private::ep-25","duration":-1,"resolution":"720p"}`), nil)
				if err == nil {
					c.Status(http.StatusAccepted)
				}
			})
			quoted := performJSON(router, http.MethodPost, "/quote", `{"job_type":"video.generate","payload":{"model":"private::ep-25","duration":-1,"resolution":"720p"}}`, nil)
			submitted := performJSON(router, http.MethodPost, "/submit", `{}`, nil)
			if uid == "denied" {
				if quoted.Code != 400 || submitted.Code != 400 || capture.policy != nil {
					t.Fatalf("restricted quote/submit escaped: %d/%d", quoted.Code, submitted.Code)
				}
				return
			}
			if quoted.Code != 200 || submitted.Code != 202 {
				t.Fatalf("quote=%s submit=%s", quoted.Body.String(), submitted.Body.String())
			}
			var result struct {
				Data struct {
					Credits int64 `json:"credits"`
					Params  struct {
						Mode     string `json:"billing_mode"`
						Duration int64  `json:"reserve_duration_sec"`
					} `json:"params"`
				} `json:"data"`
			}
			if err := json.Unmarshal(quoted.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if result.Data.Credits != 6600 || result.Data.Params.Mode != service.AutomaticVideoBillingMode || result.Data.Params.Duration != 30 {
				t.Fatalf("quote mismatch %s", quoted.Body.String())
			}
			if capture.policy == nil || capture.policy.MaxDurationSeconds != result.Data.Params.Duration {
				t.Fatalf("submission policy differs: %+v", capture.policy)
			}
		})
	}
}

func TestVideoBillingCapabilitiesDoNotGuessUnknownMaximum(t *testing.T) {
	if _, err := videoBillingPolicyFromCapabilities(catalogVideoCapabilities("ep-unknown")); err == nil {
		t.Fatal("unknown maximum accepted")
	}
	policy, err := videoBillingPolicyFromCapabilities(catalogVideoCapabilities("seedance-2.0-fast"))
	if err != nil || policy.MaxDurationSeconds != 15 {
		t.Fatalf("wrong model maximum: %+v %v", policy, err)
	}
}
