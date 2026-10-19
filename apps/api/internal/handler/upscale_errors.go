package handler

import (
	"errors"
	"log"
	"net/http"
	"net/url"
	"strings"

	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/response"
	"github.com/gin-gonic/gin"
)

const (
	imageUpscaleRetryLater = "图片超分暂时失败，请稍后重试"
	videoUpscaleRetryLater = "视频超分暂时失败，请稍后重试"
	imageUpscaleUnreadable = "图片读取失败，请重新上传图片后再试"
)

// writeUpscaleFailure keeps the real cause in the server log and only shows the user advice
// they can act on (size, format, resolution); everything else is a plain retry message.
func writeUpscaleFailure(c *gin.Context, err error, video bool) {
	logProviderError(c, err)
	if advice := upscaleInputRejected(upscaleErrorText(err), video); advice != "" {
		response.Error(c, http.StatusBadRequest, advice)
		return
	}
	if upscaleRateLimited(err) {
		response.Error(c, http.StatusTooManyRequests, errGenerationRateLimited.Error())
		return
	}
	if video {
		response.Error(c, http.StatusBadGateway, videoUpscaleRetryLater)
		return
	}
	response.Error(c, http.StatusBadGateway, imageUpscaleRetryLater)
}

// publicVideoUpscaleFailure is what the canvas shows when an accepted video job later fails.
func publicVideoUpscaleFailure(c *gin.Context, jobID string, code string, message string) string {
	log.Printf("request_id=%s operation=video_upscale job_id=%s upstream_error_code=%q upstream_error=%q", response.RequestID(c), jobID, code, message)
	if advice := upscaleInputRejected(code+" "+message, true); advice != "" {
		return advice
	}
	return videoUpscaleRetryLater
}

func upscaleErrorText(err error) string {
	if err == nil {
		return ""
	}
	var providerHTTPError *provider.ProviderHTTPError
	if errors.As(err, &providerHTTPError) {
		return providerHTTPError.Body
	}
	return err.Error()
}

func upscaleRateLimited(err error) bool {
	if providerRateLimited(err) {
		return true
	}
	var providerHTTPError *provider.ProviderHTTPError
	if !errors.As(err, &providerHTTPError) {
		return false
	}
	return strings.Contains(strings.ToLower(providerHTTPError.Body), "throttling")
}

// upscaleInputRejected maps an Alibaba Cloud VIAPI rejection of the input file to advice.
// Account, key, quota and service problems return "" so the user only sees a retry message.
func upscaleInputRejected(text string, video bool) string {
	lower := strings.ToLower(text)
	if strings.TrimSpace(lower) == "" {
		return ""
	}
	has := func(words ...string) bool {
		for _, word := range words {
			if strings.Contains(lower, word) {
				return true
			}
		}
		return false
	}
	if has("throttling", "unauthorized", "forbidden", "nopermission", "accessdenied", "access denied",
		"accesskey", "signature", "arrearage", "overdue", "notopen", "not open", "notpurchase",
		"quota", "balance", "credential", "internalerror", "timeout") {
		return ""
	}
	switch {
	case has("resolution", "分辨率", "too small", "too big", "width", "height"):
		if video {
			return "视频分辨率不在超分支持范围内：需大于 360×360 且小于 1920×1080"
		}
		return "图片分辨率不在超分支持范围内：长边不超过 1920、短边不超过 1080，且不小于 32×32 像素"
	case has("invalidfile.size", "invalidimage.size", "invalidvideo.size", "file size", "too large", "大小"):
		if video {
			return "视频文件过大：超分只支持不超过 1GB 的视频"
		}
		return "图片文件过大：超分只支持不超过 5MB 的图片"
	case has("format", "invalidfile.type", "invalidimage.type", "invalidvideo.type", "unsupported", "格式"):
		if video {
			return "视频格式不支持：请使用 MP4、MOV、AVI、MKV 等常见格式"
		}
		return "图片格式不支持：请使用 JPG、PNG、BMP 或 WEBP 图片"
	case has("download", "invalidfile.url", "invalidimage.url", "invalidvideo.url", "下载"):
		if video {
			return "超分服务无法读取这个视频，请先将视频保存到素材库后重试"
		}
		return "超分服务无法读取这张图片，请先将图片保存到素材库后重试"
	}
	return ""
}

// upscaleURLHost names where the input was staged without logging the object path (it holds the AccessKey ID).
func upscaleURLHost(raw string) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Host == "" {
		return "unknown"
	}
	return parsed.Host
}
