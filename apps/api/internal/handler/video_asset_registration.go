package handler

import (
	"encoding/json"
	"errors"
	"strings"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

// Validate the canvas association before storing it; never trust a caller's
// asset_registration, which is worker-only data.
func (h *AIHandler) prepareVideoAssetRegistration(c *gin.Context, body map[string]any) error {
	delete(body, "asset_registration")
	delete(body, "asset_context")
	projectID := strings.TrimSpace(stringFromAny(body["project_id"]))
	nodeID := strings.TrimSpace(stringFromAny(body["node_id"]))
	if projectID == "" {
		if nodeID != "" {
			return errors.New("node requires project")
		}
		return nil
	}
	if h.projects == nil {
		return errors.New("project service unavailable")
	}
	user := auth.MustCurrentUser(c)
	scope := requestWorkspaceScope(c)
	snapshot, err := h.projects.GetSnapshot(projectID, user.ID, scope)
	if err != nil {
		return errors.New("project snapshot not found")
	}
	if nodeID != "" {
		var graph struct {
			Nodes []struct {
				ID string `json:"id"`
			} `json:"nodes"`
		}
		if json.Unmarshal(snapshot.Data, &graph) != nil {
			return errors.New("project snapshot is invalid")
		}
		found := false
		for _, node := range graph.Nodes {
			if node.ID == nodeID {
				found = true
				break
			}
		}
		if !found {
			return errors.New("canvas node no longer exists; save the canvas before generating")
		}
	}
	project, err := h.projects.Get(projectID, user.ID, scope)
	if err != nil {
		return errors.New("project not found")
	}
	body["project_id"], body["node_id"] = projectID, nodeID
	context := service.AssetRegistrationContext{
		SourceType: model.AssetSourceCanvas, SourceProjectID: projectID,
		SourceProjectName: project.Title, SourceNodeID: nodeID,
		Category: model.AssetCategoryOther, SourceMetadata: service.VideoHistoryMetadata(body),
	}
	if h.assetFolders != nil {
		context, err = h.assetFolders.ResolveRegistration(user.ID, scope, context)
		if err != nil {
			return err
		}
	}
	body["asset_registration"] = map[string]any{
		"source_type": context.SourceType, "source_project_id": context.SourceProjectID,
		"source_node_id": context.SourceNodeID, "folder_id": context.FolderID,
		"category": context.Category, "source_metadata": context.SourceMetadata,
	}
	return nil
}

// Keep Studio history/routing fields in the durable job, not in the vendor API.
func nativeVideoProviderBody(body map[string]any) map[string]any {
	result := make(map[string]any, len(body))
	for key, value := range body {
		switch key {
		case "project_id", "node_id", "scope", "studio_model", "asset_registration", "asset_context", "conversation_id", "studio_message_id":
			continue
		}
		result[key] = value
	}
	return result
}
