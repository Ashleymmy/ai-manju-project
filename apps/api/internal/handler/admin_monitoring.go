package handler

import (
	"bufio"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/response"
	"github.com/gin-gonic/gin"
)

type AdminMonitoringHandler struct {
	repo     repository.MonitoringRepository
	storage  string
	dbStatus string
}

func NewAdminMonitoringHandler(repo repository.MonitoringRepository, storage string, dbStatus string) *AdminMonitoringHandler {
	return &AdminMonitoringHandler{repo: repo, storage: storage, dbStatus: dbStatus}
}

func (h *AdminMonitoringHandler) Get(c *gin.Context) {
	if h.repo == nil {
		response.Error(c, http.StatusServiceUnavailable, "monitoring repository is not available")
		return
	}

	hours := queryInt(c, "hours", 24)
	if hours <= 0 {
		hours = 24
	}
	if hours > 24*30 {
		hours = 24 * 30
	}
	limit := queryInt(c, "limit", 80)
	if limit <= 0 {
		limit = 80
	}
	if limit > 300 {
		limit = 300
	}
	since := time.Now().UTC().Add(-time.Duration(hours) * time.Hour)
	bucketSize := bucketSizeForWindow(time.Duration(hours) * time.Hour)

	summary, err := h.repo.AIRequestSummary(since)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	users, err := h.repo.AIRequestUsers(since, 10)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	models, err := h.repo.AIRequestModels(since, 12)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	operations, err := h.repo.AIRequestOperations(since)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	buckets, err := h.repo.AIRequestBuckets(since, bucketSize, 72)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	recentRequests, err := h.repo.RecentAIRequestLogs(limit)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	storageStats, err := h.repo.StorageStats()
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	dbOK := true
	dbError := ""
	if err := h.repo.Ping(); err != nil {
		dbOK = false
		dbError = err.Error()
	}

	response.OK(c, gin.H{
		"generated_at": time.Now().UTC(),
		"window": gin.H{
			"hours":       hours,
			"since":       since,
			"bucket_size": bucketSize.String(),
		},
		"health": gin.H{
			"storage":    h.storage,
			"db":         h.dbStatus,
			"db_ok":      dbOK,
			"db_error":   dbError,
			"request_id": response.RequestID(c),
		},
		"storage_stats": storageStats,
		"summary":       summary,
		"users":         users,
		"models":        models,
		"operations":    operations,
		"buckets":       buckets,
		"recent":        recentRequests,
		"logs":          readRecentLogLines(120),
	})
}

func queryInt(c *gin.Context, key string, fallback int) int {
	raw := strings.TrimSpace(c.Query(key))
	if raw == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return parsed
}

func bucketSizeForWindow(window time.Duration) time.Duration {
	switch {
	case window <= 2*time.Hour:
		return 5 * time.Minute
	case window <= 24*time.Hour:
		return time.Hour
	case window <= 7*24*time.Hour:
		return 6 * time.Hour
	default:
		return 24 * time.Hour
	}
}

func readRecentLogLines(limit int) []gin.H {
	candidates := []string{
		"tmp-api-restart.err.log",
		"tmp-api-restart.out.log",
		filepath.Join("..", "..", "tmp-api-restart.err.log"),
		filepath.Join("..", "..", "tmp-api-restart.out.log"),
	}
	lines := make([]gin.H, 0)
	for _, path := range candidates {
		if _, err := os.Stat(path); err != nil {
			continue
		}
		for _, line := range tailFile(path, limit) {
			lines = append(lines, gin.H{"source": filepath.Base(path), "line": line})
		}
	}
	if len(lines) > limit {
		return lines[len(lines)-limit:]
	}
	return lines
}

func tailFile(path string, limit int) []string {
	file, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer file.Close()

	lines := make([]string, 0, limit)
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		text := strings.TrimSpace(scanner.Text())
		if text == "" {
			continue
		}
		lines = append(lines, text)
		if limit > 0 && len(lines) > limit {
			lines = lines[1:]
		}
	}
	return lines
}
