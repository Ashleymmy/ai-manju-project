package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/monitoring"
)

// A failed diagnostic write must not change paid job recovery.
const bridgeMonitoringWriteTimeout = 2 * time.Second

func (b *SDVideoBridge) recordObservation(job model.Job, observation *monitoring.Observation, started time.Time) {
	if b.monitoring == nil {
		return
	}
	diagnostic, status := observation.Read()
	if diagnostic.Stage == "" {
		return
	}
	var payload map[string]any
	_ = json.Unmarshal(job.Payload, &payload)
	event := model.RuntimeError{ID: fmt.Sprintf("bridge_%s_%d", job.ID, started.UnixNano()), UserID: job.UserID,
		Source: "worker", JobID: job.ID, Operation: "sd_video_reconcile", Message: "视频服务返回异常",
		ErrorCode: diagnostic.ProviderCode, Diagnostics: diagnostic.JSON(), ProviderStatus: status,
		RequestID: monitorString(payload, "request_id"), Model: monitorString(payload, "studio_model"),
		ProjectID: monitorString(payload, "project_id"), NodeID: monitorString(payload, "node_id"),
		Attempt: job.BridgeAttempts + 1, DurationMS: time.Since(started).Milliseconds(), CreatedAt: started.UTC()}
	if diagnostic.ProviderResponseReceived != nil && !*diagnostic.ProviderResponseReceived {
		event.Message = "视频服务连接异常"
	}
	ctx, cancel := context.WithTimeout(context.Background(), bridgeMonitoringWriteTimeout)
	defer cancel()
	if err := b.monitoring.Record(ctx, event); err != nil {
		log.Printf("event=bridge_monitoring_write_failed job_id=%q", job.ID)
	}
}
