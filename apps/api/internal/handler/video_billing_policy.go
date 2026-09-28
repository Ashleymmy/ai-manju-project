package handler

import (
	"encoding/json"
	"math"
	"strings"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

// The same authenticated model selection supplies reservation and preview limits.
// No client field may set a maximum duration or a billing rate.
func (h *ModelProviderHandler) videoBillingPolicy(c *gin.Context, requested string) (*service.VideoBillingPolicy, error) {
	if h == nil {
		return nil, service.ErrAutomaticVideoPolicyUnavailable
	}
	var caps videoModelCapabilities
	if strings.HasPrefix(requested, "sdvideo/") {
		var err error
		caps, err = loadSDVideoCapabilities(c, h.sdVideo, strings.TrimPrefix(requested, "sdvideo/"))
		if err != nil {
			return nil, service.ErrAutomaticVideoPolicyUnavailable
		}
	} else {
		selection, err := h.forRequest(c).resolveProviderSelection(model.ModelCapabilityVideo, requested)
		if err != nil {
			return nil, service.ErrAutomaticVideoPolicyUnavailable
		}
		caps = h.videoCapabilities(selection.Model)
	}
	return videoBillingPolicyFromCapabilities(caps)
}

func videoBillingPolicyFromCapabilities(caps videoModelCapabilities) (*service.VideoBillingPolicy, error) {
	maximum := float64(0)
	for _, duration := range caps.Durations {
		if !math.IsNaN(duration) && !math.IsInf(duration, 0) && duration > maximum {
			maximum = duration
		}
	}
	if maximum <= 0 || len(caps.Resolutions) == 0 {
		return nil, service.ErrAutomaticVideoPolicyUnavailable
	}
	return &service.VideoBillingPolicy{MaxDurationSeconds: int64(math.Ceil(maximum)), Resolutions: append([]string(nil), caps.Resolutions...)}, nil
}

func (h *AIHandler) automaticVideoBillingPolicy(c *gin.Context, jobType string, payload model.JSONB) (*service.VideoBillingPolicy, error) {
	if h.entitlements == nil || jobType != model.JobTypeVideoGenerate || !service.IsAutomaticVideoDuration(payload) {
		return nil, nil
	}
	var body map[string]any
	if json.Unmarshal(payload, &body) != nil {
		return nil, service.ErrAutomaticVideoPolicyUnavailable
	}
	return h.providerHandler.videoBillingPolicy(c, firstNonEmpty(stringFromAny(body["studio_model"]), stringFromAny(body["model"])))
}
