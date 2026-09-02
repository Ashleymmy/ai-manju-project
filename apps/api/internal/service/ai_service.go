package service

import (
	"context"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/provider"
)

type AIService struct{}

func NewAIService() *AIService {
	return &AIService{}
}

func (s *AIService) GenerateImages(ctx context.Context, client *provider.OpenAICompatibleClient, config model.ModelProviderConfig, req provider.ImageGenerationRequest) (provider.ImageGenerationResponse, error) {
	upstreamCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), provider.ImageRequestTimeout(config.TimeoutMS))
	defer cancel()
	return client.GenerateImages(upstreamCtx, req)
}

func (s *AIService) EditImages(ctx context.Context, client *provider.OpenAICompatibleClient, config model.ModelProviderConfig, req provider.ImageEditRequest) (provider.ImageGenerationResponse, error) {
	upstreamCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), provider.ImageRequestTimeout(config.TimeoutMS))
	defer cancel()
	return client.EditImages(upstreamCtx, req)
}
