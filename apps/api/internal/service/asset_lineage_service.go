package service

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strconv"
	"strings"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

var (
	ErrAssetLineageRelation = errors.New("asset lineage relation type is invalid")
	ErrAssetLineageParent   = errors.New("asset lineage parent is invalid")
)

type AssetLineageService struct {
	lineage repository.AssetLineageRepository
	assets  repository.AssetRepository
	tags    repository.TagRepository
}

type AssetLineageRecordInput struct {
	ParentAssetIDs []string
	ChildAssetID   string
	RelationType   string
	SourceProject  string
	SourceNode     string
	SourceJob      string
}

type AssetLineageView struct {
	Parents  []model.AssetLineage `json:"parents"`
	Children []model.AssetLineage `json:"children"`
}

func NewAssetLineageService(lineage repository.AssetLineageRepository, assets repository.AssetRepository, tags repository.TagRepository) *AssetLineageService {
	return &AssetLineageService{lineage: lineage, assets: assets, tags: tags}
}

func (s *AssetLineageService) Record(userID string, scope string, input AssetLineageRecordInput) ([]model.AssetLineage, error) {
	parents := uniqueAssetStrings(input.ParentAssetIDs)
	if len(parents) == 0 {
		return []model.AssetLineage{}, nil
	}
	workspaceID := WorkspaceIDForScope(scope, userID)
	childID := strings.TrimSpace(input.ChildAssetID)
	if childID == "" {
		return nil, ErrAssetLineageParent
	}
	assetIDs := append([]string{childID}, parents...)
	assets, err := s.assets.ListByWorkspaceIDs(assetIDs, workspaceID)
	if err != nil {
		return nil, err
	}
	if len(assets) != len(assetIDs) {
		return nil, repository.ErrAssetNotFound
	}
	relation := normalizeAssetLineageRelation(input.RelationType)
	if relation == "" {
		return nil, ErrAssetLineageRelation
	}
	rows := make([]model.AssetLineage, 0, len(parents))
	for index, parentID := range parents {
		if parentID == childID {
			return nil, ErrAssetLineageParent
		}
		rows = append(rows, model.AssetLineage{
			ID: assetLineageID(workspaceID, parentID, childID, relation, index), WorkspaceID: workspaceID,
			ParentAssetID: parentID, ChildAssetID: childID, RelationType: relation,
			SourceProjectID: strings.TrimSpace(input.SourceProject), SourceNodeID: strings.TrimSpace(input.SourceNode), SourceJobID: strings.TrimSpace(input.SourceJob), InputOrdinal: index,
		})
	}
	stored, err := s.lineage.CreateMany(rows)
	if err != nil {
		return nil, err
	}
	if s.tags != nil {
		if err := s.tags.ResyncInheritedAssetTags(workspaceID, userID, childID, parents); err != nil {
			return nil, err
		}
	}
	return stored, nil
}

func (s *AssetLineageService) Get(assetID string, userID string, scope string) (AssetLineageView, error) {
	workspaceID := WorkspaceIDForScope(scope, userID)
	assetID = strings.TrimSpace(assetID)
	if _, err := s.assets.GetByWorkspace(assetID, workspaceID); err != nil {
		return AssetLineageView{}, err
	}
	parents, err := s.lineage.ListByChild(workspaceID, assetID)
	if err != nil {
		return AssetLineageView{}, err
	}
	children, err := s.lineage.ListByParent(workspaceID, assetID)
	if err != nil {
		return AssetLineageView{}, err
	}
	return AssetLineageView{Parents: parents, Children: children}, nil
}

func (s *AssetLineageService) ResyncInheritedTags(assetID string, userID string, scope string) error {
	workspaceID := WorkspaceIDForScope(scope, userID)
	assetID = strings.TrimSpace(assetID)
	if _, err := s.assets.GetByWorkspace(assetID, workspaceID); err != nil {
		return err
	}
	parents, err := s.lineage.ListByChild(workspaceID, assetID)
	if err != nil {
		return err
	}
	parentIDs := make([]string, 0, len(parents))
	for _, item := range parents {
		parentIDs = append(parentIDs, item.ParentAssetID)
	}
	return s.tags.ResyncInheritedAssetTags(workspaceID, userID, assetID, parentIDs)
}

func normalizeAssetLineageRelation(value string) string {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case model.AssetLineageGeneration:
		return model.AssetLineageGeneration
	case model.AssetLineageEdit:
		return model.AssetLineageEdit
	case model.AssetLineageCrop:
		return model.AssetLineageCrop
	case model.AssetLineageAnnotation:
		return model.AssetLineageAnnotation
	case model.AssetLineageCompress:
		return model.AssetLineageCompress
	case model.AssetLineageImport:
		return model.AssetLineageImport
	default:
		return ""
	}
}

func assetLineageID(workspaceID string, parentID string, childID string, relation string, ordinal int) string {
	digest := sha256.Sum256([]byte(strings.Join([]string{workspaceID, parentID, childID, relation, strconv.Itoa(ordinal)}, "\x00")))
	return "asset_lineage_" + hex.EncodeToString(digest[:12])
}
