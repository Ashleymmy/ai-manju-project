package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/response"
	"github.com/ai-manju/api/internal/sdvideo"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

func SDVideoAssetContent(client *sdvideo.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		if client == nil || !client.Enabled() {
			response.Error(c, 503, "sd-video unavailable")
			return
		}
		user := auth.MustCurrentUser(c)
		body, contentType, err := client.AssetContent(c.Request.Context(), user, service.WorkspaceIDForScope(requestWorkspaceScope(c), user.ID), c.Param("id"))
		if err != nil {
			response.Error(c, 404, "asset content unavailable")
			return
		}
		c.Header("Cache-Control", "private, no-store")
		c.Header("Content-Type", contentType)
		http.ServeContent(c.Writer, c.Request, c.Param("id"), time.Time{}, bytes.NewReader(body))
	}
}

func SDVideoThumbnail(client *sdvideo.Client, kind string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if client == nil || !client.Enabled() {
			response.Error(c, 503, "sd-video unavailable")
			return
		}
		user := auth.MustCurrentUser(c)
		body, contentType, err := client.Thumbnail(c.Request.Context(), user, service.WorkspaceIDForScope(requestWorkspaceScope(c), user.ID), kind, c.Param("id"))
		if err != nil {
			code := 502
			var remote *sdvideo.Error
			if errors.As(err, &remote) && remote.StatusCode >= 400 && remote.StatusCode < 500 {
				code = remote.StatusCode
			}
			response.Error(c, code, "thumbnail unavailable or pending")
			return
		}
		if contentType != "image/jpeg" {
			response.Error(c, 502, "invalid thumbnail response")
			return
		}
		c.Header("Cache-Control", "private, no-store")
		c.Data(http.StatusOK, contentType, body)
	}
}

// 仅拦截已注册的素材白名单路由；中间件置于 Studio 鉴权之后。
func SDVideoAssetCompatibility(client *sdvideo.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		path := c.FullPath()
		if client == nil || client.Mode() != "active" || !(strings.HasPrefix(path, "/api/admin/seedance-assets") || strings.HasPrefix(path, "/api/admin/seedance-asset-tags") || path == "/api/ai/seedance-assets/mentions" || path == "/api/ai/seedance-assets/ensure-active") {
			return
		}
		c.Abort()
		if !client.Enabled() {
			response.Error(c, 503, "sd-video unavailable")
			return
		}
		user := auth.MustCurrentUser(c)
		workspace := service.WorkspaceIDForScope(requestWorkspaceScope(c), user.ID)
		call := func(method, target string, payload any) (map[string]any, error) {
			envelope, err := client.BusinessRequest(c.Request.Context(), method, target, user, workspace, payload)
			if err != nil {
				return nil, err
			}
			var result map[string]any
			err = json.Unmarshal(envelope.Data, &result)
			return result, err
		}
		fail := func(err error) {
			code := 502
			var remote *sdvideo.Error
			if errors.As(err, &remote) && remote.StatusCode >= 400 && remote.StatusCode < 500 {
				code = remote.StatusCode
			}
			response.Error(c, code, "SD-video 素材操作失败，请检查服务配置或素材状态")
		}
		write := func(method, target string, payload any) {
			value, err := call(method, target, payload)
			if err != nil {
				fail(err)
			} else {
				response.OK(c, value)
			}
		}
		if path == "/api/admin/seedance-assets/readiness" {
			write("GET", "/v1/volcano/readiness", nil)
			return
		}
		if strings.HasPrefix(path, "/api/admin/seedance-asset-tags") {
			destination := "/v1/volcano/tags"
			if c.Param("id") != "" {
				destination += "/" + url.PathEscape(c.Param("id"))
			}
			if c.Request.Method == http.MethodGet && c.Param("id") == "" {
				// 旧标签选择器无分页参数，逐页兼容；不把首屏截断冒充完整标签库。
				if c.Query("page") != "" || c.Query("pageSize") != "" {
					write("GET", destination+"?"+sdVideoAssetQuery(c).Encode(), nil)
					return
				}
				items := []any{}
				for page := 1; ; page++ {
					result, err := call("GET", destination+"?pageSize=200&page="+strconv.Itoa(page)+"&keyword="+url.QueryEscape(c.Query("keyword")), nil)
					if err != nil {
						fail(err)
						return
					}
					rows, valid := result["items"].([]any)
					total, hasTotal := result["total"].(float64)
					if !valid || !hasTotal || total < 0 {
						fail(errors.New("invalid tag page"))
						return
					}
					items = append(items, rows...)
					if len(items) >= int(total) {
						break
					}
					if len(rows) == 0 {
						fail(errors.New("incomplete tag page"))
						return
					}
				}
				response.OK(c, gin.H{"items": items, "total": len(items)})
				return
			}
			var payload map[string]any
			if c.Request.Method == "POST" || c.Request.Method == "PUT" {
				if c.ShouldBindJSON(&payload) != nil {
					response.Error(c, 400, "invalid tag")
					return
				}
			}
			write(c.Request.Method, destination, payload)
			return
		}
		if path == "/api/admin/seedance-assets/upload" {
			c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxSeedanceRemoteVideoBytes)
			file, header, err := c.Request.FormFile("file")
			if err != nil {
				response.Error(c, 400, "file required")
				return
			}
			defer file.Close()
			if c.Request.MultipartForm != nil {
				defer c.Request.MultipartForm.RemoveAll()
			}
			body, err := io.ReadAll(io.LimitReader(file, maxSeedanceRemoteVideoBytes+1))
			if err != nil || int64(len(body)) > maxSeedanceRemoteVideoBytes {
				response.Error(c, 413, "file too large")
				return
			}
			contentType := firstNonEmpty(header.Header.Get("Content-Type"), http.DetectContentType(body))
			kind := strings.ToLower(strings.TrimSpace(c.PostForm("asset_type")))
			if kind == "" {
				kind = strings.SplitN(contentType, "/", 2)[0]
			}
			if !strings.HasPrefix(contentType, kind+"/") {
				response.Error(c, 400, "media type mismatch")
				return
			}
			token, err := client.UploadInput(c.Request.Context(), user, workspace, header.Filename, contentType, body)
			if err != nil {
				fail(err)
				return
			}
			var tags []string
			if value := c.PostForm("tag_ids"); value != "" {
				if strings.HasPrefix(value, "[") {
					if json.Unmarshal([]byte(value), &tags) != nil {
						response.Error(c, 400, "invalid tags")
						return
					}
				} else {
					tags = strings.Split(value, ",")
				}
			}
			created, err := call("POST", "/v1/volcano/assets", map[string]any{"storage_token": token, "name": firstNonEmpty(c.PostForm("name"), header.Filename), "description": c.PostForm("description"), "kind": kind, "tags": tags})
			if err != nil {
				fail(err)
				return
			}
			response.OK(c, sdVideoAssetView(created, nil, requestWorkspaceScope(c)))
			return
		}
		if path == "/api/admin/seedance-assets/register-url" {
			var payload map[string]any
			if c.ShouldBindJSON(&payload) != nil {
				response.Error(c, 400, "invalid source URL")
				return
			}
			payload["kind"] = strings.ToLower(stringFromAny(payload["asset_type"]))
			payload["tags"] = payload["tag_ids"]
			created, err := call("POST", "/v1/volcano/register-url", payload)
			if err != nil {
				fail(err)
				return
			}
			response.OK(c, sdVideoAssetView(created, nil, requestWorkspaceScope(c)))
			return
		}
		if path == "/api/admin/seedance-assets/poll" || path == "/api/admin/seedance-assets/sync" {
			write("POST", "/v1/volcano/poll", nil)
			return
		}
		if strings.HasSuffix(path, "/ensure-active") {
			var payload struct {
				IDs []string `json:"asset_ids"`
			}
			if c.ShouldBindJSON(&payload) != nil {
				response.Error(c, 400, "invalid references")
				return
			}
			write("POST", "/v1/volcano/ensure-active", map[string]any{"asset_ids": payload.IDs})
			return
		}
		if c.Param("id") == "" {
			query := sdVideoAssetQuery(c)
			if strings.HasSuffix(path, "/mentions") {
				query.Set("status", "active")
			}
			listed, err := call("GET", "/v1/volcano/assets?"+query.Encode(), nil)
			if err != nil {
				fail(err)
				return
			}
			rows, _ := listed["items"].([]any)
			items := []gin.H{}
			for _, raw := range rows {
				if item, ok := raw.(map[string]any); ok {
					items = append(items, sdVideoAssetView(item, nil, requestWorkspaceScope(c)))
				}
			}
			listed["items"] = items
			response.OK(c, listed)
			return
		}
		target := "/v1/volcano/assets/" + url.PathEscape(c.Param("id"))
		if c.Request.Method == "GET" {
			selected, err := call("GET", target, nil)
			if err != nil {
				fail(err)
				return
			}
			response.OK(c, sdVideoAssetView(selected, nil, requestWorkspaceScope(c)))
			return
		}
		if strings.Contains(path, "/tags/") {
			write(c.Request.Method, target+"/tags/"+url.PathEscape(c.Param("tag_id")), nil)
			return
		}
		if c.Request.Method == "DELETE" {
			write("DELETE", target, nil)
			return
		}
		var payload map[string]any
		if c.ShouldBindJSON(&payload) != nil {
			response.Error(c, 400, "invalid asset metadata")
			return
		}
		if value, ok := payload["tag_ids"]; ok {
			payload["tags"] = value
			delete(payload, "tag_ids")
		}
		updated, err := call("PUT", target, payload)
		if err != nil {
			fail(err)
			return
		}
		response.OK(c, sdVideoAssetView(updated, nil, requestWorkspaceScope(c)))
	}
}

func sdVideoAssetQuery(c *gin.Context) url.Values {
	query := url.Values{}
	for _, key := range []string{"page", "pageSize", "limit", "offset", "keyword", "kind", "tag", "status"} {
		if value := c.Query(key); value != "" {
			query.Set(key, value)
		}
	}
	for old, key := range map[string]string{"search": "keyword", "type": "kind", "tag_id": "tag"} {
		if value := c.Query(old); value != "" {
			query.Set(key, value)
		}
	}
	state := strings.ToLower(query.Get("status"))
	if state == "processing" {
		state = "pending"
	}
	if state != "" {
		query.Set("status", state)
	}
	return query
}

func sdVideoHasTag(item map[string]any, id string) bool {
	tags, _ := item["tags"].([]any)
	for _, value := range tags {
		if value == id {
			return true
		}
	}
	return false
}

func sdVideoAssetView(item map[string]any, allTags []any, scope string) gin.H {
	if details, ok := item["tag_details"].([]any); ok {
		allTags = details
	}
	tags := []any{}
	for _, value := range allTags {
		if tag, ok := value.(map[string]any); ok && sdVideoHasTag(item, stringFromAny(tag["id"])) {
			tags = append(tags, tag)
		}
	}
	state := map[string]string{"active": "Active", "failed": "Failed", "queued": "Processing", "processing": "Processing", "delete_requested": "Processing"}[stringFromAny(item["status"])]
	return gin.H{"id": item["id"], "name": item["name"], "description": item["description"], "asset_type": strings.Title(stringFromAny(item["kind"])), "status": state,
		"volcano_asset_id": item["provider_asset_id"], "provider_id": item["upstream_provider"], "provider_protocol": "volcano_asset", "tags": tags,
		"source_url": "/api/sd-video/volcano/assets/" + url.PathEscape(stringFromAny(item["id"])) + "/content?scope=" + url.QueryEscape(scope), "created_at": item["created_at"], "updated_at": item["updated_at"]}
}
