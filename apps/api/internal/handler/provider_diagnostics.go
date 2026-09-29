package handler

import (
	"errors"
	"fmt"
	"net/url"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/monitoring"
	"github.com/ai-manju/api/internal/provider"
	"github.com/gin-gonic/gin"
)

func requestProviderDiagnostics(c *gin.Context, err error) (model.JSONB, int) {
	if err == nil {
		return nil, 0
	}
	d := monitoring.ReadDiagnostics(providerDiagnostics(err))
	if c.Request == nil {
		return d.JSON(), 0
	}
	observed, status := monitoring.ReadObservation(c.Request.Context())
	if observed.Stage != "" {
		if observed.ExceptionName == "" {
			observed.ExceptionName, observed.ExceptionMessage = d.ExceptionName, d.ExceptionMessage
		}
		d = observed
	}
	return d.JSON(), status
}

// Preserve observed upstream facts independently of user-facing error wording.
func providerDiagnostics(err error) model.JSONB {
	if err == nil {
		return nil
	}
	d := monitoring.Diagnostics{Stage: "provider_call", ExceptionName: fmt.Sprintf("%T", err), ExceptionMessage: err.Error()}
	var httpErr *provider.ProviderHTTPError
	var transportErr *url.Error
	if errors.As(err, &httpErr) {
		d.Stage = "provider_response"
		d.ProviderResponseReceived = monitoring.Bool(true)
		d.ProviderURL, d.ProviderMethod, d.ProviderRequestID = httpErr.SafeURL(), httpErr.Method, httpErr.RequestID
		d.ProviderBody = monitoring.ErrorBody(httpErr.Body)
		d.ExceptionMessage = fmt.Sprintf("provider HTTP %d", httpErr.StatusCode)
		code, requestID := monitoring.ErrorIdentifiers(httpErr.Body)
		d.ProviderCode = code
		if d.ProviderRequestID == "" {
			d.ProviderRequestID = requestID
		}
	} else if errors.As(err, &transportErr) {
		d.Stage = "provider_transport"
		d.ProviderResponseReceived = monitoring.Bool(false)
		d.ProviderURL, d.ProviderMethod = transportErr.URL, transportErr.Op
	}
	return d.JSON()
}
