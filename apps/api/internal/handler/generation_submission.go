package handler

import (
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"

	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/service"
)

var errGenerationSubmissionUncertain = service.ErrComicTextSubmissionUncertain

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
