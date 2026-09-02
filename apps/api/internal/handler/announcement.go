package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/response"
	"github.com/gin-gonic/gin"
)

const (
	announcementEventPublished = "announcement.published"
	announcementEventRevoked   = "announcement.revoked"
	announcementEventHeartbeat = "heartbeat"
)

type AnnouncementHandler struct {
	repo repository.AnnouncementRepository
	hub  *AnnouncementHub
}

type announcementRequest struct {
	Title   string `json:"title"`
	Content string `json:"content"`
	Kind    string `json:"kind"`
}

type AnnouncementEvent struct {
	Type         string                    `json:"type"`
	Announcement *model.SystemAnnouncement `json:"announcement,omitempty"`
	ID           string                    `json:"id,omitempty"`
}

func NewAnnouncementHandler(repo repository.AnnouncementRepository) *AnnouncementHandler {
	return &AnnouncementHandler{repo: repo, hub: NewAnnouncementHub()}
}

func (h *AnnouncementHandler) Current(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	announcement, err := h.repo.GetUnreadActiveAnnouncement(user.ID)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	response.OK(c, announcement)
}

func (h *AnnouncementHandler) MarkRead(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	read, err := h.repo.MarkRead(strings.TrimSpace(c.Param("id")), user.ID)
	if err != nil {
		if errors.Is(err, repository.ErrAnnouncementNotFound) {
			response.Error(c, http.StatusNotFound, "announcement not found")
			return
		}
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	response.OK(c, gin.H{"read_at": read.ReadAt})
}

func (h *AnnouncementHandler) Stream(c *gin.Context) {
	client := h.hub.Subscribe()
	defer h.hub.Unsubscribe(client)

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	c.Status(http.StatusOK)
	flushSSE(c)

	heartbeat := time.NewTicker(25 * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case <-c.Request.Context().Done():
			return
		case event := <-client:
			writeSSE(c, event)
			flushSSE(c)
		case <-heartbeat.C:
			writeSSE(c, AnnouncementEvent{Type: announcementEventHeartbeat})
			flushSSE(c)
		}
	}
}

func (h *AnnouncementHandler) AdminList(c *gin.Context) {
	items, err := h.repo.ListAnnouncements(queryInt(c, "limit", 80))
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	response.OK(c, items)
}

func (h *AnnouncementHandler) AdminCreate(c *gin.Context) {
	var req announcementRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	title, content, kind, ok := h.normalizeAnnouncementRequest(c, req, true)
	if !ok {
		return
	}
	admin := auth.MustCurrentUser(c)
	now := time.Now().UTC()

	announcement, err := h.repo.CreateAnnouncement(model.SystemAnnouncement{
		ID:          "announcement_" + randomHex(8),
		Title:       title,
		Content:     content,
		Kind:        kind,
		Status:      model.SystemAnnouncementStatusActive,
		CreatedBy:   admin.ID,
		PublishedAt: now,
		CreatedAt:   now,
		UpdatedAt:   now,
	})
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	h.hub.Broadcast(AnnouncementEvent{Type: announcementEventPublished, Announcement: &announcement, ID: announcement.ID})
	response.Created(c, announcement)
}

func (h *AnnouncementHandler) AdminRepublish(c *gin.Context) {
	req, hasBody, err := decodeOptionalAnnouncementRequest(c)
	if err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	sourceID := strings.TrimSpace(c.Param("id"))
	source, err := h.repo.GetAnnouncement(sourceID)
	if err != nil {
		if errors.Is(err, repository.ErrAnnouncementNotFound) {
			response.Error(c, http.StatusNotFound, "announcement not found")
			return
		}
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	if !hasBody {
		req = announcementRequest{Title: source.Title, Content: source.Content, Kind: source.Kind}
	}
	title, content, kind, ok := h.normalizeAnnouncementRequest(c, req, false)
	if !ok {
		return
	}
	if title == "" {
		title = source.Title
	}
	if content == "" {
		content = source.Content
	}
	if strings.TrimSpace(req.Kind) == "" {
		kind = source.Kind
	}
	admin := auth.MustCurrentUser(c)
	now := time.Now().UTC()

	announcement, err := h.repo.RepublishAnnouncement(sourceID, model.SystemAnnouncement{
		ID:          "announcement_" + randomHex(8),
		Title:       title,
		Content:     content,
		Kind:        kind,
		Status:      model.SystemAnnouncementStatusActive,
		CreatedBy:   admin.ID,
		PublishedAt: now,
		CreatedAt:   now,
		UpdatedAt:   now,
	})
	if err != nil {
		if errors.Is(err, repository.ErrAnnouncementNotFound) {
			response.Error(c, http.StatusNotFound, "announcement not found")
			return
		}
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	h.hub.Broadcast(AnnouncementEvent{Type: announcementEventPublished, Announcement: &announcement, ID: announcement.ID})
	response.Created(c, announcement)
}

func (h *AnnouncementHandler) AdminRevoke(c *gin.Context) {
	announcement, err := h.repo.RevokeAnnouncement(strings.TrimSpace(c.Param("id")))
	if err != nil {
		if errors.Is(err, repository.ErrAnnouncementNotFound) {
			response.Error(c, http.StatusNotFound, "announcement not found")
			return
		}
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	h.hub.Broadcast(AnnouncementEvent{Type: announcementEventRevoked, Announcement: &announcement, ID: announcement.ID})
	response.OK(c, announcement)
}

func (h *AnnouncementHandler) normalizeAnnouncementRequest(c *gin.Context, req announcementRequest, requireFields bool) (string, string, string, bool) {
	title := strings.TrimSpace(req.Title)
	content := strings.TrimSpace(req.Content)
	if requireFields && title == "" {
		response.Error(c, http.StatusBadRequest, "title is required")
		return "", "", "", false
	}
	if title != "" && len([]rune(title)) > 80 {
		response.Error(c, http.StatusBadRequest, "title must be 80 characters or fewer")
		return "", "", "", false
	}
	if requireFields && content == "" {
		response.Error(c, http.StatusBadRequest, "content is required")
		return "", "", "", false
	}
	if content != "" && len([]rune(content)) > 1000 {
		response.Error(c, http.StatusBadRequest, "content must be 1000 characters or fewer")
		return "", "", "", false
	}
	return title, content, normalizeAnnouncementKind(req.Kind), true
}

func decodeOptionalAnnouncementRequest(c *gin.Context) (announcementRequest, bool, error) {
	var req announcementRequest
	if c.Request.Body == nil || c.Request.ContentLength == 0 {
		return req, false, nil
	}
	if err := json.NewDecoder(c.Request.Body).Decode(&req); err != nil {
		if errors.Is(err, io.EOF) {
			return req, false, nil
		}
		return req, false, err
	}
	return req, true, nil
}

type AnnouncementHub struct {
	mu      sync.RWMutex
	clients map[chan AnnouncementEvent]struct{}
}

func NewAnnouncementHub() *AnnouncementHub {
	return &AnnouncementHub{clients: make(map[chan AnnouncementEvent]struct{})}
}

func (h *AnnouncementHub) Subscribe() chan AnnouncementEvent {
	client := make(chan AnnouncementEvent, 8)
	h.mu.Lock()
	h.clients[client] = struct{}{}
	h.mu.Unlock()
	return client
}

func (h *AnnouncementHub) Unsubscribe(client chan AnnouncementEvent) {
	h.mu.Lock()
	if _, ok := h.clients[client]; ok {
		delete(h.clients, client)
		close(client)
	}
	h.mu.Unlock()
}

func (h *AnnouncementHub) Broadcast(event AnnouncementEvent) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for client := range h.clients {
		select {
		case client <- event:
		default:
		}
	}
}

func normalizeAnnouncementKind(kind string) string {
	switch strings.TrimSpace(kind) {
	case model.SystemAnnouncementKindUpdate:
		return model.SystemAnnouncementKindUpdate
	case model.SystemAnnouncementKindMaintenance:
		return model.SystemAnnouncementKindMaintenance
	default:
		return model.SystemAnnouncementKindNotice
	}
}

func writeSSE(c *gin.Context, event AnnouncementEvent) {
	name := event.Type
	if name == "" {
		name = announcementEventHeartbeat
	}
	payload, err := json.Marshal(event)
	if err != nil {
		return
	}
	_, _ = fmt.Fprintf(c.Writer, "event: %s\n", name)
	_, _ = fmt.Fprintf(c.Writer, "data: %s\n\n", payload)
}

func flushSSE(c *gin.Context) {
	if flusher, ok := c.Writer.(http.Flusher); ok {
		flusher.Flush()
	}
}
