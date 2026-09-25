package provider

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/ai-manju/api/internal/httpsecurity"
)

// ErrSubmissionReceiptInterrupted means a POST received a redirect before the
// follow-up failed. Even a dial failure here cannot justify another paid POST.
var ErrSubmissionReceiptInterrupted = errors.New("provider submission receipt interrupted")

func doProviderRequest(client *http.Client, req *http.Request) (*http.Response, error) {
	if req.Method != http.MethodPost {
		return client.Do(req)
	}
	copyClient := *client
	redirected := false
	copyClient.CheckRedirect = func(next *http.Request, via []*http.Request) error {
		redirected = true
		if client.CheckRedirect != nil {
			return client.CheckRedirect(next, via)
		}
		return httpsecurity.SameOriginRedirect(next, via)
	}
	res, err := copyClient.Do(req)
	if err != nil && redirected {
		return res, fmt.Errorf("%w: %w", ErrSubmissionReceiptInterrupted, err)
	}
	return res, err
}
