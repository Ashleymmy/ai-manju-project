package handler

import (
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"

	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/service"
)

var errGenerationSubmissionUncertain = service.ErrComicTextSubmissionUncertain

var errGenerationRateLimited = errors.New("请求过于频繁，请稍后重试")

// providerRateLimited reports a supplier 429, shown to users as a retry-later message.
func providerRateLimited(err error) bool {
	var response *provider.ProviderHTTPError
	return errors.As(err, &response) && response.StatusCode == http.StatusTooManyRequests
}

// Synchronous text/audio POSTs have no supplier task ID for recovery. A timeout,
// partial response or gateway 5xx cannot prove the paid request was rejected.
func safeToRepeatGeneration(err error) bool {
	if errors.Is(err, provider.ErrSubmissionReceiptInterrupted) {
		return false
	}
	var response *provider.ProviderHTTPError
	if errors.As(err, &response) {
		return !response.SubmissionRedirected && response.StatusCode >= http.StatusBadRequest && response.StatusCode < http.StatusInternalServerError && response.StatusCode != http.StatusRequestTimeout
	}
	var network *net.OpError
	var request *url.Error
	if errors.As(err, &request) && request.Op != "Post" {
		// A result GET may fail to connect after a POST already succeeded.
		return false
	}
	return errors.As(err, &network) && network.Op == "dial"
}

func uncertainGeneration(err error) error {
	return fmt.Errorf("%w: %w", errGenerationSubmissionUncertain, err)
}

func generationPublicError(err error) string {
	if errors.Is(err, provider.ErrTextInputNotSubmitted) {
		return "参考图片暂时无法读取或格式不支持，请检查素材后重试；尚未提交生成"
	}
	if errors.Is(err, errGenerationSubmissionUncertain) {
		return errGenerationSubmissionUncertain.Error()
	}
	return errGenerationUnavailable.Error()
}

// audioSpeechPublicError 在通用生成错误之上识别"音色已被删除/不存在"，
// 给用户一个可操作的提示而不是笼统的"生成失败"。
func audioSpeechPublicError(err error) string {
	if errors.Is(err, errLocalVoiceUnavailable) || deletedVoiceError(err) {
		return "该音色不存在或已被删除，请重新选择音色"
	}
	return generationPublicError(err)
}

func deletedVoiceError(err error) bool {
	var response *provider.ProviderHTTPError
	if !errors.As(err, &response) {
		return false
	}
	body := strings.ToLower(response.Body)
	if !strings.Contains(body, "voice") {
		return false
	}
	return strings.Contains(body, "not exist") ||
		strings.Contains(body, "not found") ||
		strings.Contains(body, "invalid") ||
		strings.Contains(body, "不存在") ||
		strings.Contains(body, "deleted")
}
