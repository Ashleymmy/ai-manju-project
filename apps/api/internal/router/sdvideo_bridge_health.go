package router

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/ai-manju/api/internal/service"
)

const bridgeStaleAfter = 5 * time.Minute // 失去数据库访问或同步循环卡死后不再报告就绪。

func bridgeHealthHandler(worker *service.SDVideoBridge) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health/ready", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		_, age, err := worker.HealthSnapshot(ctx)
		w.Header().Set("Cache-Control", "no-store")
		if err != nil || age > bridgeStaleAfter.Seconds() {
			http.Error(w, "bridge not ready", http.StatusServiceUnavailable)
			return
		}
		_, _ = w.Write([]byte("ok\n"))
	})
	mux.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		stats, age, err := worker.HealthSnapshot(ctx)
		w.Header().Set("Content-Type", "text/plain; version=0.0.4")
		w.Header().Set("Cache-Control", "no-store")
		if err != nil {
			_, _ = w.Write([]byte("studio_sdvideo_bridge_probe_up 0\n"))
			return
		}
		_, _ = fmt.Fprintf(w, "studio_sdvideo_bridge_probe_up 1\nstudio_sdvideo_bridge_progress_age_seconds %g\nstudio_sdvideo_bridge_pending %d\nstudio_sdvideo_bridge_retrying %d\nstudio_sdvideo_bridge_uncertain %d\nstudio_sdvideo_bridge_oldest_pending_seconds %g\n",
			age, stats.Pending, stats.Retrying, stats.Uncertain, stats.OldestPendingSeconds)
	})
	return mux
}
