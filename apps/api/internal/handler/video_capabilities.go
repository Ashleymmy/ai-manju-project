package handler

import (
	"encoding/json"
	"fmt"
	"slices"
	"strconv"
	"strings"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/sdvideo"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

// One contract feeds browser controls and pre-enqueue validation. Empty fields
// mean unknown, not unsupported; friendly model labels never define capabilities.
type videoModelCapabilities struct {
	Resolutions     []string                    `json:"resolutions,omitempty"`
	Ratios          []string                    `json:"ratios,omitempty"`
	Supports        []string                    `json:"supports,omitempty"`
	Durations       []float64                   `json:"durations,omitempty"`
	HasAudio        *bool                       `json:"has_audio,omitempty"`
	References      *videoReferenceCapabilities `json:"references,omitempty"`
	FramesExclusive bool                        `json:"frames_exclusive,omitempty"`
}

type videoReferenceCapabilities struct {
	Images                  int  `json:"images"`
	Videos                  int  `json:"videos"`
	Audios                  int  `json:"audios"`
	AudioOnly               bool `json:"audio_only"`
	MediaMinDurationMS      int  `json:"media_min_duration_ms,omitempty"`
	MediaMaxDurationMS      int  `json:"media_max_duration_ms,omitempty"`
	MediaMaxTotalDurationMS int  `json:"media_max_total_duration_ms,omitempty"`
	ImageMaxBytes           int  `json:"image_max_bytes,omitempty"`
	VideoMaxBytes           int  `json:"video_max_bytes,omitempty"`
	AudioMaxBytes           int  `json:"audio_max_bytes,omitempty"`
}

// Reference-media contract used by our Seedance adapter (Create Video Task API).
// These are input limits, independent of the generated video's duration.
const (
	videoReferenceMinDurationMS   = 2000
	videoReferenceMaxDurationMS   = 15000
	videoReference25MaxDurationMS = 30000
	videoReferenceImageMaxBytes   = 30 * 1024 * 1024
	videoReferenceVideoMaxBytes   = 50 * 1024 * 1024
	videoReferenceAudioMaxBytes   = 15 * 1024 * 1024
)

func (h *ModelProviderHandler) SetVideoModelFamilyResolver(resolve func(string) string) {
	h.modelFamily = resolve
}

func (h *ModelProviderHandler) videoCapabilities(modelID string) videoModelCapabilities {
	return catalogVideoCapabilities(capabilityModelID(modelID, h.modelFamily))
}

func capabilityModelID(modelID string, resolve func(string) string) string {
	// Preserve resolution-bound supplier variants (e.g. H3 480p/768p).
	known := catalogVideoCapabilities(modelID)
	if resolve != nil && len(known.Resolutions) == 0 && len(known.Durations) == 0 {
		return resolve(modelID)
	}
	return modelID
}

func catalogVideoCapabilities(modelID string) videoModelCapabilities {
	id := strings.TrimPrefix(strings.ToLower(modelID), "sdvideo/")
	id = strings.NewReplacer(".", "-", "_", "-").Replace(id)
	caps := videoModelCapabilities{Durations: catalogVideoDurations(modelID)}
	audio := true
	if strings.HasPrefix(id, "zzdh-minimax-h3-") {
		for _, resolution := range []string{"480p", "768p"} {
			if strings.HasSuffix(id, "-"+resolution) {
				audio = false
				caps.Resolutions = []string{resolution}
				caps.Ratios = []string{"16:9", "9:16"}
				caps.Supports = []string{"reference_image"}
				caps.HasAudio = &audio
				caps.References = &videoReferenceCapabilities{Images: 9}
			}
		}
		return caps
	}
	seedance2 := strings.Contains(id, "seedance-2-0") || strings.Contains(id, "seedance-2-5") || id == "seedance-fast"
	wan := strings.Contains(id, "wan3") || strings.Contains(id, "wan-3")
	if !seedance2 && !wan {
		return caps
	}
	caps.Resolutions = []string{"480p", "720p", "1080p"}
	caps.Ratios = []string{"16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"}
	caps.Supports = []string{"text", "first_frame", "last_frame", "reference_image", "reference_video", "reference_audio"}
	caps.HasAudio = &audio
	caps.References = &videoReferenceCapabilities{Images: 9, Videos: 3, Audios: 3}
	if seedance2 && (strings.Contains(id, "mini") || strings.Contains(id, "fast")) {
		caps.Resolutions = []string{"480p", "720p"}
	}
	if strings.Contains(id, "seedance-2-5") {
		caps.References = &videoReferenceCapabilities{Images: 30, Videos: 10, Audios: 10, AudioOnly: true}
	}
	// Publish the limits the adapter actually enforces so the UI can validate
	// references before creating a task, including provider-scoped endpoint IDs.
	caps.References.MediaMinDurationMS = videoReferenceMinDurationMS
	caps.References.MediaMaxDurationMS = videoReferenceMaxDurationMS
	if strings.Contains(id, "seedance-2-5") {
		caps.References.MediaMaxDurationMS = videoReference25MaxDurationMS
	}
	caps.References.MediaMaxTotalDurationMS = caps.References.MediaMaxDurationMS
	caps.References.ImageMaxBytes = videoReferenceImageMaxBytes
	caps.References.VideoMaxBytes = videoReferenceVideoMaxBytes
	caps.References.AudioMaxBytes = videoReferenceAudioMaxBytes
	if wan {
		caps.Ratios = []string{"16:9", "9:16", "1:1", "4:3", "3:4", "adaptive"}
		caps.Durations = integerVideoDurations(4, 30, false)
		caps.FramesExclusive = true
	}
	return caps
}

func (caps videoModelCapabilities) validate(body map[string]any) error {
	check := func(label, value string, choices []string) error {
		if value == "" || len(choices) == 0 {
			return nil
		}
		for _, choice := range choices {
			if strings.EqualFold(value, choice) {
				return nil
			}
		}
		return fmt.Errorf("当前模型不支持%s %s，可选：%s", label, value, strings.Join(choices, "、"))
	}
	if err := check("分辨率", firstNonEmpty(stringFromAny(body["resolution"]), stringFromAny(body["resolution_name"])), caps.Resolutions); err != nil {
		return err
	}
	ratio := stringFromAny(body["ratio"])
	if ratio == "" {
		ratio = map[string]string{"1280x720": "16:9", "720x1280": "9:16", "1024x1024": "1:1"}[stringFromAny(body["size"])]
	}
	if err := check("比例", ratio, caps.Ratios); err != nil {
		return err
	}
	duration := body["duration"]
	if duration == nil {
		duration = body["seconds"]
	}
	if duration != nil && duration != "" && len(caps.Durations) > 0 {
		seconds, err := strconv.ParseFloat(fmt.Sprint(duration), 64)
		if err != nil || !slices.Contains(caps.Durations, seconds) {
			return fmt.Errorf("所选时长不在当前模型支持范围内，请重新选择时长")
		}
	}
	if audio, _ := body["generate_audio"].(bool); audio && caps.HasAudio != nil && !*caps.HasAudio {
		return fmt.Errorf("当前模型不支持生成音频")
	}
	counts := map[string]int{}
	frames, regular := 0, 0
	// These are alternate request encodings, not additional copies of references.
	for _, field := range []string{"content", "references", "files"} {
		items, _ := body[field].([]any)
		if len(items) == 0 {
			continue
		}
		for _, raw := range items {
			item, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			kind := strings.TrimSuffix(firstNonEmpty(stringFromAny(item["type"]), stringFromAny(item["kind"])), "_url")
			if kind == "" {
				kind = strings.Split(stringFromAny(item["content_type"]), "/")[0]
			}
			if kind != "image" && kind != "video" && kind != "audio" {
				continue
			}
			counts[kind]++
			role := stringFromAny(item["role"])
			if role == "first_frame" || role == "last_frame" {
				frames++
			} else {
				regular++
				role = "reference_" + kind
			}
			if len(caps.Supports) > 0 && !slices.Contains(caps.Supports, role) {
				return fmt.Errorf("当前模型不支持该参考素材类型：%s", role)
			}
		}
		break
	}
	if caps.FramesExclusive && frames > 0 && regular > 0 {
		return fmt.Errorf("当前模型的首尾帧不能与普通参考素材同时使用，请选择一种方式")
	}
	if limits := caps.References; limits != nil {
		for _, bound := range []struct {
			kind, label string
			max         int
		}{{"image", "图片", limits.Images}, {"video", "视频", limits.Videos}, {"audio", "音频", limits.Audios}} {
			if counts[bound.kind] > bound.max {
				return fmt.Errorf("参考%s最多 %d 个", bound.label, bound.max)
			}
		}
		if !limits.AudioOnly && counts["audio"] > 0 && counts["image"]+counts["video"] == 0 {
			return fmt.Errorf("当前模型的参考音频不能单独使用")
		}
	}
	return nil
}

// Read the live SD-video model contract before staging media or freezing credits.
func validateSDVideoCapabilities(c *gin.Context, client *sdvideo.Client, modelID string, body map[string]any) error {
	user := auth.MustCurrentUser(c)
	remote, err := client.ListModels(c.Request.Context(), user, service.WorkspaceIDForScope(requestWorkspaceScope(c), user.ID))
	if err != nil {
		return fmt.Errorf("暂时无法读取模型能力，请稍后重试")
	}
	var data struct {
		Items []struct {
			Key string `json:"key"`
			videoModelCapabilities
		} `json:"items"`
	}
	if json.Unmarshal(remote.Data, &data) != nil {
		return fmt.Errorf("模型能力数据无效，请刷新后重试")
	}
	for _, item := range data.Items {
		if item.Key == modelID {
			caps := catalogVideoCapabilities(modelID)
			caps.Resolutions, caps.Ratios, caps.Supports, caps.HasAudio = item.Resolutions, item.Ratios, item.Supports, item.HasAudio
			if item.References != nil {
				caps.References = item.References
			}
			if len(item.Durations) > 0 {
				caps.Durations = item.Durations
			}
			return caps.validate(body)
		}
	}
	return fmt.Errorf("当前模型不在可用目录中，请刷新后重新选择")
}
