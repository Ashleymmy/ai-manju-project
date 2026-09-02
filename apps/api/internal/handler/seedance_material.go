package handler

import (
	"errors"
	"net/http"
	"strings"

	"github.com/ai-manju/api/internal/response"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

type SeedanceMaterialHandler struct {
	materials *service.SeedanceMaterialService
}

func NewSeedanceMaterialHandler(materials *service.SeedanceMaterialService) *SeedanceMaterialHandler {
	return &SeedanceMaterialHandler{materials: materials}
}

func (h *SeedanceMaterialHandler) CreateVisualValidateSession(c *gin.Context) {
	h.call(c, service.SeedanceMaterialActionCreateVisualValidateSession, nil)
}

func (h *SeedanceMaterialHandler) CreateRealValidateH5(c *gin.Context) {
	h.call(c, service.SeedanceMaterialActionCreateRealValidateH5, nil)
}

func (h *SeedanceMaterialHandler) GetVisualValidateResult(c *gin.Context) {
	payload := payloadWithOptionalID(c, "BytedToken")
	h.call(c, service.SeedanceMaterialActionGetVisualValidateResult, payload)
}

func (h *SeedanceMaterialHandler) CreateGroup(c *gin.Context) {
	payload, ok := bindMaterialPayload(c)
	if !ok {
		return
	}
	h.call(c, service.SeedanceMaterialActionCreateAssetGroup, payload)
}

func (h *SeedanceMaterialHandler) GetGroup(c *gin.Context) {
	payload := payloadWithPathID(c)
	h.call(c, service.SeedanceMaterialActionGetAssetGroup, payload)
}

func (h *SeedanceMaterialHandler) DeleteGroup(c *gin.Context) {
	payload := payloadWithPathID(c)
	h.call(c, service.SeedanceMaterialActionDeleteAssetGroup, payload)
}

func (h *SeedanceMaterialHandler) CreateAsset(c *gin.Context) {
	payload, ok := bindMaterialPayload(c)
	if !ok {
		return
	}
	h.call(c, service.SeedanceMaterialActionCreateAsset, payload)
}

func (h *SeedanceMaterialHandler) GetAsset(c *gin.Context) {
	payload := payloadWithPathID(c)
	h.call(c, service.SeedanceMaterialActionGetAsset, payload)
}

func (h *SeedanceMaterialHandler) DeleteAsset(c *gin.Context) {
	payload := payloadWithPathID(c)
	h.call(c, service.SeedanceMaterialActionDeleteAsset, payload)
}

func (h *SeedanceMaterialHandler) EnsureActive(c *gin.Context) {
	var req struct {
		AssetID  string   `json:"asset_id"`
		AssetIDs []string `json:"asset_ids"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	assetIDs := append([]string{}, req.AssetIDs...)
	if strings.TrimSpace(req.AssetID) != "" {
		assetIDs = append(assetIDs, req.AssetID)
	}
	if len(assetIDs) == 0 {
		response.Error(c, http.StatusBadRequest, "asset_id is required")
		return
	}
	if err := h.materials.EnsureAssetsActive(c.Request.Context(), assetIDs); err != nil {
		writeMaterialError(c, err)
		return
	}
	response.OK(c, gin.H{"active": true})
}

func (h *SeedanceMaterialHandler) call(c *gin.Context, action string, payload map[string]any) {
	result, err := h.materials.Call(c.Request.Context(), service.SeedanceMaterialRequest{
		Action:  action,
		Payload: payload,
	})
	if err != nil {
		writeMaterialError(c, err)
		return
	}
	response.OK(c, result)
}

func bindMaterialPayload(c *gin.Context) (map[string]any, bool) {
	payload := make(map[string]any)
	if c.Request.Body == nil {
		return payload, true
	}
	if err := c.ShouldBindJSON(&payload); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return nil, false
	}
	return payload, true
}

func payloadWithPathID(c *gin.Context) map[string]any {
	return map[string]any{"Id": strings.TrimSpace(c.Param("id"))}
}

func payloadWithOptionalID(c *gin.Context, key string) map[string]any {
	value := strings.TrimSpace(c.Query(key))
	if value == "" {
		value = strings.TrimSpace(c.Query(strings.ToLower(key)))
	}
	if value == "" {
		value = strings.TrimSpace(c.Query("byted_token"))
	}
	return map[string]any{key: value}
}

func writeMaterialError(c *gin.Context, err error) {
	status := http.StatusBadGateway
	if errors.Is(err, service.ErrSeedanceMaterialProviderNotConfigured) {
		status = http.StatusBadRequest
	}
	if errors.Is(err, service.ErrSeedanceMaterialAssetNotActive) {
		status = http.StatusBadRequest
	}
	response.Error(c, status, err.Error())
}
