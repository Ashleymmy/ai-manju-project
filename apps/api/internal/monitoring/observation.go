package monitoring

import (
	"context"
	"fmt"
	"net/http"
	"sync"
)

type observationKey struct{}

// Observation belongs to one request/reconciliation, never a shared client.
type Observation struct {
	mu         sync.Mutex
	diagnostic Diagnostics
	status     int
}

func WithObservation(ctx context.Context) (context.Context, *Observation) {
	o := &Observation{}
	return context.WithValue(ctx, observationKey{}, o), o
}

func (o *Observation) Read() (Diagnostics, int) {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.diagnostic, o.status
}

// ReadObservation does not turn an observed HTTP exchange into an error. The
// caller decides whether its operation failed before persisting these facts.
func ReadObservation(ctx context.Context) (Diagnostics, int) {
	if o, ok := ctx.Value(observationKey{}).(*Observation); ok {
		return o.Read()
	}
	return Diagnostics{}, 0
}

// Called only for an observed error response, transport exception or failed task.
func ObserveFailure(req *http.Request, resp *http.Response, body string, err error) {
	o, ok := req.Context().Value(observationKey{}).(*Observation)
	if !ok {
		return
	}
	d := Diagnostics{Stage: "provider_transport", ProviderURL: req.URL.String(), ProviderMethod: req.Method, ProviderResponseReceived: Bool(resp != nil)}
	status := 0
	if resp != nil {
		d.Stage = "provider_response"
		status = resp.StatusCode
		d.ProviderBody = ErrorBody(body)
		d.ProviderCode, d.ProviderRequestID = ErrorIdentifiers(body)
		if id := UpstreamRequestID(resp.Header); id != "" {
			d.ProviderRequestID = id
		}
	}
	if err != nil {
		d.ExceptionName, d.ExceptionMessage = fmt.Sprintf("%T", err), SafeText(err.Error())
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	o.diagnostic, o.status = ReadDiagnostics(d.JSON()), status
}
