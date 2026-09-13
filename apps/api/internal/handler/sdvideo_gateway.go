package handler

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/response"
	"github.com/ai-manju/api/internal/sdvideo"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

// 固定方法和路径白名单；不接受任意 URL、用户身份或浏览器传入的服务 Token。
func RegisterSDVideoGateway(group *gin.RouterGroup, client *sdvideo.Client, jobs *service.JobService) {
	routes := map[string][]string{
		http.MethodGet:    {"/models", "/capacity", "/conversations", "/conversations/:id/messages", "/media", "/media/mentions", "/media/stats", "/volcano/tags", "/volcano/assets", "/volcano/assets/:id", "/toolkit/erase/:id", "/admin/models", "/admin/stats"},
		http.MethodPost:   {"/conversations", "/messages", "/volcano/tags", "/volcano/assets", "/admin/models/:id/test"},
		http.MethodPatch:  {"/conversations/:id", "/messages/:id", "/media/:id"},
		http.MethodPut:    {"/volcano/assets/:id", "/admin/models/:id"},
		http.MethodDelete: {"/conversations/:id", "/media/:id", "/volcano/tags/:id", "/volcano/assets/:id"},
	}
	for method, paths := range routes {
		for _, template := range paths {
			method, template := method, template
			group.Handle(method, template, func(c *gin.Context) {
				user := auth.MustCurrentUser(c)
				if client == nil || !client.Enabled() {
					response.Error(c, http.StatusServiceUnavailable, "sd-video service unavailable")
					return
				}
				destination := "/v1" + strings.ReplaceAll(template, ":id", url.PathEscape(c.Param("id")))
				query := url.Values{}
				for _, key := range []string{"page", "pageSize", "limit", "offset", "keyword", "kind", "tag", "category", "status"} {
					if value := c.Query(key); value != "" {
						query.Set(key, value)
					}
				}
				if len(query) > 0 {
					destination += "?" + query.Encode()
				}
				var payload map[string]any
				if method != http.MethodGet && method != http.MethodDelete && c.Request.ContentLength != 0 {
					c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4*1024*1024)
					if err := json.NewDecoder(c.Request.Body).Decode(&payload); err != nil {
						response.Error(c, http.StatusBadRequest, "invalid request")
						return
					}
					for _, key := range []string{"user_id", "owner_subject", "workspace_id", "role_override"} {
						delete(payload, key)
					}
				}
				envelope, err := client.BusinessRequest(c.Request.Context(), method, destination, user, service.WorkspaceIDForScope(requestWorkspaceScope(c), user.ID), payload)
				if err != nil {
					code := http.StatusBadGateway
					if remote, ok := err.(*sdvideo.Error); ok && remote.StatusCode >= 400 && remote.StatusCode < 500 {
						code = remote.StatusCode
					}
					response.Error(c, code, "sd-video request rejected or temporarily unavailable")
					return
				}
				if method == http.MethodGet && template == "/conversations/:id/messages" && jobs != nil {
					data, enrichErr := restoreSDVideoMessages(envelope.Data, jobs, user.ID, service.WorkspaceIDForScope(requestWorkspaceScope(c), user.ID), c.Param("id"))
					if enrichErr != nil {
						response.Error(c, http.StatusServiceUnavailable, "video history recovery unavailable")
						return
					}
					response.OK(c, data)
					return
				}
				response.OK(c, envelope.Data)
			})
		}
	}
}

// 恢复任务卡从 Studio 的持久 Job/Asset 读取；不依赖最后一次浏览器 PATCH。
func restoreSDVideoMessages(raw json.RawMessage, jobs *service.JobService, userID, workspaceID, conversationID string) (map[string]any, error) {
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		return nil, err
	}
	rows, err := jobs.ListForUser(userID)
	if err != nil {
		return nil, err
	}
	items, _ := data["items"].([]any)
	for _, value := range items {
		message, ok := value.(map[string]any)
		if !ok {
			continue
		}
		metadata, _ := message["metadata"].(map[string]any)
		if metadata == nil {
			metadata = map[string]any{}
			message["metadata"] = metadata
		}
		for _, job := range rows {
			if job.ExternalProvider != "sd-video" || job.WorkspaceID != workspaceID {
				continue
			}
			var request map[string]any
			if json.Unmarshal(job.Payload, &request) != nil {
				continue
			}
			if request["conversation_id"] != conversationID || request["studio_message_id"] != message["id"] {
				continue
			}
			metadata["taskId"], metadata["taskStatus"], metadata["taskProgress"] = job.ID, job.Status, job.Progress
			if metadata["taskProvider"] == nil {
				metadata["taskProvider"] = "seedance"
			}
			var result map[string]any
			if json.Unmarshal(job.Result, &result) == nil && result["asset_id"] != nil {
				metadata["resultAssetId"] = result["asset_id"]
				metadata["resultScope"] = service.WorkspaceScopeFromID(workspaceID)
			}
			if job.Status == "failed" {
				metadata["taskError"] = "视频任务失败，请在任务记录中查看原因"
			}
			break
		}
	}
	return data, nil
}
