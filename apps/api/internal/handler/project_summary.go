package handler

import (
	"time"

	"github.com/ai-manju/api/internal/model"
)

// Summary responses intentionally omit data. An empty object would be mistaken
// for a loaded, editable canvas by clients that understand snapshot payloads.
type projectSummaryResponse struct {
	ID           string    `json:"id"`
	Title        string    `json:"title"`
	OwnerID      string    `json:"owner_id"`
	WorkspaceID  string    `json:"workspace_id"`
	Scope        string    `json:"scope"`
	CoverAssetID string    `json:"cover_asset_id"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func projectSummaryResponses(projects []model.Project) []projectSummaryResponse {
	result := make([]projectSummaryResponse, 0, len(projects))
	for _, item := range projects {
		project := projectResponse(item)
		result = append(result, projectSummaryResponse{
			ID: project.ID, Title: project.Title, OwnerID: project.OwnerID,
			WorkspaceID: project.WorkspaceID, Scope: project.Scope,
			CoverAssetID: project.CoverAssetID, CreatedAt: project.CreatedAt, UpdatedAt: project.UpdatedAt,
		})
	}
	return result
}
