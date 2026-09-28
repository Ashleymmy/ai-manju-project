package service

import (
	"encoding/base64"
	"encoding/json"
	"time"

	"github.com/ai-manju/api/internal/repository"
)

const (
	// Bound metadata reads; clients can follow the stable cursor for older work.
	ComicAnalysisDiscoveryPageSize = 20
	comicAnalysisCursorMaxBytes    = 512
)

type ComicAnalysisSummary struct {
	ID             string    `json:"id"`
	Title          string    `json:"title"`
	SourceFileName string    `json:"source_file_name"`
	Status         string    `json:"status"`
	CreatedAt      time.Time `json:"created_at"`
	ExpiresAt      time.Time `json:"expires_at"`
}

type ComicAnalysisDiscovery struct {
	Items      []ComicAnalysisSummary `json:"items"`
	NextCursor string                 `json:"next_cursor,omitempty"`
}

type comicAnalysisCursor struct {
	CreatedAt time.Time `json:"created_at"`
	ID        string    `json:"id"`
}

func (s *ComicAssetService) ListAnalysisSessions(userID, scope, cursor string) (ComicAnalysisDiscovery, error) {
	filter := repository.ComicAnalysisListFilter{OwnerID: userID, WorkspaceID: WorkspaceIDForScope(scope, userID), Now: time.Now().UTC(), Limit: ComicAnalysisDiscoveryPageSize + 1}
	if cursor != "" {
		if len(cursor) > comicAnalysisCursorMaxBytes {
			return ComicAnalysisDiscovery{}, ErrGenerationReceiptInvalid
		}
		var decoded comicAnalysisCursor
		raw, err := base64.RawURLEncoding.DecodeString(cursor)
		if err != nil || json.Unmarshal(raw, &decoded) != nil || decoded.CreatedAt.IsZero() || decoded.ID == "" {
			return ComicAnalysisDiscovery{}, ErrGenerationReceiptInvalid
		}
		filter.BeforeCreatedAt, filter.BeforeID = decoded.CreatedAt, decoded.ID
	}
	sessions, err := s.repo.ListAnalysisSessions(filter)
	if err != nil {
		return ComicAnalysisDiscovery{}, err
	}
	result := ComicAnalysisDiscovery{Items: make([]ComicAnalysisSummary, 0, len(sessions))}
	if len(sessions) > ComicAnalysisDiscoveryPageSize {
		sessions = sessions[:ComicAnalysisDiscoveryPageSize]
		last := sessions[len(sessions)-1]
		raw, _ := json.Marshal(comicAnalysisCursor{CreatedAt: last.CreatedAt, ID: last.ID})
		result.NextCursor = base64.RawURLEncoding.EncodeToString(raw)
	}
	for _, session := range sessions {
		result.Items = append(result.Items, ComicAnalysisSummary{ID: session.ID, Title: session.Title, SourceFileName: session.SourceFileName, Status: session.Status, CreatedAt: session.CreatedAt, ExpiresAt: session.ExpiresAt})
	}
	return result, nil
}
